import type { Context } from '@deepseek-ai/cordis'
// Type-only: `dsh-commands` is an OPTIONAL peer (its service is absent on TUI-only
// hosts), so the CommandId brand must never become a runtime import.
import type { CommandId } from '@deepseek-ai/dsh-commands'
import type { Message, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { deadline } from '@deepseek-ai/dsh-timeout'
import {
  autoApprovalPolicyBlock,
  canAutoApprove,
  type AutoApprovalPolicyBlock,
  type ReviewerAssessment,
} from './assessment.js'
import {
  ReviewerGenerationError,
  ReviewerModel,
  type ReviewerFailureDetail,
} from './reviewer-model.js'
import { privacyText } from './privacy.js'
import type { ReviewImageAudit, ReviewImageStats } from './review-context.js'
import type {
  ResolvedConfig,
  ReviewerAuthorization,
  ReviewerOutcome,
  ReviewerRoute,
  ReviewerRisk,
} from './config.js'
import { ReviewerRouteSource } from './reviewer-route-settings.js'
import { REVIEW_COMMAND_SOURCE, type AiApprovalReviewedData } from './types.js'

function auditField(text: string, redactPaths: boolean): string {
  return privacyText(text, redactPaths).replace(/[\u0000-\u001f\u007f]+/g, ' ')
}

export class ReviewCoordinator {
  private readonly denials = new WeakMap<Session, number>()
  private readonly failures = new WeakMap<Session, { consecutive: number; blockedUntil: number }>()
  private readonly cursors = new WeakMap<Session, readonly string[]>()
  private readonly flights = new WeakMap<Session, Map<string, Promise<ApprovalOutcome>>>()
  private readonly queues = new WeakMap<Session, Promise<void>>()
  private readonly reviewSerials = new WeakMap<Session, number>()
  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
    private readonly model = new ReviewerModel(ctx, config),
    private readonly route = new ReviewerRouteSource(config),
  ) {}
  review(request: ApprovalRequest, execution: Readonly<ToolExecution>): Promise<ApprovalOutcome> {
    const s = request.agent.session
    const key = String(request.callId ?? request.toolName)
    const flights = this.flights.get(s) ?? new Map<string, Promise<ApprovalOutcome>>()
    const running = flights.get(key)
    if (running) return running
    const p = this.schedule(s, request, execution).finally(() => {
      if (flights.get(key) === p) flights.delete(key)
    })
    flights.set(key, p)
    this.flights.set(s, flights)
    return p
  }
  private async schedule(
    s: Session,
    request: ApprovalRequest,
    execution: Readonly<ToolExecution>,
  ): Promise<ApprovalOutcome> {
    using d = deadline(request.signal, this.config.timeoutMs, 'AI_APPROVAL_TIMEOUT')
    return await this.enqueue(s, async () => {
      if (d.signal.aborted) return request.signal?.aborted ? 'cancelled' : 'unavailable'
      return await this.reviewOnce(request, execution, d.signal)
    })
  }
  private enqueue(s: Session, task: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> {
    const prior = this.queues.get(s) ?? Promise.resolve()
    const review = prior.then(task)
    const tail = review.then(
      () => undefined,
      () => undefined,
    )
    this.queues.set(s, tail)
    return review.finally(() => {
      if (this.queues.get(s) === tail) this.queues.delete(s)
    })
  }
  private async reviewOnce(
    request: ApprovalRequest,
    execution: Readonly<ToolExecution>,
    signal: AbortSignal,
  ): Promise<ApprovalOutcome> {
    const s = request.agent.session
    const route = this.route.get()
    const reviewId = this.start(s, request, route)
    const history = s.deriveMessages()
    const messages = this.reviewMessages(s, history)
    const prior = this.denials.get(s) ?? 0
    if (prior >= this.config.maxConsecutiveDenials) {
      this.record(
        reviewId,
        s,
        request,
        'high',
        'unknown',
        'deny',
        'rejected',
        'Reviewer denial limit reached.',
        { attempts: 0, durationMs: 0 },
        route,
      )
      return 'rejected'
    }
    const fs = this.failures.get(s)
    if (fs && fs.blockedUntil > Date.now()) {
      this.record(
        reviewId,
        s,
        request,
        'high',
        'unknown',
        'deny',
        'unavailable',
        'Reviewer failure circuit is open.',
        { attempts: 0, durationMs: 0 },
        route,
      )
      return 'unavailable'
    }
    const started = Date.now()
    let attempts = 0,
      usage: TokenUsage | undefined,
      assessment: ReviewerAssessment | undefined,
      imageStats: ReviewImageStats | undefined,
      everAdmitted = 0,
      everAdmittedBytes = 0,
      everEstimatedTokens = 0,
      imageBearingAttempts = 0,
      fallbackUsed = false,
      forceTextOnly = false,
      failure: unknown
    const captureImages = (stats: ReviewImageStats | undefined) => {
      if (stats === undefined) return
      imageStats = stats
      everAdmitted = Math.max(everAdmitted, stats.admitted)
      everAdmittedBytes = Math.max(everAdmittedBytes, stats.admittedBytes)
      everEstimatedTokens = Math.max(everEstimatedTokens, stats.estimatedTokens)
      if (stats.admitted > 0) imageBearingAttempts++
    }
    for (let i = 0; i < this.config.maxAttempts; i++) {
      attempts++
      if (forceTextOnly) fallbackUsed = true
      try {
        const g = await this.model.assess(
          request,
          execution,
          messages,
          signal,
          route,
          forceTextOnly,
        )
        usage = mergeUsage(usage, g.usage)
        assessment = g.assessment
        captureImages(g.imageStats)
        break
      } catch (e) {
        failure = e
        if (e instanceof ReviewerGenerationError) {
          usage = mergeUsage(usage, e.usage)
          captureImages(e.imageStats)
          if (e.hadImages) forceTextOnly = true
          if (e.category === 'invalid-input') break
        }
        if (request.signal?.aborted) {
          const images = imageAuditOf(
            imageStats,
            everAdmitted,
            everAdmittedBytes,
            everEstimatedTokens,
            imageBearingAttempts,
            fallbackUsed,
          )
          this.record(
            reviewId,
            s,
            request,
            'high',
            'unknown',
            'deny',
            'cancelled',
            'Reviewer request was cancelled.',
            {
              attempts,
              durationMs: Math.max(0, Date.now() - started),
              ...(usage ? { usage } : {}),
              ...(images ? { images } : {}),
            },
            route,
          )
          return 'cancelled'
        }
        if (signal.aborted) break
      }
    }
    const images = imageAuditOf(
      imageStats,
      everAdmitted,
      everAdmittedBytes,
      everEstimatedTokens,
      imageBearingAttempts,
      fallbackUsed,
    )
    const metrics = {
      attempts,
      durationMs: Math.max(0, Date.now() - started),
      ...(usage ? { usage } : {}),
      ...(images ? { images } : {}),
    }
    if (!assessment) {
      const countsTowardCircuit = !(
        failure instanceof ReviewerGenerationError && failure.category === 'invalid-input'
      )
      if (countsTowardCircuit) {
        const consecutive = (fs?.consecutive ?? 0) + 1
        this.failures.set(s, {
          consecutive,
          blockedUntil:
            consecutive >= this.config.maxConsecutiveFailures
              ? Date.now() + this.config.failureCooldownMs
              : 0,
        })
      }
      this.record(
        reviewId,
        s,
        request,
        'high',
        'unknown',
        'deny',
        'unavailable',
        `Reviewer unavailable: ${failureDetail(failure)}`,
        metrics,
        route,
      )
      return 'unavailable'
    }
    this.failures.delete(s)
    this.commitCursor(
      s,
      history.map((m) => String(m.id)),
    )
    const visualOmission = (imageStats?.omitted ?? 0) > 0
    const approved =
      !fallbackUsed &&
      !visualOmission &&
      canAutoApprove(assessment, this.config.maxRisk, this.config.minAuthorization)
    const thresholdBlock = autoApprovalPolicyBlock(
      assessment,
      this.config.maxRisk,
      this.config.minAuthorization,
    )
    const policyBlock =
      assessment.outcome !== 'allow'
        ? thresholdBlock
        : fallbackUsed
          ? { ...thresholdBlock, visualFallback: true as const }
          : visualOmission
            ? { ...thresholdBlock, visualOmission: true as const }
            : thresholdBlock
    this.record(
      reviewId,
      s,
      request,
      assessment.risk,
      assessment.authorization,
      assessment.outcome,
      approved ? 'allowed-once' : 'rejected',
      assessment.rationale,
      metrics,
      route,
      policyBlock,
    )
    this.denials.set(s, approved ? 0 : prior + 1)
    return approved ? 'allowed-once' : 'rejected'
  }
  private reviewMessages(s: Session, messages: readonly Message[]) {
    const previous = this.cursors.get(s)
    if (!previous?.length) return messages
    if (!previous.every((id, i) => String(messages[i]?.id) === id)) return messages
    const users = messages.filter((m) => m.role === 'user' && m.source.kind === 'user')
    const anchors = [users[0], users.at(-1)].filter(
      (m, i, a): m is Message => m !== undefined && a.findIndex((x) => x?.id === m.id) === i,
    )
    const ids = new Set(anchors.map((m) => String(m.id)))
    return [...anchors, ...messages.slice(previous.length).filter((m) => !ids.has(String(m.id)))]
  }
  private commitCursor(s: Session, candidate: readonly string[]) {
    const current = s.deriveMessages().map((m) => String(m.id))
    const prefix = (xs: readonly string[]) => xs.every((id, i) => current[i] === id)
    const old = this.cursors.get(s)
    if (prefix(candidate) && !(old && prefix(old) && old.length > candidate.length))
      this.cursors.set(s, candidate)
    else if (!old || !prefix(old)) this.cursors.delete(s)
  }
  private start(s: Session, r: ApprovalRequest, route: Readonly<ReviewerRoute>): string {
    const serial = (this.reviewSerials.get(s) ?? 0) + 1
    this.reviewSerials.set(s, serial)
    const reviewId = `${String(r.callId ?? r.toolName)}:${serial}`
    this.ctx.emit('ai-approval/review-started', s, {
      reviewId,
      ...(r.callId === undefined ? {} : { callId: r.callId }),
      toolName: r.toolName,
      reason: privacyText(r.reason ?? '', this.config.redactPaths),
      provider: auditField(route.provider, this.config.redactPaths),
      model: auditField(route.model, this.config.redactPaths),
      ...(route.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: auditField(route.reasoningEffort, this.config.redactPaths) }),
      imageMode: route.imageMode ?? 'omit',
    })
    return reviewId
  }
  private record(
    reviewId: string,
    s: Session,
    r: ApprovalRequest,
    risk: ReviewerRisk,
    authorization: ReviewerAuthorization,
    outcome: ReviewerOutcome,
    approvalOutcome: ApprovalOutcome,
    rationale: string,
    metrics: {
      attempts: number
      durationMs: number
      usage?: TokenUsage
      images?: ReviewImageAudit
    },
    route: Readonly<ReviewerRoute>,
    policyBlock?: AutoApprovalPolicyBlock,
  ) {
    const data: AiApprovalReviewedData = {
      reviewId,
      ...(r.callId === undefined ? {} : { callId: r.callId }),
      toolName: r.toolName,
      cwd: privacyText(s.header.cwd ?? '<unknown>', this.config.redactPaths),
      reason: privacyText(r.reason ?? '', this.config.redactPaths),
      provider: auditField(route.provider, this.config.redactPaths),
      model: auditField(route.model, this.config.redactPaths),
      ...(route.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: auditField(route.reasoningEffort, this.config.redactPaths) }),
      imageMode: route.imageMode ?? 'omit',
      risk,
      authorization,
      outcome,
      approvalOutcome,
      ...(policyBlock === undefined ? {} : { policyBlock }),
      rationale: privacyText(rationale, this.config.redactPaths),
      ...metrics,
    }
    this.ctx.emit('ai-approval/reviewed', s, data)
    appendStandardReviewOutput(s, data)
  }
}

