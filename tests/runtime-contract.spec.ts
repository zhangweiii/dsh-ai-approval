import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Context } from '@deepseek-ai/cordis'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { defineTool, ToolRuntime, type ToolExecution } from '@deepseek-ai/dsh-tools'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import apply, { resolveConfig } from '../src/index.ts'

type Handler = (...args: any[]) => any
type Step =
  | { kind: 'success'; assessment?: string; usage?: Record<string, number> }
  | { kind: 'throw'; error?: Error; usage?: Record<string, number> }
  | { kind: 'finish'; reason: Record<string, unknown>; text?: string }
  | { kind: 'no-finish'; text?: string }
  | { kind: 'wait'; gate: Promise<void>; assessment?: string }
  | { kind: 'wait-for-abort' }

type FixtureOptions = {
  preset?: string
  config?: Record<string, unknown>
  steps?: Step[]
  inputModalities?: Array<'text' | 'image'> | null
  contextWindow?: number | null
}

const allow =
  '{"risk_level":"low","user_authorization":"high","outcome":"allow","rationale":"The user explicitly requested this read-only check."}'
const deny =
  '{"risk_level":"high","user_authorization":"low","outcome":"deny","rationale":"The action is not sufficiently authorized."}'

let standardOutput: string[]

beforeEach(() => {
  standardOutput = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    standardOutput.push(String(chunk))
    return true
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function sessionFixture(id: string, cwd = '/Users/alice/private-repo') {
  const messages: any[] = [
    {
      id: `${id}-message-1`,
      role: 'user',
      content: [{ type: 'text', text: 'Inspect the private repository.' }],
      source: { kind: 'user' },
    },
  ]
  const appended: Array<{ type: string; data: any }> = []
  const session: any = {
    header: { id, cwd },
    events: [],
    deriveMessages: () => [...messages],
    append: (type: string, data: any) => appended.push({ type, data }),
  }
  const agent = { session } as unknown as Agent
  return { session, agent, messages, appended }
}

function makeRequest(
  agent: Agent,
  call = 'call-1',
  signal?: AbortSignal,
  reason = 'The command needs a wider capability.',
) {
  return {
    agent,
    toolName: 'shell',
    callId: CallId(call),
    reason,
    ...(signal === undefined ? {} : { signal }),
  } as ApprovalRequest
}

function makeExecution(agent: Agent, call = 'call-1', command = 'echo hello') {
  return {
    agent,
    callId: CallId(call),
    name: 'shell',
    arguments: { command },
  } as unknown as ToolExecution
}

function installFixture(options: FixtureOptions = {}) {
  const handlers = new Map<string, Handler>()
  const providerOptions: any[] = []
  const reviewEvents: Array<{ type: string; data: any }> = []
  const sessions = sessionFixture('session-1')
  const steps = [...(options.steps ?? [{ kind: 'success' } as Step])]
  let calls = 0
  const stream = async function* (providerOptionsArg: any) {
    providerOptions.push(providerOptionsArg)
    const step = steps[calls++] ?? steps.at(-1)!
    if (step.kind === 'wait') {
      await step.gate
      yield { type: 'text-delta', index: 0, text: step.assessment ?? allow }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    if (step.kind === 'wait-for-abort') {
      await new Promise<void>((_resolve, reject) => {
        const signal = providerOptionsArg.signal as AbortSignal
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
      return
    }
    if (step.kind === 'throw') {
      if (step.usage) yield { type: 'usage', usage: step.usage }
      throw step.error ?? new Error('provider unavailable')
    }
    const text = step.kind === 'success' ? (step.assessment ?? allow) : (step.text ?? '')
    if (text) yield { type: 'text-delta', index: 0, text }
    if (step.kind === 'success' && step.usage) yield { type: 'usage', usage: step.usage }
    if (step.kind === 'finish') yield { type: 'finish', reason: step.reason }
    else if (step.kind !== 'no-finish') yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const prepareCall = async (config: Record<string, unknown>) => ({
    config,
    ...(options.inputModalities === null
      ? {}
      : { inputModalities: options.inputModalities ?? ['text'] }),
    ...(options.contextWindow === null
      ? {}
      : { context: { contextWindow: options.contextWindow ?? 128_000 } }),
    stream,
  })
  const preset = options.preset ?? 'ai-approval'
  const scope: any = {
    llm: { prepareCall, stream },
    permissionPresets: { current: () => preset },
    systemPrompt: { context: () => undefined },
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    emit: (event: string, _session: unknown, data: any) => {
      if (event.startsWith('ai-approval/review')) reviewEvents.push({ type: event, data })
    },
    inject: (_deps: unknown, callback: (scope: any) => void) => callback(scope),
  }
  const context = {
    inject: (_deps: unknown, callback: (scope: any) => void) => callback(scope),
  } as unknown as Context
  apply(context, {
    provider: 'test-provider',
    model: 'test-model',
    ...(options.config ?? {}),
  } as any)
  return {
    ...sessions,
    handlers,
    providerOptions,
    reviewEvents,
    get calls() {
      return calls
    },
    execution: makeExecution(sessions.agent),
    request: makeRequest(sessions.agent),
  }
}

async function prepare(fixture: ReturnType<typeof installFixture>, execution = fixture.execution) {
  await fixture.handlers.get('tools/pre-execute')!(execution, async () => 'ask')
}

function audits(fixture: ReturnType<typeof installFixture>) {
  return fixture.reviewEvents
    .filter((item) => item.type === 'ai-approval/reviewed')
    .map((item) => item.data)
}

function starts(fixture: ReturnType<typeof installFixture>) {
  return fixture.reviewEvents
    .filter((item) => item.type === 'ai-approval/review-started')
    .map((item) => item.data)
}

function approval(fixture: ReturnType<typeof installFixture>, request = fixture.request) {
  return fixture.handlers.get('approval/request')!(request, async () => 'rejected')
}

function visibleReviewSummary(fixture: ReturnType<typeof installFixture>): string {
  return (
    (
      fixture.appended.find((event) => event.type === 'command/done')?.data as
        | { text?: string }
        | undefined
    )?.text ?? ''
  )
}

describe('runtime security contracts', () => {
  it('fails closed when execution is missing or belongs to another session', async () => {
    const fixture = installFixture()
    await expect(approval(fixture)).resolves.toBe('unavailable')
    expect(fixture.calls).toBe(0)

    const other = sessionFixture('session-2')
    const otherRequest = makeRequest(other.agent)
    await prepare(fixture, makeExecution(fixture.agent))
    await expect(approval(fixture, otherRequest)).resolves.toBe('unavailable')
    expect(fixture.calls).toBe(0)
  })

  it('bypasses the reviewer when the configured preset is inactive', async () => {
    const fixture = installFixture({ preset: 'ordinary' })
    await prepare(fixture)
    await expect(approval(fixture)).resolves.toBe('rejected')
    expect(fixture.calls).toBe(0)
    expect(audits(fixture)).toHaveLength(0)
  })

  it.each([
    [
      'max tokens',
      { kind: 'finish', reason: { kind: 'max-tokens' }, text: allow } as Step,
      'output-token-limit',
    ],
    [
      'tool calls',
      { kind: 'finish', reason: { kind: 'tool-calls' }, text: allow } as Step,
      'unexpected-tool-call',
    ],
    [
      'provider error finish',
      {
        kind: 'finish',
        reason: { kind: 'error', failure: { message: 'upstream down' } },
        text: allow,
      } as Step,
      'provider-error',
    ],
    [
      'aborted finish',
      {
        kind: 'finish',
        reason: { kind: 'aborted', failure: { message: 'aborted' } },
        text: allow,
      } as Step,
      'provider-error',
    ],
    ['malformed JSON', { kind: 'success', assessment: '{not-json}' } as Step, 'malformed-json'],
  ])('returns unavailable for %s and never grants approval', async (_name, step, detail) => {
    const fixture = installFixture({ steps: [step as Step] })
    await prepare(fixture)
    await expect(approval(fixture)).resolves.toBe('unavailable')
    expect(fixture.calls).toBe(2)
    expect(audits(fixture)[0]).toMatchObject({
      outcome: 'deny',
      approvalOutcome: 'unavailable',
      risk: 'high',
      authorization: 'unknown',
      attempts: 2,
      rationale: `Reviewer unavailable: ${detail}`,
    })
  })

  it('publishes unavailable reviewer details through the shared session transcript', async () => {
    const fixture = installFixture({ steps: [{ kind: 'throw' }] })
    await prepare(fixture)
    await expect(approval(fixture)).resolves.toBe('unavailable')
    expect(visibleReviewSummary(fixture)).toMatch(
      /AI 审批：不可用（未批准）｜危险级别：high｜授权判断：unknown[\s\S]*原因：Reviewer unavailable: unknown/,
    )
    expect(standardOutput).toEqual([])
  })

  it('publishes reviewer denials through the shared session transcript', async () => {
    const fixture = installFixture({
      steps: [
        {
          kind: 'success',
          assessment:
            '{"risk_level":"high","user_authorization":"low","outcome":"deny","rationale":"The action is not sufficiently authorized.\\nHuman approval is required."}',
        },
      ],
    })
    await prepare(fixture)
    await expect(approval(fixture)).resolves.toBe('rejected')
    expect(visibleReviewSummary(fixture)).toBe(
      'AI 审批：拒绝｜危险级别：high｜授权判断：low\n原因：The action is not sufficiently authorized.\nHuman approval is required.\n审批模型：test-provider/test-model',
    )
    expect(standardOutput).toEqual([])
  })

  it('keeps the shared session transcript when a tool finalizer replaces its result', async () => {
    const fixture = installFixture()
    await prepare(fixture)
    await expect(approval(fixture)).resolves.toBe('allowed-once')

    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.tools.register(
      defineTool({
        name: 'finalizing_tool',
        description: 'Exercise the real DSH final-content boundary.',
        parameters: {},
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute() {
          return 'tool body'
        },
        finalizeContent() {
          return [{ type: 'text', text: 'definition-owned final content' }]
        },
      }),
    )
    ctx.on('tools/post-execute', async (_execution, result, next) => {
      const decision = await next()
      return {
        ...decision,
        content: [...result.content, { type: 'text', text: 'post-execute content' }],
      }
    })

    const result = await ctx.tools.execute({
      callId: CallId('finalizing-call'),
      name: 'finalizing_tool',
      arguments: {},
      signal: new AbortController().signal,
    })

    expect(result.content).toEqual([{ type: 'text', text: 'definition-owned final content' }])
    expect(visibleReviewSummary(fixture)).toMatch(/^AI 审批：通过（仅本次）｜危险级别：low/)
    await ctx.fiber.dispose()
  })

  it('passes an explicit reviewer reasoning effort to the provider route', async () => {
    const fixture = installFixture({ config: { reasoningEffort: 'off' } })
    await prepare(fixture)
    await expect(approval(fixture)).resolves.toBe('allowed-once')
    expect(fixture.providerOptions[0]).toMatchObject({ reasoningEffort: 'off' })
  })

  it('sends deduplicated image refs only when the prepared route declares vision', async () => {
    const fixture = installFixture({
      inputModalities: ['text', 'image'],
      config: { imageMode: 'allow' },
    })
    const image = {
      type: 'image',
      attachment: {
        attachmentId: 'image-1',
        mediaType: 'image/png',
        bytes: 1024,
        width: 512,
        height: 512,
      },
    }
    fixture.messages[0].content = [
      { type: 'text', text: 'Inspect the screenshot before approving.' },
      image,
      image,
    ]
    await prepare(fixture)
    await expect(approval(fixture)).resolves.toBe('allowed-once')
    const content = fixture.providerOptions[0].messages[0].content
    expect(content.filter((block: any) => block.type === 'image')).toHaveLength(1)
    expect(content[0].text).toContain('[image 1 attached for reviewer inspection]')
    expect(audits(fixture)[0].images).toEqual({
      admitted: 1,
      omitted: 0,
      admittedBytes: 1024,
      estimatedTokens: 255,
      everAdmitted: 1,
      everAdmittedBytes: 1024,
      everEstimatedTokens: 255,
      imageBearingAttempts: 1,
      fallbackUsed: false,
    })
  })

  it.each([
    ['visual consent is absent', ['text', 'image'] as Array<'text' | 'image'>, {}, undefined],
    ['model capability is unknown', null, { imageMode: 'allow' }, undefined],
    [
      'the prepared context capacity is unknown',
      ['text', 'image'] as Array<'text' | 'image'>,
      { imageMode: 'allow' },
      null,
    ],
    [
      'the prepared context has no image capacity',
      ['text', 'image'] as Array<'text' | 'image'>,
      { imageMode: 'allow' },
      128,
    ],
  ])(
    'omits images and fails closed when %s',
    async (_name, inputModalities, config, contextWindow) => {
      const fixture = installFixture({ inputModalities, config, contextWindow })
      fixture.messages[0].content = [
        { type: 'text', text: 'Inspect the screenshot before approving.' },
        {
          type: 'image',
          attachment: {
            attachmentId: 'image-1',
            mediaType: 'image/png',
            bytes: 1024,
            width: 512,
            height: 512,
          },
        },
      ]
      await prepare(fixture)
      await expect(approval(fixture)).resolves.toBe('rejected')
      const content = fixture.providerOptions[0].messages[0].content
      expect(content.some((block: any) => block.type === 'image')).toBe(false)
      expect(content[0].text).toContain('[image omitted — reviewer cannot verify visual content]')
      expect(audits(fixture)[0]).toMatchObject({
        policyBlock: { visualOmission: true },
        images: { admitted: 0, omitted: 1, everAdmitted: 0 },
      })
    },
  )

  it('uses an explicit omission warning for a text-only reviewer route', async () => {
    const fixture = installFixture({
      inputModalities: ['text'],
      config: { imageMode: 'allow' },
    })
    fixture.messages[0].content = [
      { type: 'text', text: 'Inspect the screenshot before approving.' },
      {
        type: 'image',
        attachment: {
          attachmentId: 'image-1',
          mediaType: 'image/png',
          bytes: 1024,
          width: 512,
          height: 512,
        },
      },
    ]
    await prepare(fixture)
    await expect(approval(fixture)).resolves.toBe('rejected')
    const content = fixture.providerOptions[0].messages[0].content
    expect(content.filter((block: any) => block.type === 'image')).toHaveLength(0)
    expect(content[0].text).toContain('[image omitted — reviewer cannot verify visual content]')
    expect(audits(fixture)[0].images).toEqual({
      admitted: 0,
      omitted: 1,
      admittedBytes: 0,
      estimatedTokens: 0,
      everAdmitted: 0,
      everAdmittedBytes: 0,
      everEstimatedTokens: 0,
      imageBearingAttempts: 0,
      fallbackUsed: false,
    })
    expect(audits(fixture)[0].policyBlock).toEqual({ visualOmission: true })
  })

  it('fails closed when transcript selection omits an image-bearing entry', async () => {
    const fixture = installFixture({
      inputModalities: ['text', 'image'],
      config: { imageMode: 'allow', maxRecentEntries: 1 },
    })
    fixture.messages.push(
      {
        id: 'older-visual',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Older visual evidence.' },
          {
            type: 'image',
            attachment: {
              attachmentId: 'omitted-image',
              mediaType: 'image/png',
              bytes: 1024,
              width: 512,
              height: 512,
            },
          },
        ],
        source: { kind: 'model', provider: 'test-provider', model: 'test-model' },
      },
      {
        id: 'recent-assistant',
        role: 'assistant',
        content: [{ type: 'text', text: 'Most recent visible evidence.' }],
        source: { kind: 'model', provider: 'test-provider', model: 'test-model' },
      },
    )
    await prepare(fixture)
    await expect(approval(fixture)).resolves.toBe('rejected')
    expect(fixture.providerOptions[0].messages[0].content).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'image' })]),
    )
    expect(audits(fixture)[0]).toMatchObject({
      policyBlock: { visualOmission: true },
      images: { admitted: 0, omitted: 1, everAdmitted: 0 },
    })
  })

  it('drops visual context with a warning after an image-bearing attempt fails', async () => {
    const fixture = installFixture({
      inputModalities: ['text', 'image'],
      config: { imageMode: 'allow' },
      steps: [{ kind: 'throw' }, { kind: 'success' }],
    })
    fixture.messages[0].content = [
      { type: 'text', text: 'Inspect the screenshot before approving.' },
      {
        type: 'image',
        attachment: {
          attachmentId: 'image-1',
          mediaType: 'image/png',
          bytes: 1024,
          width: 512,
          height: 512,
        },
      },
    ]
    await prepare(fixture)
    await expect(approval(fixture)).resolves.toBe('rejected')
    expect(fixture.providerOptions[0].messages[0].content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'image' })]),
    )
    expect(fixture.providerOptions[1].messages[0].content).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'image' })]),
    )
    expect(fixture.providerOptions[1].messages[0].content[0].text).toContain(
      '[image omitted — reviewer cannot verify visual content]',
    )
    expect(audits(fixture)[0]).toMatchObject({
      attempts: 2,
      approvalOutcome: 'rejected',
      policyBlock: { visualFallback: true },
      images: {
        admitted: 0,
        omitted: 1,
        admittedBytes: 0,
        estimatedTokens: 0,
        everAdmitted: 1,
        everAdmittedBytes: 1024,
        everEstimatedTokens: 255,
        imageBearingAttempts: 1,
        fallbackUsed: true,
      },
    })
  })

  it('retains disclosure facts when one image-bearing attempt fails without fallback', async () => {
    const fixture = installFixture({
      inputModalities: ['text', 'image'],
      config: { imageMode: 'allow', maxAttempts: 1 },
      steps: [{ kind: 'throw' }],
    })
    fixture.messages[0].content.push({
      type: 'image',
      attachment: {
        attachmentId: 'image-1',
        mediaType: 'image/png',
        bytes: 1024,
        width: 512,
        height: 512,
      },
    })
    await prepare(fixture)
    await expect(approval(fixture)).resolves.toBe('unavailable')
    expect(audits(fixture)[0]).toMatchObject({
      attempts: 1,
      approvalOutcome: 'unavailable',
      images: {
        admitted: 1,
        omitted: 0,
        admittedBytes: 1024,
        everAdmitted: 1,
        everAdmittedBytes: 1024,
        everEstimatedTokens: 255,
        imageBearingAttempts: 1,
        fallbackUsed: false,
      },
    })
  })

  it('allows an explicitly authorized high-risk reversible action under the default policy', async () => {
    const fixture = installFixture({
      steps: [
        {
          kind: 'success',
          assessment:
            '{"risk_level":"high","user_authorization":"high","outcome":"allow","rationale":"The user explicitly requested this bounded external write."}',
        },
      ],
    })
    fixture.messages[0].content = [
      {
        type: 'text',
        text: 'Add an rm confirmation alias to my ~/.zshrc.',
      },
    ]
    await prepare(
      fixture,
      makeExecution(
        fixture.agent,
        'call-1',
        'printf "alias rm=\'rm -i\'\\n" >> /Users/alice/.zshrc',
      ),
    )
    await expect(approval(fixture)).resolves.toBe('allowed-once')
    const prompt = fixture.providerOptions[0].messages[0].content[0].text
    expect(prompt).toContain('Add an rm confirmation alias to my ~/.zshrc.')
    expect(prompt).toContain("alias rm='rm -i'")
    expect(prompt).toContain('/Users/<user>/.zshrc')
  })

  it('records a reviewer allow separately when a stricter local policy rejects it', async () => {
    const fixture = installFixture({
      config: { maxRisk: 'medium' },
      steps: [
        {
          kind: 'success',
          assessment:
            '{"risk_level":"high","user_authorization":"high","outcome":"allow","rationale":"The user explicitly requested the change."}',
        },
      ],
    })
    await prepare(fixture)
    await expect(approval(fixture)).resolves.toBe('rejected')
    expect(audits(fixture)[0]).toMatchObject({
      outcome: 'allow',
      approvalOutcome: 'rejected',
      policyBlock: { maxRisk: 'medium' },
    })
  })

  it('retries provider failure and merges usage across attempts', async () => {
    const fixture = installFixture({
      steps: [
        { kind: 'throw', usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3 } },
        { kind: 'success', usage: { inputTokens: 4, outputTokens: 5, reasoningTokens: 6 } },
      ],
    })
    await prepare(fixture)
    await expect(approval(fixture)).resolves.toBe('allowed-once')
    expect(fixture.calls).toBe(2)
    expect(audits(fixture)[0]).toMatchObject({
      attempts: 2,
      outcome: 'allow',
      approvalOutcome: 'allowed-once',
      usage: { inputTokens: 5, outputTokens: 7, cacheReadTokens: 3, reasoningTokens: 6 },
    })
  })

  it('returns unavailable after all attempts fail and records accumulated usage', async () => {
    const fixture = installFixture({
      config: { maxAttempts: 2 },
      steps: [
        { kind: 'throw', usage: { inputTokens: 1, outputTokens: 2 } },
        { kind: 'throw', usage: { inputTokens: 3, outputTokens: 4 } },
      ],
    })
    await prepare(fixture)
    await expect(approval(fixture)).resolves.toBe('unavailable')
    expect(fixture.calls).toBe(2)
    expect(audits(fixture)[0]).toMatchObject({
      outcome: 'deny',
      approvalOutcome: 'unavailable',
      attempts: 2,
      usage: { inputTokens: 4, outputTokens: 6 },
    })
  })

  it('enforces consecutive denial threshold and resets after an allow', async () => {
    const fixture = installFixture({
      config: { maxConsecutiveDenials: 2 },
      steps: [{ kind: 'success', assessment: deny }],
    })
    await prepare(fixture)
    await expect(approval(fixture)).resolves.toBe('rejected')
    await expect(approval(fixture)).resolves.toBe('rejected')
    expect(fixture.calls).toBe(2)
    await expect(approval(fixture)).resolves.toBe('rejected')
    expect(fixture.calls).toBe(2)

    const reset = installFixture({
      config: { maxConsecutiveDenials: 2 },
      steps: [
        { kind: 'success', assessment: deny },
        { kind: 'success', assessment: allow },
        { kind: 'success', assessment: deny },
      ],
    })
    await prepare(reset)
    await expect(approval(reset)).resolves.toBe('rejected')
    await expect(approval(reset)).resolves.toBe('allowed-once')
    await expect(approval(reset)).resolves.toBe('rejected')
    expect(reset.calls).toBe(3)
  })

  it('opens the failure circuit and records a circuit-open audit without calling provider', async () => {
    const fixture = installFixture({
      config: { maxConsecutiveFailures: 1, failureCooldownMs: 10_000 },
      steps: [{ kind: 'throw' }],
    })
    await prepare(fixture)
    await expect(approval(fixture)).resolves.toBe('unavailable')
    await expect(approval(fixture)).resolves.toBe('unavailable')
    expect(fixture.calls).toBe(2)
    expect(audits(fixture)).toHaveLength(2)
    expect(audits(fixture)[1]).toMatchObject({
      attempts: 0,
      durationMs: 0,
      outcome: 'deny',
      approvalOutcome: 'unavailable',
      risk: 'high',
      authorization: 'unknown',
    })
  })

  it('returns cancelled on caller abort and closes the visible review lifecycle', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fixture = installFixture({
      steps: [{ kind: 'wait', gate }],
      inputModalities: ['text', 'image'],
      config: { imageMode: 'allow' },
    })
    fixture.messages[0].content.push({
      type: 'image',
      attachment: {
        attachmentId: 'cancelled-image',
        mediaType: 'image/png',
        bytes: 1024,
        width: 512,
        height: 512,
      },
    })
    const controller = new AbortController()
    await prepare(fixture)
    const pending = approval(fixture, makeRequest(fixture.agent, 'call-1', controller.signal))
    controller.abort()
    release()
    await expect(pending).resolves.toBe('cancelled')
    expect(fixture.calls).toBe(1)
    expect(starts(fixture)).toHaveLength(1)
    expect(audits(fixture)).toHaveLength(1)
    expect(audits(fixture)[0]).toMatchObject({
      reviewId: (starts(fixture)[0] as { reviewId: string }).reviewId,
      outcome: 'deny',
      approvalOutcome: 'cancelled',
      rationale: 'Reviewer request was cancelled.',
      images: {
        admitted: 1,
        admittedBytes: 1024,
        everAdmitted: 1,
        everAdmittedBytes: 1024,
        everEstimatedTokens: 255,
        imageBearingAttempts: 1,
        fallbackUsed: false,
      },
    })
  })

  it('classifies a provider stalled until the end-to-end deadline as one timeout attempt', async () => {
    const fixture = installFixture({
      config: { timeoutMs: 10 },
      steps: [{ kind: 'wait-for-abort' }],
    })
    await prepare(fixture)
    await expect(approval(fixture)).resolves.toBe('unavailable')
    expect(fixture.calls).toBe(1)
    expect(audits(fixture)[0]).toMatchObject({
      approvalOutcome: 'unavailable',
      attempts: 1,
      rationale: 'Reviewer unavailable: timeout',
    })
  })

  it('single-flights concurrent approvals for the same call', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fixture = installFixture({ steps: [{ kind: 'wait', gate }] })
    await prepare(fixture)
    const first = approval(fixture)
    const second = approval(fixture)
    await Promise.resolve()
    expect(fixture.calls).toBe(1)
    release()
    await expect(Promise.all([first, second])).resolves.toEqual(['allowed-once', 'allowed-once'])
    expect(fixture.calls).toBe(1)
  })

  it('removes a pending execution when tools/result arrives', async () => {
    const fixture = installFixture()
    await prepare(fixture)
    await fixture.handlers.get('tools/result')!(fixture.execution)
    await expect(approval(fixture)).resolves.toBe('unavailable')
    expect(fixture.calls).toBe(0)
  })

  it('redacts adversarial credentials from provider prompt and audit fields', async () => {
    const fixture = installFixture({
      steps: [
        {
          kind: 'success',
          assessment:
            '{"risk_level":"low","user_authorization":"high","outcome":"allow","rationale":"token=sk-proj_SECRET"}',
        },
      ],
    })
    fixture.request.reason = 'authorization: Bearer live-secret password="pw" github_pat_ABC123'
    fixture.execution.arguments = {
      command: 'echo token=ghp_ABC123 access_token: live-token /Users/alice/private-repo',
    }
    await prepare(fixture)
    await expect(approval(fixture)).resolves.toBe('allowed-once')
    const prompt = JSON.stringify(fixture.providerOptions[0])
    const audit = JSON.stringify(audits(fixture)[0])
    const start = JSON.stringify(starts(fixture)[0])
    for (const secret of [
      'sk-proj_SECRET',
      'live-secret',
      'pw',
      'github_pat_ABC123',
      'ghp_ABC123',
      'live-token',
      '/Users/alice',
    ]) {
      expect(prompt).not.toContain(secret)
      expect(audit).not.toContain(secret)
      expect(start).not.toContain(secret)
    }
    expect(prompt).toContain('<redacted>')
    expect(audit).toContain('/Users/<user>')
  })
})

