import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  ConversationLocation,
  ConversationMatch,
  ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { AiApprovalReviewStartedData, AiApprovalReviewedData } from '../types.js'
import type {} from '../types.js'
import { AiApprovalReviewCard } from './review-card.js'

export interface AiApprovalReviewCardData extends AiApprovalReviewStartedData {
  status: 'reviewing' | ApprovalOutcome
  cwd?: string
  risk?: AiApprovalReviewedData['risk']
  authorization?: AiApprovalReviewedData['authorization']
  outcome?: AiApprovalReviewedData['outcome']
  policyBlock?: AiApprovalReviewedData['policyBlock']
  rationale?: string
  attempts?: number
  durationMs?: number
  images?: AiApprovalReviewedData['images']
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'ai-approval-review': AiApprovalReviewCardData
  }
}

function dataOf(match: ConversationMatch): AiApprovalReviewStartedData | AiApprovalReviewedData {
  return match.event.data as AiApprovalReviewStartedData | AiApprovalReviewedData
}

function locationOf(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

export const aiApprovalReviewDefinition: ConversationNodeDefinition<AiApprovalReviewCardData> = {
  kind: 'ai-approval-review',
  target: 'chat',
  match(event) {
    if (event.type !== 'ai-approval/review-started' && event.type !== 'ai-approval/reviewed')
      return null
    const reviewId = (event.data as { reviewId?: unknown }).reviewId
    if (typeof reviewId !== 'string' || reviewId.length === 0) return null
    return {
      id: reviewId,
      role: event.type === 'ai-approval/review-started' ? 'start' : 'update',
    }
  },
  start(_context, match) {
    const data = dataOf(match) as AiApprovalReviewStartedData
    return { ...data, status: 'reviewing' }
  },
  update(_context, match) {
    const data = dataOf(match) as AiApprovalReviewedData
    return {
      reviewId: data.reviewId,
      ...(data.callId === undefined ? {} : { callId: data.callId }),
      toolName: data.toolName,
      reason: data.reason,
      provider: data.provider,
      model: data.model,
      ...(data.reasoningEffort === undefined ? {} : { reasoningEffort: data.reasoningEffort }),
      ...(data.imageMode === undefined ? {} : { imageMode: data.imageMode }),
      cwd: data.cwd,
      risk: data.risk,
      authorization: data.authorization,
      outcome: data.outcome,
      ...(data.policyBlock === undefined ? {} : { policyBlock: data.policyBlock }),
      status: data.approvalOutcome,
      rationale: data.rationale,
      attempts: data.attempts,
      durationMs: data.durationMs,
      ...(data.images === undefined ? {} : { images: data.images }),
    }
  },
  publication: () => 'immediate',
  buildViewNode(context): ChatConversationViewNode | null {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'ai-approval-review',
      id: context.id,
      target: 'chat',
      data: context.state,
      anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
      location: locationOf(context),
      visibility: 'visible',
    }
  },
}

export function installAiApprovalConversationNode(ctx: ClientContext): void {
  ctx.uiConversation.events.register(aiApprovalReviewDefinition)
  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.node',
        key: 'ai-approval-review',
        // The keyed Chat slot's copy lives in the Chat package's own `chat`
        // dictionary, so the framework-synthesized `t` seat must bind that
        // namespace rather than the Conversation shell's.
        locale: 'chat',
      },
      AiApprovalReviewCard,
    ),
  )
}
