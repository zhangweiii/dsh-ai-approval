import type { Context } from '@deepseek-ai/cordis'
import type { ReviewerRouteSource } from './reviewer-route-settings.js'

interface CommandResult {
  kind: 'success' | 'error'
  text: string
}

interface CommandsService {
  register(definition: {
    name: string
    description: string
    handler(invocation: { rawInput: string; signal: AbortSignal }): Promise<CommandResult>
  }): () => void
}

export function installReviewerModelCommand(ctx: Context, route: ReviewerRouteSource): void {
  ctx.inject(['commands'], (scope) => {
    const commands = (scope as Context & { commands?: CommandsService }).commands
    if (commands === undefined) return
    commands.register({
      name: 'ai-approval-models',
      description: '选择 AI 审批模型',
      handler: async () => {
        const current = route.get()
        const currentText = `${current.provider}/${current.model}${
          current.reasoningEffort === undefined ? '' : ` ${current.reasoningEffort}`
        }`
        return {
          kind: 'success',
          text: `当前 AI 审批模型：${currentText}。请在 DSH Web 的命令选择器中切换模型。`,
        }
      },
    })
  })
}
