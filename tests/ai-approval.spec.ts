import { describe, expect, it } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  buildReviewContext,
  buildReviewPrompt,
  canAutoApprove,
  parseAssessment,
  redactSensitiveText,
  REVIEW_IMAGE_OMITTED_TEXT,
  resolveConfig,
  resolveReviewerRoute,
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

    const credentialUrl = [
      'postgres://',
      'alice',
      ':',
      'database-password',
      '@db.example/app',
    ].join('')
    const basicAuth = `curl --user ${'alice'}:${'basic-password'} https://example.test`
    const compactBasicAuth = [
      'curl -u',
      'alice',
      ':',
      'compact-password',
      ' https://example.test',
    ].join('')
    const basicHeader = Buffer.from(['http-user', 'http-password'].join(':')).toString('base64')
    const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'signature0123456789'].join(
      '.',
    )
    const googleKey = `AIza${'A'.repeat(35)}`
    const variants = redactSensitiveText(
      [
        'authorization=Bearer equals-secret',
        credentialUrl,
        basicAuth,
        compactBasicAuth,
        `Authorization: Basic ${basicHeader}`,
        `Proxy-Authorization=Basic ${basicHeader}`,
        JSON.stringify({ 'Proxy-Authorization': `Basic ${basicHeader}` }),
        `Basic ${basicHeader}`,
        'Cookie: SID=primary-secret; secondary=secondary-secret',
        `<password>${'xml-secret'}</password>`,
        jwt,
        googleKey,
      ].join('\n'),
    )
    for (const secret of [
      'equals-secret',
      'database-password',
      'basic-password',
      'compact-password',
      'http-password',
      basicHeader,
      'primary-secret',
      'secondary-secret',
      'xml-secret',
      jwt,
      googleKey,
    ]) {
      expect(variants).not.toContain(secret)
    }
    expect(redactSensitiveText(variants)).toBe(variants)

    const action =
      "curl -H 'Cookie: SID=cookie-primary; secondary=cookie-secondary' https://target.test && echo suffix-action"
    const redactedAction = redactSensitiveText(action)
    expect(redactedAction).not.toContain('cookie-primary')
    expect(redactedAction).not.toContain('cookie-secondary')
    expect(redactedAction).toMatch(/'Cookie:\s*<redacted>'/)
    expect(redactedAction).toContain('https://target.test && echo suffix-action')
    expect(redactSensitiveText(redactedAction)).toBe(redactedAction)
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
      imageMode: 'omit',
      maxImageTokens: 10_000,
      maxImages: 8,
      maxImageBytes: 16_777_216,
    })
    expect(Object.isFrozen(config)).toBe(true)
    expect(() => resolveConfig({ provider: 'local', model: 'qwen', timeoutMs: 0 })).toThrow(
      /positive integer/,
    )
    expect(
      resolveConfig({ provider: 'local', model: 'qwen', reasoningEffort: 'off' }),
    ).toMatchObject({ reasoningEffort: 'off' })
    expect(
      resolveReviewerRoute({ provider: 'local', model: 'qwen', reasoningEffort: null }),
    ).toEqual({ provider: 'local', model: 'qwen', imageMode: 'omit' })
    expect(resolveConfig({ provider: 'local', model: 'qwen', maxRisk: 'high' })).toMatchObject({
      maxRisk: 'high',
    })
    expect(() => resolveConfig({ provider: 'local', model: 'qwen', reasoningEffort: '' })).toThrow(
      /reasoningEffort must be non-empty/,
    )
    expect(() =>
      resolveConfig({ provider: 'local', model: 'qwen', imageMode: 'unexpected' as never }),
    ).toThrow(/invalid policy configuration/)
  })

  it('uses a Codex-like boundary-review policy', () => {
    expect(REVIEW_SYSTEM_PROMPT).toContain('direct user messages explicitly authorize')
    expect(REVIEW_SYSTEM_PROMPT).toContain('Do not deny solely because')
    expect(REVIEW_SYSTEM_PROMPT).toContain('broad or persistent security weakening')
    expect(REVIEW_SYSTEM_PROMPT).toContain('significant risk of irreversible damage')
    expect(REVIEW_SYSTEM_PROMPT).toContain('image-omitted marker')
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
    expect(() =>
      buildReviewPrompt(request, execution, {
        ...options,
        maxInputBytes: 256,
      }),
    ).toThrow(/input exceeds maxInputBytes/)

    const oversizedExecution = {
      ...execution,
      arguments: { command: 'x'.repeat(100_000) },
    } as unknown as Readonly<ToolExecution>
    expect(() =>
      buildReviewPrompt(request, oversizedExecution, {
        ...options,
        maxInputBytes: 2_000,
      }),
    ).toThrow(/input exceeds maxInputBytes/)
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

  it('admits only declared visual context within the image budget and deduplicates refs', () => {
    const image = (attachmentId: string) => ({
      type: 'image',
      attachment: {
        attachmentId,
        mediaType: 'image/png',
        bytes: 1024,
        width: 512,
        height: 512,
      },
    })
    const first = image('image-1')
    const latest = image('image-2')
    const messages = [
      {
        id: 'visual-1',
        role: 'user',
        content: [{ type: 'text', text: 'Inspect the first screenshot.' }, first],
        source: { kind: 'user' },
      },
      {
        id: 'visual-2',
        role: 'user',
        content: [
          { type: 'text', text: 'Use the latest screenshot.' },
          latest,
          {
            type: 'tool-result',
            toolCallId: CallId('visual-tool'),
            content: [latest],
          },
        ],
        source: { kind: 'user' },
      },
    ] as unknown as Message[]
    const { request, execution } = requestAndExecution(messages)
    const context = buildReviewContext(request, execution, {
      maxMessageTokens: 512,
      maxToolTokens: 512,
      maxEntryTokens: 256,
      maxRecentEntries: 4,
      maxInputBytes: 4_000,
      contextMode: 'bounded',
      admitImages: true,
      maxImageTokens: 300,
    })
    expect(context.images).toHaveLength(1)
    expect(String(context.images[0]?.attachment.attachmentId)).toBe('image-2')
    expect(context.imageStats).toEqual({
      admitted: 1,
      omitted: 1,
      admittedBytes: 1024,
      estimatedTokens: 255,
    })
    expect(context.text).toContain('[image 1 attached for reviewer inspection]')
    expect(context.text).toContain('[image omitted — reviewer cannot verify visual content]')
    expect(context.text).not.toContain('attachmentId')
  })

  it('keeps visual content text-only when image admission is unavailable', () => {
    const messages = [
      {
        id: 'visual',
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect this screenshot.' },
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
        ],
        source: { kind: 'user' },
      },
    ] as unknown as Message[]
    const { request, execution } = requestAndExecution(messages)
    const context = buildReviewContext(request, execution, {
      maxMessageTokens: 512,
      maxToolTokens: 512,
      maxEntryTokens: 256,
      maxRecentEntries: 4,
      maxInputBytes: 4_000,
      contextMode: 'bounded',
      admitImages: false,
    })
    expect(context.images).toEqual([])
    expect(context.imageStats).toEqual({
      admitted: 0,
      omitted: 1,
      admittedBytes: 0,
      estimatedTokens: 0,
    })
    expect(context.text).toContain('visual content is unverifiable')
  })

  it('bounds image count and bytes and omits conflicting duplicate metadata', () => {
    const image = (attachmentId: string, bytes: number, width = 512) => ({
      type: 'image',
      attachment: {
        attachmentId,
        mediaType: 'image/png',
        bytes,
        width,
        height: 512,
      },
    })
    const messages = [
      {
        id: 'visual-bounds',
        role: 'user',
        content: [
          { type: 'text', text: 'Compare these screenshots.' },
          image('conflict', 500),
          image('older', 1000),
          image('conflict', 500, 256),
          image('newer', 1000),
        ],
        source: { kind: 'user' },
      },
    ] as unknown as Message[]
    const { request, execution } = requestAndExecution(messages)
    const context = buildReviewContext(request, execution, {
      maxMessageTokens: 512,
      maxToolTokens: 512,
      maxEntryTokens: 256,
      maxRecentEntries: 4,
      maxInputBytes: 4_000,
      contextMode: 'bounded',
      admitImages: true,
      maxImageTokens: 10_000,
      maxImages: 1,
      maxImageBytes: 1500,
    })
    expect(context.images.map((block) => String(block.attachment.attachmentId))).toEqual(['newer'])
    expect(context.imageStats).toEqual({
      admitted: 1,
      omitted: 2,
      admittedBytes: 1000,
      estimatedTokens: 255,
    })
  })

  it('counts visual evidence from transcript entries omitted by selection budgets', () => {
    const messages = [
      {
        id: 'user-anchor',
        role: 'user',
        content: [{ type: 'text', text: 'Inspect the repository.' }],
        source: { kind: 'user' },
      },
      {
        id: 'omitted-visual',
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
        source: { kind: 'model', provider: 'test', model: 'test' },
      },
      {
        id: 'recent-assistant',
        role: 'assistant',
        content: [{ type: 'text', text: 'Most recent visible evidence.' }],
        source: { kind: 'model', provider: 'test', model: 'test' },
      },
    ] as unknown as Message[]
    const { request, execution } = requestAndExecution(messages)
    const context = buildReviewContext(request, execution, {
      maxMessageTokens: 512,
      maxToolTokens: 512,
      maxEntryTokens: 256,
      maxRecentEntries: 1,
      maxInputBytes: 4_000,
      contextMode: 'bounded',
      admitImages: true,
      maxImageTokens: 10_000,
    })
    expect(context.images).toEqual([])
    expect(context.imageStats).toEqual({
      admitted: 0,
      omitted: 1,
      admittedBytes: 0,
      estimatedTokens: 0,
    })
    expect(context.text).toContain(REVIEW_IMAGE_OMITTED_TEXT)
  })

  it('keeps an index marker for admitted images when entry text is truncated', () => {
    const messages = [
      {
        id: 'truncated-visual',
        role: 'user',
        content: [
          { type: 'text', text: 'A'.repeat(200) },
          {
            type: 'image',
            attachment: {
              attachmentId: 'indexed-image',
              mediaType: 'image/png',
              bytes: 1024,
              width: 512,
              height: 512,
            },
          },
          { type: 'text', text: 'B'.repeat(200) },
        ],
        source: { kind: 'user' },
      },
    ] as unknown as Message[]
    const { request, execution } = requestAndExecution(messages)
    const context = buildReviewContext(request, execution, {
      maxMessageTokens: 512,
      maxToolTokens: 512,
      maxEntryTokens: 16,
      maxRecentEntries: 1,
      maxInputBytes: 4_000,
      contextMode: 'bounded',
      admitImages: true,
      maxImageTokens: 10_000,
    })
    expect(context.images).toHaveLength(1)
    expect(context.text).toContain('[image 1 attached for reviewer inspection]')
  })

  it('supports action-only context and masks local usernames', () => {
    const messages = [
      {
        id: 'private-user',
        role: 'user',
        content: [
          { type: 'text', text: 'Private task context must not be sent.' },
          {
            type: 'image',
            attachment: {
              attachmentId: 'private-image',
              mediaType: 'image/png',
              bytes: 1024,
              width: 512,
              height: 512,
            },
          },
        ],
        source: { kind: 'user' },
      },
    ] as unknown as Message[]
    const { request, execution } = requestAndExecution(messages, '/Users/alice/private-repo')
    const privateExecution = {
      ...execution,
      arguments: { command: 'cat /Users/alice/private-repo/.env' },
    } as Readonly<ToolExecution>
    const context = buildReviewContext(request, privateExecution, {
      maxMessageTokens: 256,
      maxToolTokens: 256,
      maxEntryTokens: 64,
      maxRecentEntries: 4,
      maxInputBytes: 2_000,
      contextMode: 'action-only',
      redactPaths: true,
      admitImages: true,
    })
    const prompt = context.text
    expect(prompt).not.toContain('Private task context must not be sent.')
    expect(prompt).toContain('<session context omitted by privacy policy>')
    expect(prompt).toContain('/Users/<user>/private-repo')
    expect(prompt).not.toContain('/Users/alice')
    expect(context.images).toEqual([])
    expect(context.imageStats).toEqual({
      admitted: 0,
      omitted: 0,
      admittedBytes: 0,
      estimatedTokens: 0,
    })
  })
})
