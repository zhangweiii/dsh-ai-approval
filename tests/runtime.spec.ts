import { describe, expect, it } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import apply from '../src/index.ts'

type Handler = (...args: any[]) => any

type ReviewerRoute = {
  provider: string
  model: string
  reasoningEffort?: string
}

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
    callId: CallId('call-1'),
    name: 'shell',
    arguments: { command: 'echo hello' },
  } as unknown as ToolExecution
  const request = {
    agent,
    toolName: 'shell',
    callId: CallId('call-1'),
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
  const scope: any = {
    llm: { stream },
    permissionPresets: { current: () => 'ai-approval' },
    systemPrompt: { context: () => undefined },
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler)
    },
    emit: (event: string, _session: unknown, data: unknown) => {
      if (event.startsWith('ai-approval/review')) reviewEvents.push({ type: event, data })
    },
    inject: (_dependencies: unknown, callback: (scope: any) => void) => {
      callback(scope)
    },
  }
  let activeRoute = settingsRoute
  const settingsScope = {
    get: () => activeRoute,
    watch: () => () => undefined,
  }
  const settings = {
    register: (_ns: string, _schema: unknown, options: { base: ReviewerRoute }) => {
      activeRoute ??= options.base
      return settingsScope
    },
  }
  const context = {
    inject: (dependencies: string[], callback: (scope: any) => void) => {
      callback(
        dependencies.includes('settings') ? { ...scope, settings, effect: () => undefined } : scope,
      )
    },
  } as unknown as Context
  apply(context, { provider: 'local', model: 'reviewer' })
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

    await preExecute!(fixture.execution, async () => 'ask')
    await expect(approvalRequest!(fixture.request, async () => 'rejected')).resolves.toBe(
      'allowed-once',
    )

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
    expect(fixture.appended).toEqual([])
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
