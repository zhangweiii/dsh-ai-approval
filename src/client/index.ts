import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installAiApprovalConversationNode } from './conversation.js'
import { installReviewerModelCommandPicker } from './reviewer-model-command-picker.js'
import { installReviewerModelSelector } from './reviewer-model-selector.js'

export const inject = ['conversationEvents', 'slots', 'connection', 'commandUi']

export function apply(ctx: ClientContext): void {
  installAiApprovalConversationNode(ctx)
  installReviewerModelSelector(ctx)
  installReviewerModelCommandPicker(ctx)
}
