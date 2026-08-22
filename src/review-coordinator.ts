import type { Context } from '@deepseek-ai/cordis'
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
import type {
  ResolvedConfig,
  ReviewerAuthorization,
  ReviewerOutcome,
  ReviewerRoute,
  ReviewerRisk,
} from './config.js'
import { ReviewerRouteSource } from './reviewer-route-settings.js'
export class ReviewCoordinator {
  private readonly denials = new WeakMap<Session, number>()
  private readonly failures = new WeakMap<Session, { consecutive: number; blockedUntil: number }>()
  private readonly cursors = new WeakMap<Session, readonly string[]>()
  private readonly flights = new WeakMap<Session, Map<string, Promise<ApprovalOutcome>>>()
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
    const p = this.reviewOnce(request, execution).finally(() => {
      if (flights.get(key) === p) flights.delete(key)
    })
    flights.set(key, p)
    this.flights.set(s, flights)
    return p
  }
  private async reviewOnce(
    request: ApprovalRequest,
    execution: Readonly<ToolExecution>,
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
    using d = deadline(request.signal, this.config.timeoutMs, 'AI_APPROVAL_TIMEOUT')
    const started = Date.now()
    let attempts = 0,
      usage: TokenUsage | undefined,
      assessment: ReviewerAssessment | undefined,
      failure: unknown
    for (let i = 0; i < this.config.maxAttempts; i++) {
      attempts++
      try {
        const g = await this.model.assess(request, execution, messages, d.signal, route)
        usage = mergeUsage(usage, g.usage)
        assessment = g.assessment
        break
      } catch (e) {
        failure = e
        if (e instanceof ReviewerGenerationError) {
          usage = mergeUsage(usage, e.usage)
        }
        if (request.signal?.aborted) {
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
            },
            route,
          )
          return 'cancelled'
        }
        if (d.signal.aborted) break
      }
    }
    const metrics = {
      attempts,
      durationMs: Math.max(0, Date.now() - started),
      ...(usage ? { usage } : {}),
    }
    if (!assessment) {
      const consecutive = (fs?.consecutive ?? 0) + 1
      this.failures.set(s, {
        consecutive,
        blockedUntil:
          consecutive >= this.config.maxConsecutiveFailures
            ? Date.now() + this.config.failureCooldownMs
            : 0,
      })
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
    const approved = canAutoApprove(assessment, this.config.maxRisk, this.config.minAuthorization)
    const policyBlock = autoApprovalPolicyBlock(
      assessment,
      this.config.maxRisk,
      this.config.minAuthorization,
    )
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
    const users = messages.filter(
      (m) =>
        m.role === 'user' &&
        m.source.kind === 'user' &&
        !m.content.some((b) => b.type === 'tool-result'),
    )
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
      provider: route.provider,
      model: route.model,
      ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
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
    metrics: { attempts: number; durationMs: number; usage?: TokenUsage },
    route: Readonly<ReviewerRoute>,
    policyBlock?: AutoApprovalPolicyBlock,
  ) {
    this.ctx.emit('ai-approval/reviewed', s, {
      reviewId,
      ...(r.callId === undefined ? {} : { callId: r.callId }),
      toolName: r.toolName,
      cwd: privacyText(s.header.cwd ?? '<unknown>', this.config.redactPaths),
      reason: privacyText(r.reason ?? '', this.config.redactPaths),
      provider: route.provider,
      model: route.model,
      ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
      risk,
      authorization,
      outcome,
      approvalOutcome,
      ...(policyBlock === undefined ? {} : { policyBlock }),
      rationale: privacyText(rationale, this.config.redactPaths),
      ...metrics,
    })
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
