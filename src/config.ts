import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Risk level assigned to the proposed action. */
export type ReviewerRisk = 'low' | 'medium' | 'high' | 'critical'
/** Confidence that the user authorized the proposed action. */
export type ReviewerAuthorization = 'unknown' | 'low' | 'medium' | 'high'
/** Decision returned by the reviewer model. */
export type ReviewerOutcome = 'allow' | 'deny'
/** Highest risk accepted for automatic approval. */
export type MaxReviewerRisk = 'low' | 'medium' | 'high'
/** Amount of session context sent to the reviewer. */
export type ReviewerContextMode = 'action-only' | 'bounded'
/** Explicit consent for sending bounded transcript images to the reviewer route. */
export type ReviewerImageMode = 'omit' | 'allow'
/** Minimum authorization confidence accepted for automatic approval. */
export type MinReviewerAuthorization = 'medium' | 'high'
/** DSH LLM route used for one reviewer request. */
export interface ReviewerRoute {
  provider: string
  model: string
  reasoningEffort?: string
  imageMode?: ReviewerImageMode
}
/** Persisted reviewer route; `null` explicitly masks a composition-layer effort. */
export interface ReviewerRouteSettings extends Omit<ReviewerRoute, 'reasoningEffort'> {
  reasoningEffort?: string | null
}
/**
 * One route field as a schema field declared `volatile()` resolves it: a live
 * reference whose `get()` returns the current value. {@link liveValue} also
 * accepts a bare value, so composition defaults and test fixtures that pass
 * plain strings keep working.
 */
export type MaybeVolatile<T> = T | Volatile<T>

/** Read one possibly-volatile configuration field at call time. */
export function liveValue<T>(value: MaybeVolatile<T> | undefined): T | undefined {
  if (value === undefined) return undefined
  const ref = value as { get?: () => T }
  return typeof ref.get === 'function' ? ref.get() : (value as T)
}

/** Plugin configuration as it reaches the runtime: route fields are live references. */
export interface Config {
  /** Permission-preset name that activates this reviewer. */
  presetName?: string
  /** LLM provider route for the reviewer. */
  provider: Volatile<string>
  /** Model id on the reviewer route. */
  model: Volatile<string>
  /** Optional adapter-owned reasoning effort for the reviewer route. */
  reasoningEffort: Volatile<string | undefined>
  /** Explicitly allow bounded transcript images on a capable reviewer route. */
  imageMode: Volatile<ReviewerImageMode | undefined>
  /** End-to-end reviewer deadline in milliseconds. */
  timeoutMs?: number
  /** Maximum combined UTF-8 bytes for reviewer system and user text; images use separate limits. */
  maxInputBytes?: number
  /** Maximum generated tokens for one assessment. */
  maxOutputTokens?: number
  /** Approximate token budget for user, assistant, and developer entries. */
  maxMessageTokens?: number
  /** Approximate token budget for tool calls and results. */
  maxToolTokens?: number
  /** Approximate token cap for one retained transcript entry. */
  maxEntryTokens?: number
  /** Maximum retained non-user entries from the newest side. */
  maxRecentEntries?: number
  /** Approximate token budget for admitted reviewer images. */
  maxImageTokens?: number
  /** Maximum admitted image count. */
  maxImages?: number
  /** Maximum raw bytes across admitted images. */
  maxImageBytes?: number
  /** Maximum risk accepted for automatic approval. */
  maxRisk?: MaxReviewerRisk
  /** Minimum authorization confidence accepted for automatic approval. */
  minAuthorization?: MinReviewerAuthorization
  /** Whether to include bounded session context beyond the exact action. */
  contextMode?: ReviewerContextMode
  /** Whether to redact local usernames and paths. */
  redactPaths?: boolean
  /** Whether to send the host session id to the provider. */
  sendSessionId?: boolean
  /** Maximum model attempts for one approval request. */
  maxAttempts?: number
  /** Consecutive denials after which reviewer calls stop. */
  maxConsecutiveDenials?: number
  /** Consecutive failures after which the failure circuit opens. */
  maxConsecutiveFailures?: number
  /** Failure-circuit cooldown in milliseconds. */
  failureCooldownMs?: number
}
/** Immutable, validated plugin configuration. */
export interface ResolvedConfig {
  readonly presetName: string
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly imageMode: ReviewerImageMode
  readonly timeoutMs: number
  readonly maxInputBytes: number
  readonly maxOutputTokens: number
  readonly maxMessageTokens: number
  readonly maxToolTokens: number
  readonly maxEntryTokens: number
  readonly maxRecentEntries: number
  readonly maxImageTokens: number
  readonly maxImages: number
  readonly maxImageBytes: number
  readonly maxRisk: MaxReviewerRisk
  readonly minAuthorization: MinReviewerAuthorization
  readonly contextMode: ReviewerContextMode
  readonly redactPaths: boolean
  readonly sendSessionId: boolean
  readonly maxAttempts: number
  readonly maxConsecutiveDenials: number
  readonly maxConsecutiveFailures: number
  readonly failureCooldownMs: number
}
/**
 * Runtime schema exposed to Cordis configuration catalogs.
 *
 * The annotation is deliberately omitted so the schema infers its own output
 * shape: DSH 0.1.7 rewrites `volatile()` fields into live references before
 * `apply` runs, so a hand-written annotation describing the parsed shape would
 * disagree with the composition-time input type the loader checks.
 */
