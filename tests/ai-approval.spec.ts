import { describe, expect, it } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  buildReviewPrompt,
  canAutoApprove,
  parseAssessment,
  redactSensitiveText,
  resolveConfig,
} from '../src/index.ts'
import { REVIEW_SYSTEM_PROMPT } from '../src/reviewer-model.ts'
import { AI_APPROVAL_SYSTEM_CONTEXT } from '../src/plugin.ts'

function requestAndExecution(
  messages: readonly Message[] = [
    {
      id: 'message-1',
      role: 'user',
      content: [{ type: 'text', text: 'Please inspect the repository.' }],
      source: { kind: 'user' },
    },
  ] as unknown as Message[],
  cwd = '/workspace',
): { request: ApprovalRequest; execution: Readonly<ToolExecution> } {
  const session = {
    header: { id: 'session-1', cwd },
    deriveMessages: () => [...messages],
  }
  const agent = { session } as unknown as Agent
  const request = {
    agent,
    toolName: 'shell',
    callId: CallId('call-1'),
    reason: 'The command needs network access.',
  } satisfies ApprovalRequest
  const execution = {
    agent,
    callId: CallId('call-1'),
    name: 'shell',
    arguments: { command: 'gh repo view private/repo' },
  } as unknown as Readonly<ToolExecution>
  return { request, execution }
}

