import { Context } from '@deepseek-ai/cordis'
import type { PermissionPresetService } from '@deepseek-ai/dsh-permission-presets'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { PendingExecutionRegistry } from './execution-correlation.js'
import { ReviewCoordinator } from './review-coordinator.js'
import type { ResolvedConfig } from './config.js'
import type { ReviewerRouteSource } from './reviewer-route-settings.js'

/** Guidance for the host agent while the AI Approval preset is active. */
export const AI_APPROVAL_SYSTEM_CONTEXT =
  'When the exact target is already known to be outside the current workspace or otherwise unavailable under the current sandbox, request a one-shot wider sandbox with sandbox_permissions and a concrete justification on the initial tool call instead of first attempting it under workspace-write. Do not request wider access for ordinary command errors, and do not change the session permission preset. If an approval is rejected, do not retry it through a workaround or another equivalent action; use a materially safer alternative or ask the user for explicit direction.'

export class AiApprovalPlugin {
  private readonly pending = new PendingExecutionRegistry()
  private readonly coordinator: ReviewCoordinator
  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
    route: ReviewerRouteSource,
  ) {
    this.coordinator = new ReviewCoordinator(ctx, config, undefined, route)
  }
  install() {
    this.ctx.on(
      'tools/pre-execute',
      (execution: ToolExecution, next: () => Promise<PreToolDecision>) => {
        this.pending.put(execution)
        return next()
      },
    )
    this.ctx.on('tools/result', (execution: Readonly<ToolExecution>) => {
      this.pending.remove(execution)
      return undefined
    })
    this.ctx.on(
      'approval/request',
      async (request: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => {
        if (
          this.ctx.permissionPresets.current(request.agent.session.events) !==
          this.config.presetName
        )
          return next()
        const execution = this.pending.lookup(request.agent.session.header.id, request.callId)
        return execution === undefined ? 'unavailable' : this.coordinator.review(request, execution)
      },
    )
    this.ctx.inject(['systemPrompt'], (scope) => {
      scope.systemPrompt.context({
        name: 'ai-approval:escalation',
        order: 116,
        text: ({ agent }) =>
          agent !== undefined &&
          this.ctx.permissionPresets.current(agent.session.events) === this.config.presetName
            ? AI_APPROVAL_SYSTEM_CONTEXT
            : '',
      })
    })
  }
}
