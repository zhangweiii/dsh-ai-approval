import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.ts'

type Handler = (...args: any[]) => any

type ReviewerRoute = {
  provider: string
  model: string
  reasoningEffort?: string
}

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

function installFixture(settingsRoute?: ReviewerRoute) {
  const handlers = new Map<string, Handler>()
  const providerOptions: unknown[] = []
  const appended: Array<{ type: string; data: unknown }> = []
  const reviewEvents: Array<{ type: string; data: any }> = []
  const session = {
    header: { id: 'session-1', cwd: '/Users/alice/private-repo' },
    events: [],
    deriveMessages: () => [
      {
        id: 'message-1',
        role: 'user',
        content: [{ type: 'text', text: 'Inspect the private repository.' }],
        source: { kind: 'user' },
      },
    ],
    append: (type: string, data: unknown) => {
      appended.push({ type, data })
    },
  }
  const agent = { session } as unknown as Agent
  const execution = {
    agent,
    callId: ToolCallId('call-1'),
    name: 'shell',
    arguments: { command: 'echo hello' },
  } as unknown as ToolExecution
  const request = {
    agent,
    toolName: 'shell',
    callId: ToolCallId('call-1'),
    reason: 'The command needs a wider capability.',
  } satisfies ApprovalRequest
  const stream = async function* (options: unknown) {
    providerOptions.push(options)
    yield {
      type: 'text-delta',
      index: 0,
      text: '{"risk_level":"low","user_authorization":"high","outcome":"allow","rationale":"The user requested this read-only check."}',
    }
    yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 7 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const prepareCall = async (config: Record<string, unknown>) => ({
    config,
    inputModalities: ['text'],
    stream,
  })
  const scope: any = {
    llm: { prepareCall, stream },
    permissionPresets: { current: () => 'ai-approval' },
    systemPrompt: { context: () => undefined },
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler)
    },
    emit: (event: string, _session: unknown, data: unknown) => {
      if (event.startsWith('ai-approval/review')) reviewEvents.push({ type: event, data })
    },
    effect: (setup: () => unknown) => setup(),
    inject: (_dependencies: unknown, callback: (scope: any) => void) => {
      callback(scope)
    },
  }
  let activeRoute: ReviewerRoute = settingsRoute ?? { provider: 'local', model: 'reviewer' }
  // DSH 0.1.7 has no settings namespace registration: the route fields are live
  // `volatile()` references on the plugin Config, and a write goes through the
  // configuration editor against the owning profile entry.
  const liveRoute = () => ({ ...activeRoute })
  const liveConfig = {
    presetName: 'ai-approval',
    provider: { get: () => liveRoute().provider },
    model: { get: () => liveRoute().model },
    reasoningEffort: { get: () => liveRoute().reasoningEffort },
    imageMode: { get: () => liveRoute().imageMode },
  }
  const settings = {
    writable: true,
    configure: () => () => undefined,
    update: async () => undefined,
  }
  const configEditor = {
    edit: async (
      _entry: unknown,
      change: (current: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      change({})
    },
  }
  const context = {
    inject: (dependencies: string[], callback: (scope: any) => void) => {
      const injected = { ...scope, effect: () => undefined }
      if (dependencies.includes('settings')) {
        injected.settings = settings
        injected.configEditor = configEditor
        injected.fiber = { entry: { options: { id: 'dsh-ai-approval' } } }
      }
      callback(injected)
    },
  } as unknown as Context
  apply(context, liveConfig as never)
  return {
    handlers,
    providerOptions,
    appended,
    reviewEvents,
    execution,
    request,
    selectRoute: (route: ReviewerRoute) => {
      activeRoute = route
    },
  }
}