export const Config = z.object({
  presetName: z.string().default('ai-approval'),
  // The reviewer route lives in the live-form projection: DSH 0.1.7 renders and
  // edits `volatile()` fields through its own settings/config-editor surface, so
  // these four stay live references rather than frozen composition values.
  provider: z.string().required().volatile(),
  model: z.string().required().volatile(),
  reasoningEffort: z.string().volatile(),
  imageMode: z
    .union(['omit', 'allow'] as const)
    .default('omit')
    .volatile(),
  timeoutMs: z.number().default(60000),
  maxInputBytes: z.number().default(48000),
  maxOutputTokens: z.number().default(512),
  maxMessageTokens: z.number().default(2048),
  maxToolTokens: z.number().default(4096),
  maxEntryTokens: z.number().default(512),
  maxRecentEntries: z.number().default(12),
  maxImageTokens: z.number().default(10000),
  maxImages: z.number().default(8),
  maxImageBytes: z.number().default(16777216),
  maxRisk: z.union(['low', 'medium', 'high'] as const).default('high'),
  minAuthorization: z.union(['medium', 'high'] as const).default('high'),
  contextMode: z.union(['action-only', 'bounded'] as const).default('bounded'),
  redactPaths: z.boolean().default(true),
  sendSessionId: z.boolean().default(false),
  maxAttempts: z.number().default(2),
  maxConsecutiveDenials: z.number().default(3),
  maxConsecutiveFailures: z.number().default(3),
  failureCooldownMs: z.number().default(30000),
})
/** Settings schema for the live reviewer route exposed to DSH Web. */
export const ReviewerRouteConfig: z<ReviewerRouteSettings> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.union([z.string(), z.const(null)]),
  imageMode: z.union(['omit', 'allow'] as const).default('omit'),
})

/** Validate and freeze a route read from DSH settings. */
export function resolveReviewerRoute(route: ReviewerRouteSettings): Readonly<ReviewerRoute> {
  if (
    typeof route.provider !== 'string' ||
    !route.provider.trim() ||
    typeof route.model !== 'string' ||
    !route.model.trim()
  )
    throw new Error('ai-approval: provider and model must be non-empty')
  if (
    route.reasoningEffort !== undefined &&
    route.reasoningEffort !== null &&
    (typeof route.reasoningEffort !== 'string' || !route.reasoningEffort.trim())
  )
    throw new Error('ai-approval: reasoningEffort must be non-empty when provided')
  if (route.imageMode !== undefined && !['omit', 'allow'].includes(route.imageMode))
    throw new Error('ai-approval: imageMode must be omit or allow')
  return deepFreeze({
    provider: route.provider,
    model: route.model,
    ...(route.reasoningEffort === undefined || route.reasoningEffort === null
      ? {}
      : { reasoningEffort: route.reasoningEffort }),
    imageMode: route.imageMode ?? 'omit',
  })
}
/**
 * Snapshot the four live route fields out of a possibly-volatile Config.
 *
 * `provider` and `model` are schema-required, so a resolved Config always
 * carries a string for them; the undefined branches exist only so an
 * unconfigured or partially-built fixture still reaches
 * {@link resolveReviewerRoute}, which is what reports the failure.
 */