/**
 * Publish through DSH's durable command lifecycle, the standard transcript
 * channel consumed by both Web and TUI without entering model history.
 */
function appendStandardReviewOutput(s: Session, review: AiApprovalReviewedData): void {
  const commandId = `ai-approval-${crypto.randomUUID()}` as CommandId
  // `command/run` is not a surface-eligible event, so no surfaceOp is required.
  s.append('command/run', {
    commandId,
    name: 'ai-approval',
    source: { kind: REVIEW_COMMAND_SOURCE },
  })
  s.append('command/done', {
    commandId,
    kind: 'success',
    text: formatReviewSummary(review),
  })
}

function formatReviewSummary(review: AiApprovalReviewedData): string {
  const result =
    review.approvalOutcome === 'allowed-once'
      ? '通过（仅本次）'
      : review.approvalOutcome === 'rejected'
        ? review.outcome === 'allow'
          ? '未通过（本地策略限制）'
          : '拒绝'
        : review.approvalOutcome === 'cancelled'
          ? '已取消'
          : '不可用（未批准）'
  const policy = formatPolicyBlock(review)
  return [
    `AI 审批：${result}｜危险级别：${review.risk}｜授权判断：${review.authorization}`,
    `原因：${review.rationale}`,
    ...(policy === undefined ? [] : [`策略限制：${policy}`]),
    `审批模型：${review.provider}/${review.model}${review.reasoningEffort ? ` · ${review.reasoningEffort}` : ''}`,
  ].join('\n')
}