describe('approval reviewer runtime', () => {
  it('correlates the pending execution and records privacy-safe usage metrics', async () => {
    const fixture = installFixture()
    const preExecute = fixture.handlers.get('tools/pre-execute')
    const approvalRequest = fixture.handlers.get('approval/request')
    expect(preExecute).toBeDefined()
    expect(approvalRequest).toBeDefined()
    expect(fixture.handlers.get('tools/post-execute')).toBeUndefined()

    await preExecute!(fixture.execution, async () => 'ask')
    await expect(approvalRequest!(fixture.request, async () => 'rejected')).resolves.toBe(
      'allowed-once',
    )
    expect(fixture.appended).toHaveLength(2)
    expect(fixture.appended[0]).toMatchObject({
      type: 'command/run',
      data: {
        commandId: expect.stringMatching(/^ai-approval-/),
        name: 'ai-approval',
        source: { kind: 'dsh-ai-approval' },
      },
    })
    expect(fixture.appended[1]).toMatchObject({
      type: 'command/done',
      data: {
        commandId: (fixture.appended[0]!.data as { commandId: string }).commandId,
        kind: 'success',
        text: expect.stringMatching(
          /AI 审批：通过（仅本次）｜危险级别：low｜授权判断：high[\s\S]*原因：The user requested this read-only check\./,
        ),
      },
    })
    expect(standardOutput).toEqual([])

    const options = fixture.providerOptions[0] as {
      sessionId?: string
      messages: Array<{ content: Array<{ text: string }> }>
    }
    expect(options.sessionId).toBeUndefined()
    expect(options.messages[0]?.content[0]?.text).toContain('Inspect the private repository.')
    expect(options.messages[0]?.content[0]?.text).toContain('/Users/<user>/private-repo')
    expect(options.messages[0]?.content[0]?.text).not.toContain('/Users/alice')

    const event = fixture.reviewEvents.find((item) => item.type === 'ai-approval/reviewed')
    const started = fixture.reviewEvents.find((item) => item.type === 'ai-approval/review-started')
    expect(fixture.reviewEvents.map((item) => item.type)).toEqual([
      'ai-approval/review-started',
      'ai-approval/reviewed',
    ])
    expect(started?.data).toMatchObject({
      toolName: 'shell',
      reason: 'The command needs a wider capability.',
      provider: 'local',
      model: 'reviewer',
    })
    expect(event?.data).toMatchObject({
      reviewId: (started?.data as { reviewId: string }).reviewId,
      cwd: '/Users/<user>/private-repo',
      approvalOutcome: 'allowed-once',
      attempts: 1,
      usage: { inputTokens: 12, outputTokens: 7 },
    })
  })

  it('uses the live DSH settings route and freezes it for one review', async () => {
    const fixture = installFixture({
      provider: 'openai',
      model: 'gpt-5.2',
      reasoningEffort: 'medium',
    })
    const preExecute = fixture.handlers.get('tools/pre-execute')!
    const approvalRequest = fixture.handlers.get('approval/request')!
    await preExecute(fixture.execution, async () => 'ask')
    await expect(approvalRequest(fixture.request, async () => 'rejected')).resolves.toBe(
      'allowed-once',
    )

    expect(fixture.providerOptions[0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-5.2',
      reasoningEffort: 'medium',
    })
    expect(fixture.reviewEvents.at(-1)?.data).toMatchObject({
      provider: 'openai',
      model: 'gpt-5.2',
      reasoningEffort: 'medium',
    })
  })
})

describe('plugin module shape', () => {
  it('exposes the Config schema on the module the loader resolves', async () => {
    // DSH 0.1.7's Loader normalizes a plugin module to `exports.default ?? exports`
    // and the settings form reads `entry.fiber.runtime.Config`. A default export
    // therefore shadows Config and silently removes the reviewer Settings page.
    const module = await import('../src/index.ts')
    expect(module.default).toBeUndefined()
    expect(typeof module.apply).toBe('function')
    expect(module.apply).toBe(module.apply)
    const resolved = module.default ?? module
    expect(resolved.Config).toBe(module.Config)
    expect(typeof resolved.Config?.toJSON).toBe('function')
  })
})
