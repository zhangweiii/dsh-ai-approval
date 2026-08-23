import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { ResolvedConfig, ReviewerContextMode } from './config.js'
import { jsonText, privacyText, redactLocalPaths, truncateUtf8 } from './privacy.js'

type Kind = 'user' | 'context' | 'assistant' | 'tool'
type ImageBlock = Extract<ContentBlock, { type: 'image' }>

interface Entry {
  kind: Kind
  content: readonly ContentBlock[]
}

interface SelectedEntry {
  entry: Entry
  index: number
}

interface VisualProjection {
  readonly blocks: readonly ImageBlock[]
  readonly ordinals: ReadonlyMap<string, number>
  readonly stats: ReviewImageStats
}

/** Codex guardian parity: one image item may consume at most this estimate. */
export const GUARDIAN_MAX_IMAGE_ITEM_TOKENS = 10_000
/** Explicit evidence marker used whenever visual content cannot reach the reviewer. */
export const REVIEW_IMAGE_OMITTED_TEXT = '[image omitted — reviewer cannot verify visual content]'

/** Privacy-safe audit facts for the visual context projected into one request. */
export interface ReviewImageStats {
  admitted: number
  omitted: number
  admittedBytes: number
  estimatedTokens: number
}

/** Cumulative disclosure facts across every plugin-level attempt. */
export interface ReviewImageAudit extends ReviewImageStats {
  everAdmitted: number
  everAdmittedBytes: number
  everEstimatedTokens: number
  imageBearingAttempts: number
  fallbackUsed: boolean
}

/** Text plus detached image references for one reviewer user message. */
export interface ReviewContext {
  text: string
  images: readonly ImageBlock[]
  imageStats: ReviewImageStats
}

function imageKey(block: ImageBlock): string {
  return String(block.attachment.attachmentId)
}

function imageMarker(block: ImageBlock, visuals: VisualProjection): string {
  const ordinal = visuals.ordinals.get(imageKey(block))
  return ordinal === undefined
    ? REVIEW_IMAGE_OMITTED_TEXT
    : `[image ${ordinal} attached for reviewer inspection]`
}

function safeNestedContent(
  content: readonly ContentBlock[],
  visuals: VisualProjection,
): readonly unknown[] {
  return content.map((block) => {
    if (block.type === 'image') return imageMarker(block, visuals)
    if (block.type === 'tool-result')
      return { ...block, content: safeNestedContent(block.content, visuals) }
    return block
  })
}

function contentText(content: readonly ContentBlock[], visuals: VisualProjection): string {
  return content
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text
        case 'reasoning':
          return '[reasoning omitted]'
        case 'tool-call':
          return `tool call ${block.name}: ${block.arguments}`
        case 'tool-result':
          return `tool result ${String(block.toolCallId)}: ${jsonText(
            safeNestedContent(block.content, visuals),
          )}`
        case 'image':
          return imageMarker(block, visuals)
        default:
          return jsonText(block)
      }
    })
    .join('\n')
}

function kind(message: Message): Kind | undefined {
  if (message.role === 'assistant')
    return message.content.some((block) => block.type === 'tool-call') ? 'tool' : 'assistant'
  if (message.role === 'user')
    return message.content.some((block) => block.type === 'tool-result')
      ? 'tool'
      : message.source.kind === 'user'
        ? 'user'
        : 'context'
  return undefined
}

function entries(messages: readonly Message[]): Entry[] {
  return messages.flatMap((message) => {
    const entryKind = kind(message)
    if (!entryKind) return []
    return [{ kind: entryKind, content: message.content }]
  })
}

function tokens(text: string) {
  return Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 4))
}

const noVisuals: VisualProjection = {
  blocks: [],
  ordinals: new Map(),
  stats: { admitted: 0, omitted: 0, admittedBytes: 0, estimatedTokens: 0 },
}

function select(
  source: readonly Entry[],
  config: Pick<
    ResolvedConfig,
    'maxMessageTokens' | 'maxToolTokens' | 'maxEntryTokens' | 'maxRecentEntries'
  > & { maxBytes: number },
) {
  const rendered = source.map((entry, index) => ({
    entry,
    index,
    text: `[${index + 1}] ${entry.kind}: ${truncateEntry(
      contentText(entry.content, noVisuals),
      config.maxEntryTokens,
    )}`,
  }))
  const selected = new Set<number>()
  let messageTokens = 0
  let toolTokens = 0
  let bytes = 0
  const add = (index: number) => {
    if (selected.has(index)) return true
    const candidate = rendered[index]
    if (!candidate) return false
    const nextBytes = Buffer.byteLength(candidate.text, 'utf8') + (selected.size ? 1 : 0)
    const nextTokens = tokens(candidate.text)
    if (bytes + nextBytes > config.maxBytes) return false
    if (candidate.entry.kind === 'tool') {
      if (toolTokens + nextTokens > config.maxToolTokens) return false
      toolTokens += nextTokens
    } else {
      if (messageTokens + nextTokens > config.maxMessageTokens) return false
      messageTokens += nextTokens
    }
    selected.add(index)
    bytes += nextBytes
    return true
  }
  const users = rendered.flatMap((candidate, index) =>
    candidate.entry.kind === 'user' ? [index] : [],
  )
  if (users[0] !== undefined) add(users[0])
  if (users.at(-1) !== undefined) add(users.at(-1)!)
  for (const index of [...users].reverse()) add(index)
  let recent = 0
  for (let index = rendered.length - 1; index >= 0 && recent < config.maxRecentEntries; index--)
    if (rendered[index]?.entry.kind !== 'user' && add(index)) recent++
  return {
    entries: rendered
      .filter((_candidate, index) => selected.has(index))
      .map(({ entry, index }): SelectedEntry => ({ entry, index })),
    omitted: selected.size !== source.length,
  }
}