function formatPolicyBlock(review: AiApprovalReviewedData): string | undefined {
  const reasons = [
    ...(review.policyBlock?.maxRisk === undefined
      ? []
      : [`风险超过上限 ${review.policyBlock.maxRisk}`]),
    ...(review.policyBlock?.minAuthorization === undefined
      ? []
      : [`授权低于要求 ${review.policyBlock.minAuthorization}`]),
    ...(review.policyBlock?.visualOmission ? ['存在未验证的视觉证据'] : []),
    ...(review.policyBlock?.visualFallback ? ['携图审批失败后使用了纯文本回退'] : []),
  ]
  return reasons.length === 0 ? undefined : reasons.join('；')
}

function imageAuditOf(
  finalStats: ReviewImageStats | undefined,
  everAdmitted: number,
  everAdmittedBytes: number,
  everEstimatedTokens: number,
  imageBearingAttempts: number,
  fallbackUsed: boolean,
): ReviewImageAudit | undefined {
  if (finalStats === undefined) return undefined
  return {
    ...finalStats,
    everAdmitted,
    everAdmittedBytes,
    everEstimatedTokens,
    imageBearingAttempts,
    fallbackUsed,
  }
}

function failureDetail(error: unknown): ReviewerFailureDetail {
  return error instanceof ReviewerGenerationError ? error.detail : 'unknown'
}

function mergeUsage(a: TokenUsage | undefined, b: TokenUsage | undefined): TokenUsage | undefined {
  if (!a) return b
  if (!b) return a
  const sum = (x: number | undefined, y: number | undefined) =>
    x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0)
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(sum(a.cacheReadTokens, b.cacheReadTokens) === undefined
      ? {}
      : { cacheReadTokens: sum(a.cacheReadTokens, b.cacheReadTokens) }),
    ...(sum(a.cacheWriteTokens, b.cacheWriteTokens) === undefined
      ? {}
      : {
          cacheWriteTokens: sum(a.cacheWriteTokens, b.cacheWriteTokens),
        }),
    ...(sum(a.reasoningTokens, b.reasoningTokens) === undefined
      ? {}
      : { reasoningTokens: sum(a.reasoningTokens, b.reasoningTokens) }),
  }
}