describe('approval reviewer policy helpers', () => {
  it('requires the configured authorization threshold and risk before allowing', () => {
    expect(
      canAutoApprove(
        { risk: 'low', authorization: 'high', outcome: 'allow', rationale: 'needed' },
        'low',
      ),
    ).toBe(true)
    expect(
      canAutoApprove(
        { risk: 'medium', authorization: 'high', outcome: 'allow', rationale: 'needed' },
        'low',
      ),
    ).toBe(false)
    expect(
      canAutoApprove(
        { risk: 'low', authorization: 'unknown', outcome: 'allow', rationale: 'needed' },
        'low',
      ),
    ).toBe(false)
    expect(
      canAutoApprove(
        { risk: 'low', authorization: 'medium', outcome: 'allow', rationale: 'needed' },
        'low',
      ),
    ).toBe(false)
    expect(
      canAutoApprove(
        { risk: 'low', authorization: 'medium', outcome: 'allow', rationale: 'needed' },
        'low',
        'medium',
      ),
    ).toBe(true)
    expect(
      canAutoApprove(
        { risk: 'low', authorization: 'high', outcome: 'deny', rationale: 'unsafe' },
        'medium',
      ),
    ).toBe(false)
    expect(
      canAutoApprove(
        { risk: 'high', authorization: 'high', outcome: 'allow', rationale: 'authorized' },
        'high',
      ),
    ).toBe(true)
    expect(
      canAutoApprove(
        { risk: 'critical', authorization: 'high', outcome: 'allow', rationale: 'unsafe' },
        'high',
      ),
    ).toBe(false)
  })

  it('parses provider JSON and rejects malformed decisions', () => {
    expect(
      parseAssessment(
        '```json\n{"risk_level":"low","user_authorization":"high","outcome":"allow","rationale":"necessary"}\n```',
      ),
    ).toEqual({
      risk: 'low',
      authorization: 'high',
      outcome: 'allow',
      rationale: 'necessary',
    })
    expect(() =>
      parseAssessment(
        '{"risk_level":"low","user_authorization":"high","outcome":"maybe","rationale":"invalid"}',
      ),
    ).toThrow(/outcome must be allow or deny/)
    expect(() => parseAssessment('{"outcome":"allow"}')).toThrow(/missing risk_level/)
    expect(() =>
      parseAssessment(
        '{"risk_level":"low","user_authorization":"high","outcome":"allow","rationale":"ok","extra":true}',
      ),
    ).toThrow(/unknown field/)
    expect(() => parseAssessment('not json')).toThrow(/no JSON object/)
  })

  it('redacts credentials without knowing a command vocabulary', () => {
    expect(redactSensitiveText('token=abc123 ghp_ignored gho-live')).toBe(
      'token=<redacted> ghp_<redacted> gho-<redacted>',
    )
    const redacted = redactSensitiveText(
      '{"token":"abc123","authorization":"Bearer live-token","password":"pw"}',
    )
    expect(redacted).toBe(
      '{"token": "<redacted>","authorization": "<redacted>","password": "<redacted>"}',
    )
  })

  it('validates and freezes the reviewer route', () => {
    const config = resolveConfig({ provider: 'local', model: 'qwen' })
    expect(config).toMatchObject({
      provider: 'local',
      model: 'qwen',
      maxRisk: 'high',
      minAuthorization: 'high',
      contextMode: 'bounded',
      redactPaths: true,
      sendSessionId: false,
      timeoutMs: 60_000,
      maxConsecutiveFailures: 3,
      failureCooldownMs: 30_000,
    })
    expect(Object.isFrozen(config)).toBe(true)
    expect(() => resolveConfig({ provider: 'local', model: 'qwen', timeoutMs: 0 })).toThrow(
      /positive integer/,
    )
    expect(
      resolveConfig({ provider: 'local', model: 'qwen', reasoningEffort: 'off' }),
    ).toMatchObject({ reasoningEffort: 'off' })
    expect(resolveConfig({ provider: 'local', model: 'qwen', maxRisk: 'high' })).toMatchObject({
      maxRisk: 'high',
    })
    expect(() => resolveConfig({ provider: 'local', model: 'qwen', reasoningEffort: '' })).toThrow(
      /reasoningEffort must be non-empty/,
    )
  })

  it('uses a Codex-like boundary-review policy', () => {
    expect(REVIEW_SYSTEM_PROMPT).toContain('direct user messages explicitly authorize')
    expect(REVIEW_SYSTEM_PROMPT).toContain('Do not deny solely because')
    expect(REVIEW_SYSTEM_PROMPT).toContain('broad or persistent security weakening')
    expect(REVIEW_SYSTEM_PROMPT).toContain('significant risk of irreversible damage')
    expect(AI_APPROVAL_SYSTEM_CONTEXT).toContain('do not retry it through a workaround')
    expect(AI_APPROVAL_SYSTEM_CONTEXT).toContain('initial tool call')
  })

  it('includes exact action and bounded history in the reviewer context', () => {
    const { request, execution } = requestAndExecution()
    const options = {
      maxMessageTokens: 256,
      maxToolTokens: 256,
      maxEntryTokens: 64,
      maxRecentEntries: 4,
      contextMode: 'bounded' as const,
    }
    const prompt = buildReviewPrompt(request, execution, { ...options, maxInputBytes: 2_000 })
    expect(prompt).toContain('Exact action awaiting approval')
    expect(prompt).toContain('gh repo view private/repo')
    expect(prompt).toContain('Please inspect the repository.')
    const smallPrompt = buildReviewPrompt(request, execution, {
      ...options,
      maxInputBytes: 256,
    })
    expect(smallPrompt).toContain('gh repo view private/repo')
    expect(smallPrompt).toContain('Some transcript entries were omitted or truncated.')
  })

  it('keeps the first and latest user tasks while budgeting tool evidence separately', () => {
    const messages = [
      {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'Original task: inspect and repair the release script.' }],
        source: { kind: 'user' },
      },
      {
        id: 'm2',
        role: 'assistant',
        content: [{ type: 'text', text: 'I inspected the repository.' }],
        source: { kind: 'model', provider: 'test', model: 'test' },
      },
      {
        id: 'm3',
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Latest instruction: only update the script, do not publish.',
          },
        ],
        source: { kind: 'user' },
      },
      {
        id: 'm4',
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            id: CallId('tool-1'),
            name: 'shell',
            arguments: '{"command":"git status"}',
          },
        ],
        source: { kind: 'model', provider: 'test', model: 'test' },
      },
      {
        id: 'm5',
        role: 'user',
        content: [
          {
            type: 'tool-result',
            toolCallId: CallId('tool-1'),
            content: [{ type: 'text', text: 'clean' }],
          },
        ],
        source: { kind: 'tool', callId: CallId('tool-1') },
      },
    ] as unknown as Message[]
    const { request, execution } = requestAndExecution(messages)
    const prompt = buildReviewPrompt(request, execution, {
      maxMessageTokens: 128,
      maxToolTokens: 128,
      maxEntryTokens: 64,
      maxRecentEntries: 2,
      maxInputBytes: 4_000,
      contextMode: 'bounded',
    })
    expect(prompt).toContain('Original task: inspect and repair')
    expect(prompt).toContain('Latest instruction: only update')
    expect(prompt).toContain('tool call shell')
    expect(prompt).toContain('tool result')
  })

  it('does not treat plugin context as a direct user anchor', () => {
    const messages = [
      {
        id: 'context',
        role: 'user',
        content: [{ type: 'text', text: 'Injected runtime context.' }],
        source: { kind: 'plugin', plugin: 'runtime' },
      },
      {
        id: 'user',
        role: 'user',
        content: [{ type: 'text', text: 'The actual user task.' }],
        source: { kind: 'user' },
      },
    ] as unknown as Message[]
    const { request, execution } = requestAndExecution(messages)
    const prompt = buildReviewPrompt(request, execution, {
      maxMessageTokens: 256,
      maxToolTokens: 256,
      maxEntryTokens: 64,
      maxRecentEntries: 0,
      maxInputBytes: 2_000,
      contextMode: 'bounded',
    })
    expect(prompt).toContain('The actual user task.')
    expect(prompt).not.toContain('Injected runtime context.')
  })

  it('supports action-only context and masks local usernames', () => {
    const messages = [
      {
        id: 'private-user',
        role: 'user',
        content: [{ type: 'text', text: 'Private task context must not be sent.' }],
        source: { kind: 'user' },
      },
    ] as unknown as Message[]
    const { request, execution } = requestAndExecution(messages, '/Users/alice/private-repo')
    const privateExecution = {
      ...execution,
      arguments: { command: 'cat /Users/alice/private-repo/.env' },
    } as Readonly<ToolExecution>
    const prompt = buildReviewPrompt(request, privateExecution, {
      maxMessageTokens: 256,
      maxToolTokens: 256,
      maxEntryTokens: 64,
      maxRecentEntries: 4,
      maxInputBytes: 2_000,
      contextMode: 'action-only',
      redactPaths: true,
    })
    expect(prompt).not.toContain('Private task context must not be sent.')
    expect(prompt).toContain('<session context omitted by privacy policy>')
    expect(prompt).toContain('/Users/<user>/private-repo')
    expect(prompt).not.toContain('/Users/alice')
  })
})
