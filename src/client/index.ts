import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the 'uiConversation' service and its Definition contract.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the 'conversation.chat.node' SlotMap row and ChatNodeDataMap merge surface.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: the renderer-owned 'slots' registry merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { installAiApprovalConversationNode } from './conversation.js'
import { installReviewerModelCommandPicker } from './reviewer-model-command-picker.js'
import { installReviewerModelSelector } from './reviewer-model-selector.js'

export const inject = [
  'uiConversation',
  'slots',
  'commandUi',
  'remote',
  'remote.session',
  'remote.settings',
]

export function apply(ctx: ClientContext): void {
  installAiApprovalConversationNode(ctx)
  installReviewerModelSelector(ctx)
  installReviewerModelCommandPicker(ctx)
}