function truncateEntry(text: string, tokenLimit: number) {
  const max = Math.max(4, tokenLimit * 4)
  if (Buffer.byteLength(text, 'utf8') <= max) return text
  const marker = ' <entry truncated>'
  const available = Math.max(0, max - Buffer.byteLength(marker, 'utf8'))
  const head = Math.floor(available / 2)
  return `${truncateUtf8(text, head)}${marker}${truncateUtf8(text.slice(-head), available - head)}`
}

interface ImageSurvey {
  readonly seen: Set<string>
  readonly candidates: Map<string, ImageBlock>
  readonly conflicts: Set<string>
}

function sameImageMetadata(a: ImageBlock, b: ImageBlock): boolean {
  return (
    a.attachment.mediaType === b.attachment.mediaType &&
    a.attachment.bytes === b.attachment.bytes &&
    a.attachment.width === b.attachment.width &&
    a.attachment.height === b.attachment.height
  )
}

function collectImages(content: readonly ContentBlock[], survey: ImageSurvey): void {
  for (const block of content) {
    if (block.type === 'image') {
      const key = imageKey(block)
      survey.seen.add(key)
      if (survey.conflicts.has(key)) continue
      const previous = survey.candidates.get(key)
      if (previous !== undefined && !sameImageMetadata(previous, block)) {
        survey.candidates.delete(key)
        survey.conflicts.add(key)
        continue
      }
      survey.candidates.delete(key)
      survey.candidates.set(key, block)
    } else if (block.type === 'tool-result') collectImages(block.content, survey)
  }
}

function surveyImages(source: readonly Entry[]): ImageSurvey {
  const survey: ImageSurvey = {
    seen: new Set(),
    candidates: new Map(),
    conflicts: new Set(),
  }
  for (const entry of source) collectImages(entry.content, survey)
  return survey
}

/** Conservative provider-neutral image-token estimate based on normalized 512px tiles. */
export function estimateReviewImageTokens(block: ImageBlock): number {
  const { width, height } = block.attachment
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0)
    return GUARDIAN_MAX_IMAGE_ITEM_TOKENS
  let normalizedWidth = width
  let normalizedHeight = height
  const longestScale = Math.min(1, 2048 / Math.max(normalizedWidth, normalizedHeight))
  normalizedWidth *= longestScale
  normalizedHeight *= longestScale
  const shortestScale = Math.min(1, 768 / Math.min(normalizedWidth, normalizedHeight))
  normalizedWidth *= shortestScale
  normalizedHeight *= shortestScale
  const tiles = Math.ceil(normalizedWidth / 512) * Math.ceil(normalizedHeight / 512)
  return Math.min(GUARDIAN_MAX_IMAGE_ITEM_TOKENS, 85 + 170 * Math.max(1, tiles))
}

function cloneImageBlock(block: ImageBlock): ImageBlock {
  return {
    type: 'image',
    attachment: { ...block.attachment },
  }
}

function projectVisuals(
  source: readonly Entry[],
  selected: readonly SelectedEntry[],
  admitImages: boolean,
  maxImageTokens: number,
  maxImages: number,
  maxImageBytes: number,
): VisualProjection {
  const survey = surveyImages(source)
  const selectedSurvey = surveyImages(selected.map(({ entry }) => entry))
  const ordered = [...selectedSurvey.candidates.entries()].filter(
    ([key]) => !survey.conflicts.has(key),
  )
  const admitted = new Set<string>()
  let estimatedTokens = 0
  let admittedBytes = 0
  if (admitImages) {
    for (let index = ordered.length - 1; index >= 0; index--) {
      const item = ordered[index]
      if (!item || admitted.size >= maxImages) continue
      const [key, block] = item
      const estimate = estimateReviewImageTokens(block)
      const bytes = block.attachment.bytes
      if (!Number.isSafeInteger(bytes) || bytes <= 0) continue
      if (estimatedTokens + estimate > maxImageTokens || admittedBytes + bytes > maxImageBytes)
        continue
      admitted.add(key)
      estimatedTokens += estimate
      admittedBytes += bytes
    }
  }
  const admittedInOrder = ordered.filter(([key]) => admitted.has(key))
  const ordinals = new Map(admittedInOrder.map(([key], index) => [key, index + 1]))
  return {
    blocks: admittedInOrder.map(([, block]) => cloneImageBlock(block)),
    ordinals,
    stats: {
      admitted: admittedInOrder.length,
      omitted: survey.seen.size - admittedInOrder.length,
      admittedBytes,
      estimatedTokens,
    },
  }
}

