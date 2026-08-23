import type {
  MaxReviewerRisk,
  MinReviewerAuthorization,
  ReviewerAuthorization,
  ReviewerOutcome,
  ReviewerRisk,
} from './config.js'
/** Validated assessment returned by the reviewer model. */
export interface ReviewerAssessment {
  readonly risk: ReviewerRisk
  readonly authorization: ReviewerAuthorization
  readonly outcome: ReviewerOutcome
  readonly rationale: string
}
const RISK: Record<ReviewerRisk, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
}
const AUTH: Record<ReviewerAuthorization, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
}
/** Local policy limits that blocked an otherwise allowed reviewer assessment. */
export interface AutoApprovalPolicyBlock {
  maxRisk?: MaxReviewerRisk
  minAuthorization?: MinReviewerAuthorization
  visualOmission?: true
  visualFallback?: true
}

/** Explain which local limits block a reviewer allow decision. */
export function autoApprovalPolicyBlock(
  a: ReviewerAssessment,
  maxRisk: MaxReviewerRisk,
  minAuthorization: MinReviewerAuthorization = 'high',
): AutoApprovalPolicyBlock | undefined {
  if (a.outcome !== 'allow') return undefined
  const block: AutoApprovalPolicyBlock = {
    ...(RISK[a.risk] > RISK[maxRisk] ? { maxRisk } : {}),
    ...(AUTH[a.authorization] < AUTH[minAuthorization] ? { minAuthorization } : {}),
  }
  return block.maxRisk === undefined && block.minAuthorization === undefined ? undefined : block
}
/** Return whether an assessment satisfies the automatic-approval policy. */
export function canAutoApprove(
  a: ReviewerAssessment,
  maxRisk: MaxReviewerRisk,
  minAuthorization: MinReviewerAuthorization = 'high',
): boolean {
  return (
    a.outcome === 'allow' && autoApprovalPolicyBlock(a, maxRisk, minAuthorization) === undefined
  )
}
/** Parse strict reviewer JSON, tolerating one surrounding markdown fence. */
export function parseAssessment(text: string): ReviewerAssessment {
  const n = text.trim()
  const f = n.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i)
  const s = (f?.[1] ?? n).trim()
  if (!s.startsWith('{') || !s.endsWith('}'))
    throw new Error('ai-approval: reviewer returned no JSON object')
  let raw: unknown
  try {
    raw = JSON.parse(s)
  } catch {
    throw new Error('ai-approval: reviewer returned invalid JSON')
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('ai-approval: reviewer output is not an object')
  const v = raw as Record<string, unknown>
  const allowed = ['risk_level', 'user_authorization', 'outcome', 'rationale']
  for (const k of Object.keys(v))
    if (!allowed.includes(k)) throw new Error(`ai-approval: reviewer returned unknown field "${k}"`)
  for (const k of allowed)
    if (!Object.prototype.hasOwnProperty.call(v, k))
      throw new Error(`ai-approval: reviewer output is missing ${k}`)
  if (v.outcome !== 'allow' && v.outcome !== 'deny')
    throw new Error('ai-approval: reviewer outcome must be allow or deny')
  if (!['low', 'medium', 'high', 'critical'].includes(v.risk_level as string))
    throw new Error('ai-approval: reviewer risk is invalid')
  if (!['unknown', 'low', 'medium', 'high'].includes(v.user_authorization as string))
    throw new Error('ai-approval: reviewer authorization is invalid')
  if (typeof v.rationale !== 'string' || !v.rationale.trim())
    throw new Error('ai-approval: reviewer rationale must be a non-empty string')
  return {
    risk: v.risk_level as ReviewerRisk,
    authorization: v.user_authorization as ReviewerAuthorization,
    outcome: v.outcome as ReviewerOutcome,
    rationale: v.rationale.trim(),
  }
}