export function readRouteFields(config: Config): ReviewerRouteSettings {
  const provider = liveValue(config.provider)
  const model = liveValue(config.model)
  const reasoningEffort = liveValue(config.reasoningEffort)
  const imageMode = liveValue(config.imageMode)
  return {
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(imageMode === undefined ? {} : { imageMode }),
  } as ReviewerRouteSettings
}
/** Validate, default, and freeze untrusted plugin configuration. */
export function resolveConfig(config: Config): ResolvedConfig {
  const c = config as unknown as Record<string, unknown>
  const keys = [
    'presetName',
    'provider',
    'model',
    'reasoningEffort',
    'imageMode',
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
    'maxRisk',
    'minAuthorization',
    'contextMode',
    'redactPaths',
    'sendSessionId',
    'maxAttempts',
    'maxConsecutiveDenials',
    'maxConsecutiveFailures',
    'failureCooldownMs',
  ]
  for (const k of Object.keys(c))
    if (!keys.includes(k)) throw new Error(`ai-approval: unknown config key "${k}"`)
  const routeFields = readRouteFields(config)
  const r = {
    presetName: config.presetName ?? 'ai-approval',
    provider: routeFields.provider,
    model: routeFields.model,
    ...(routeFields.reasoningEffort === undefined || routeFields.reasoningEffort === null
      ? {}
      : { reasoningEffort: routeFields.reasoningEffort }),
    imageMode: routeFields.imageMode ?? 'omit',
    timeoutMs: config.timeoutMs ?? 60000,
    maxInputBytes: config.maxInputBytes ?? 48000,
    maxOutputTokens: config.maxOutputTokens ?? 512,
    maxMessageTokens: config.maxMessageTokens ?? 2048,
    maxToolTokens: config.maxToolTokens ?? 4096,
    maxEntryTokens: config.maxEntryTokens ?? 512,
    maxRecentEntries: config.maxRecentEntries ?? 12,
    maxImageTokens: config.maxImageTokens ?? 10000,
    maxImages: config.maxImages ?? 8,
    maxImageBytes: config.maxImageBytes ?? 16777216,
    maxRisk: config.maxRisk ?? 'high',
    minAuthorization: config.minAuthorization ?? 'high',
    contextMode: config.contextMode ?? 'bounded',
    redactPaths: config.redactPaths ?? true,
    sendSessionId: config.sendSessionId ?? false,
    maxAttempts: config.maxAttempts ?? 2,
    maxConsecutiveDenials: config.maxConsecutiveDenials ?? 3,
    maxConsecutiveFailures: config.maxConsecutiveFailures ?? 3,
    failureCooldownMs: config.failureCooldownMs ?? 30000,
  } satisfies ResolvedConfig
  for (const [n, v] of Object.entries(r))
    if (
      n.endsWith('Ms') ||
      [
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
      ].includes(n)
    )
      if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0)
        throw new Error(`ai-approval: ${n} must be a positive integer`)
  if (r.timeoutMs > MAX_TIMER_DELAY_MS || r.failureCooldownMs > MAX_TIMER_DELAY_MS)
    throw new Error(`ai-approval: timer must not exceed ${MAX_TIMER_DELAY_MS}`)
  if (
    !['low', 'medium', 'high'].includes(r.maxRisk) ||
    !['medium', 'high'].includes(r.minAuthorization) ||
    !['omit', 'allow'].includes(r.imageMode) ||
    !['action-only', 'bounded'].includes(r.contextMode)
  )
    throw new Error('ai-approval: invalid policy configuration')
  if (typeof r.redactPaths !== 'boolean' || typeof r.sendSessionId !== 'boolean')
    throw new Error('ai-approval: redactPaths and sendSessionId must be boolean')
  resolveReviewerRoute(r)
  return deepFreeze(r)
}
