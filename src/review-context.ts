import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { ResolvedConfig, ReviewerContextMode } from './config.js'
import { jsonText, privacyText, redactLocalPaths, truncateUtf8 } from './privacy.js'
type Kind = 'user' | 'context' | 'assistant' | 'tool'
interface Entry {
  kind: Kind
  text: string
}
function contentText(content: readonly ContentBlock[]): string {
  return content
    .map((b) => {
      switch (b.type) {
        case 'text':
          return b.text
        case 'reasoning':
          return '[reasoning omitted]'
        case 'tool-call':
          return `tool call ${b.name}: ${b.arguments}`
        case 'tool-result':
          return `tool result ${String(b.toolCallId)}: ${jsonText(b.content)}`
        case 'image':
          return '[image omitted]'
        default:
          return jsonText(b)
      }
    })
    .join('\n')
}
function kind(m: Message): Kind | undefined {
  if (m.role === 'assistant')
    return m.content.some((b) => b.type === 'tool-call') ? 'tool' : 'assistant'
  if (m.role === 'user')
    return m.content.some((b) => b.type === 'tool-result')
      ? 'tool'
      : m.source.kind === 'user'
        ? 'user'
        : 'context'
  return undefined
}
function entries(ms: readonly Message[]): Entry[] {
  return ms.flatMap((m) => {
    const k = kind(m)
    if (!k) return []
    const text = contentText(m.content).trim()
    return text ? [{ kind: k, text }] : []
  })
}
function tokens(s: string) {
  return Math.max(1, Math.ceil(Buffer.byteLength(s, 'utf8') / 4))
}
function select(
  es: readonly Entry[],
  c: Pick<
    ResolvedConfig,
    'maxMessageTokens' | 'maxToolTokens' | 'maxEntryTokens' | 'maxRecentEntries'
  > & { maxBytes: number },
) {
  const rendered = es.map((e, i) => ({
    e,
    text: `[${i + 1}] ${e.kind}: ${truncateEntry(e.text, c.maxEntryTokens)}`,
  }))
  const set = new Set<number>()
  let mt = 0,
    tt = 0,
    bytes = 0
  const add = (i: number) => {
    if (set.has(i)) return true
    const x = rendered[i]
    if (!x) return false
    const b = Buffer.byteLength(x.text, 'utf8') + (set.size ? 1 : 0),
      t = tokens(x.text)
    if (bytes + b > c.maxBytes) return false
    if (x.e.kind === 'tool') {
      if (tt + t > c.maxToolTokens) return false
      tt += t
    } else {
      if (mt + t > c.maxMessageTokens) return false
      mt += t
    }
    set.add(i)
    bytes += b
    return true
  }
  const users = rendered.flatMap((x, i) => (x.e.kind === 'user' ? [i] : []))
  if (users[0] !== undefined) add(users[0])
  if (users.at(-1) !== undefined) add(users.at(-1)!)
  for (const i of [...users].reverse()) add(i)
  let recent = 0
  for (let i = rendered.length - 1; i >= 0 && recent < c.maxRecentEntries; i--)
    if (rendered[i]?.e.kind !== 'user' && add(i)) recent++
  return {
    text: rendered
      .filter((_x, i) => set.has(i))
      .map((x) => x.text)
      .join('\n'),
    omitted: set.size !== es.length,
  }
}
function truncateEntry(s: string, n: number) {
  const max = Math.max(4, n * 4)
  if (Buffer.byteLength(s, 'utf8') <= max) return s
  const marker = ' <entry truncated>',
    a = Math.max(0, max - Buffer.byteLength(marker, 'utf8')),
    h = Math.floor(a / 2)
  return `${truncateUtf8(s, h)}${marker}${truncateUtf8(s.slice(-h), a - h)}`
}
/** Size and privacy options used to build a reviewer prompt. */
export interface ReviewPromptOptions
  extends Pick<
    ResolvedConfig,
    'maxMessageTokens' | 'maxToolTokens' | 'maxEntryTokens' | 'maxRecentEntries' | 'maxInputBytes'
  > {
  messages?: readonly Message[]
  contextMode?: ReviewerContextMode
  redactPaths?: boolean
}
/** Build a bounded prompt containing the exact action and selected context. */
export function buildReviewPrompt(
  request: ApprovalRequest,
  execution: Readonly<ToolExecution>,
  config: ReviewPromptOptions,
): string {
  const messages = config.messages ?? request.agent.session.deriveMessages()
  const mode = config.contextMode ?? 'bounded',
    paths = config.redactPaths ?? true
  const action = {
    tool: request.toolName,
    callId: request.callId,
    arguments: execution.arguments,
    cwd: paths
      ? redactLocalPaths(request.agent.session.header.cwd ?? '<unknown>')
      : request.agent.session.header.cwd,
    requestedReason: request.reason,
  }
  const actionSection = [
    '## Exact action awaiting approval',
    privacyText(jsonText(action), paths),
  ].join('\n')
  const output = [
    '## Required output',
    '{"risk_level":"low|medium|high|critical","user_authorization":"unknown|low|medium|high","outcome":"allow|deny","rationale":"..."}',
  ].join('\n')
  const fixed = [
    '## Current user and agent context',
    '',
    '## Transcript selection',
    '',
    '',
    actionSection,
    '',
    output,
  ].join('\n')
  const budget = Math.max(0, config.maxInputBytes - Buffer.byteLength(fixed, 'utf8') - 64)
  const transcript =
    mode === 'action-only'
      ? { text: '', omitted: true }
      : select(entries(messages), { ...config, maxBytes: budget })
  const safe = privacyText(transcript.text, paths),
    available = Math.max(0, config.maxInputBytes - Buffer.byteLength(fixed, 'utf8') - 64),
    history = truncateUtf8(
      safe ||
        (mode === 'action-only'
          ? '<session context omitted by privacy policy>'
          : '<no retained transcript entries>'),
      available,
    )
  const omission =
    mode === 'action-only'
      ? '\nSession context omitted by privacy policy.\n'
      : transcript.omitted || history !== safe
        ? '\nSome transcript entries were omitted or truncated.\n'
        : ''
  return ['## Current user and agent context', history, omission, actionSection, '', output].join(
    '\n',
  )
}