describe('configuration numeric boundaries', () => {
  const numericKeys = [
    'timeoutMs',
    'maxInputBytes',
    'maxOutputTokens',
    'maxMessageTokens',
    'maxToolTokens',
    'maxEntryTokens',
    'maxRecentEntries',
    'maxImageTokens',
    'maxImages',
    'maxImageBytes',
    'maxAttempts',
    'maxConsecutiveDenials',
    'maxConsecutiveFailures',
    'failureCooldownMs',
  ] as const

  it.each(numericKeys)('rejects non-positive or fractional %s', (key) => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => resolveConfig({ provider: 'p', model: 'm', [key]: value } as any)).toThrow()
    }
  })

  it('rejects timer values above the runtime timer maximum but accepts the boundary', () => {
    expect(() =>
      resolveConfig({ provider: 'p', model: 'm', timeoutMs: MAX_TIMER_DELAY_MS + 1 } as any),
    ).toThrow()
    expect(() =>
      resolveConfig({
        provider: 'p',
        model: 'm',
        failureCooldownMs: MAX_TIMER_DELAY_MS + 1,
      } as any),
    ).toThrow()
    expect(
      resolveConfig({
        provider: 'p',
        model: 'm',
        timeoutMs: MAX_TIMER_DELAY_MS,
        failureCooldownMs: MAX_TIMER_DELAY_MS,
      } as any),
    ).toMatchObject({ timeoutMs: MAX_TIMER_DELAY_MS, failureCooldownMs: MAX_TIMER_DELAY_MS })
  })
})
