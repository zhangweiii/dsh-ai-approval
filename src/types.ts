import type { CallId, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { ReviewerAuthorization, ReviewerOutcome, ReviewerRisk } from './config.js'
import type { AutoApprovalPolicyBlock } from './assessment.js'
import type { Session } from '@deepseek-ai/dsh-session'

/** Stable identity shared by one review's start and terminal audit events. */
export type AiApprovalReviewId = string

/** Durable facts available as soon as the independent review starts. */
export interface AiApprovalReviewStartedData {
  reviewId: AiApprovalReviewId
  callId?: CallId
  toolName: string
  reason: string
  provider: string
  model: string
  reasoningEffort?: string
}

/** Durable terminal assessment and the exact host approval outcome it produced. */
export interface AiApprovalReviewedData extends AiApprovalReviewStartedData {
  cwd: string
  risk: ReviewerRisk
  authorization: ReviewerAuthorization
  outcome: ReviewerOutcome
  approvalOutcome: ApprovalOutcome
  policyBlock?: AutoApprovalPolicyBlock
  rationale: string
  attempts: number
  durationMs: number
  usage?: TokenUsage
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Process-local review telemetry; deliberately not persisted in session history. */
    'ai-approval/review-started'(session: Session, data: AiApprovalReviewStartedData): void
    /** Process-local terminal review telemetry; deliberately not persisted in session history. */
    'ai-approval/reviewed'(session: Session, data: AiApprovalReviewedData): void
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Legacy event retained only so repaired historical cards remain renderable. */
    'ai-approval/review-started': AiApprovalReviewStartedData
    /** Legacy event retained only so repaired historical cards remain renderable. */
    'ai-approval/reviewed': AiApprovalReviewedData
  }
}