function collectImageKeys(content: readonly ContentBlock[], keys: Set<string>): void {
  for (const block of content) {
    if (block.type === 'image') keys.add(imageKey(block))
    else if (block.type === 'tool-result') collectImageKeys(block.content, keys)
  }
}

function visualIndex(selected: readonly SelectedEntry[], visuals: VisualProjection): string {
  if (visuals.blocks.length === 0) return ''
  const entriesByImage = new Map<string, number[]>()
  for (const { entry, index } of selected) {
    const keys = new Set<string>()
    collectImageKeys(entry.content, keys)
    for (const key of keys) {
      if (!visuals.ordinals.has(key)) continue
      const indexes = entriesByImage.get(key) ?? []
      indexes.push(index + 1)
      entriesByImage.set(key, indexes)
    }
  }
  return [
    'Visual evidence index:',
    ...visuals.blocks.map((block, index) => {
      const entries = entriesByImage.get(imageKey(block)) ?? []
      const label = entries.length === 1 ? 'entry' : 'entries'
      return `[image ${index + 1} attached for reviewer inspection] — transcript ${label} ${entries.join(', ')}`
    }),
  ].join('\n')
}

/** Size, privacy, and visual-admission options used to build reviewer context. */
export interface ReviewPromptOptions
  extends Pick<
    ResolvedConfig,
    'maxMessageTokens' | 'maxToolTokens' | 'maxEntryTokens' | 'maxRecentEntries' | 'maxInputBytes'
  > {
  messages?: readonly Message[]
  contextMode?: ReviewerContextMode
  redactPaths?: boolean
  admitImages?: boolean
  maxImageTokens?: number
  maxImages?: number
  maxImageBytes?: number
}

/** Build bounded text and capability-gated images for one reviewer request. */
export function buildReviewContext(
  request: ApprovalRequest,
  execution: Readonly<ToolExecution>,
  config: ReviewPromptOptions,
): ReviewContext {
  const messages = config.messages ?? request.agent.session.deriveMessages()
  const mode = config.contextMode ?? 'bounded'
  const paths = config.redactPaths ?? true
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
  const budget = Math.max(0, config.maxInputBytes - Buffer.byteLength(fixed, 'utf8') - 256)
  const sourceEntries = mode === 'action-only' ? [] : entries(messages)
  const transcript =
    mode === 'action-only'
      ? { entries: [] as SelectedEntry[], omitted: true }
      : select(sourceEntries, { ...config, maxBytes: budget })
  const visuals = projectVisuals(
    sourceEntries,
    transcript.entries,
    mode === 'bounded' && config.admitImages === true,
    config.maxImageTokens ?? GUARDIAN_MAX_IMAGE_ITEM_TOKENS,
    config.maxImages ?? 8,
    config.maxImageBytes ?? 16 * 1024 * 1024,
  )
  const rendered = transcript.entries
    .map(
      ({ entry, index }) =>
        `[${index + 1}] ${entry.kind}: ${truncateEntry(
          contentText(entry.content, visuals),
          config.maxEntryTokens,
        )}`,
    )
    .join('\n')
  const safe = privacyText(rendered, paths)
  const visualNote =
    visuals.stats.omitted > 0
      ? `Visual evidence warning: ${visuals.stats.omitted} unique image(s) were omitted; their visual content is unverifiable.\n${REVIEW_IMAGE_OMITTED_TEXT}`
      : visuals.stats.admitted > 0
        ? `Visual evidence: ${visuals.stats.admitted} unique image(s) are attached for inspection.`
        : ''
  const imageIndex = visualIndex(transcript.entries, visuals)
  const available = Math.max(
    0,
    config.maxInputBytes -
      Buffer.byteLength(fixed, 'utf8') -
      Buffer.byteLength(visualNote, 'utf8') -
      Buffer.byteLength(imageIndex, 'utf8') -
      64,
  )
  const history = truncateUtf8(
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
  return {
    text: [
      '## Current user and agent context',
      history,
      omission,
      ...(visualNote ? [visualNote, ''] : []),
      ...(imageIndex ? [imageIndex, ''] : []),
      actionSection,
      '',
      output,
    ].join('\n'),
    images: visuals.blocks,
    imageStats: visuals.stats,
  }
}

/** Build a text-only reviewer prompt; visual content is marked as unverifiable. */
export function buildReviewPrompt(
  request: ApprovalRequest,
  execution: Readonly<ToolExecution>,
  config: ReviewPromptOptions,
): string {
  return buildReviewContext(request, execution, config).text
}
