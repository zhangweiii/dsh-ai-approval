import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { PermissionPresetService } from '@deepseek-ai/dsh-permission-presets'
import type { ResolvedConfig } from './config.js'
import { privacyText } from './privacy.js'
import type { ReviewerRouteSource } from './reviewer-route-settings.js'

interface CommandsService {
  register(definition: CommandDefinition): () => void
}

/** Shared live readiness of the approval handler behind operator diagnostics. */
export class ReviewerReadiness {
  private installations = 0

  activate(): () => void {
    this.installations++
    let active = true
    return () => {
      if (!active) return
      active = false
      this.installations--
    }
  }

  isReady(): boolean {
    return this.installations > 0
  }
}

function displayValue(value: string, config: ResolvedConfig): string {
  return privacyText(value, config.redactPaths).replace(/[\u0000-\u001f\u007f]+/g, ' ')
}

function routeText(route: ReviewerRouteSource, config: ResolvedConfig): string {
  const current = route.get()
  const provider = displayValue(current.provider, config)
  const model = displayValue(current.model, config)
  const reasoning =
    current.reasoningEffort === undefined
      ? ''
      : ` · reasoning ${displayValue(current.reasoningEffort, config)}`
  return `${provider}/${model}${reasoning} · images ${current.imageMode ?? 'omit'}`
}

function statusText(
  config: ResolvedConfig,
  route: ReviewerRouteSource,
  permissionPresets: PermissionPresetService,
  readiness: ReviewerReadiness,
  agent: Agent,
): string {
  const currentPreset = permissionPresets.current(agent.session)
  const active = readiness.isReady() && currentPreset === config.presetName
  const state = readiness.isReady() ? (active ? 'active' : 'inactive') : 'unavailable'
  return [
    `dsh-ai-approval: ${state}`,
    `preset=${displayValue(currentPreset, config)} (required ${displayValue(config.presetName, config)})`,
    `route=${routeText(route, config)}`,
    `policy=maxRisk ${config.maxRisk}, minAuthorization ${config.minAuthorization}`,
    `privacy=context ${config.contextMode}, redactPaths ${String(config.redactPaths)}, sendSessionId ${String(config.sendSessionId)}`,
  ].join('\n')
}

function doctorText(
  config: ResolvedConfig,
  route: ReviewerRouteSource,
  permissionPresets: PermissionPresetService,
  readiness: ReviewerReadiness,
  agent: Agent,
): string {
  const currentPreset = permissionPresets.current(agent.session)
  const presetMatches = currentPreset === config.presetName
  const active = readiness.isReady() && presetMatches
  const presetDetail = active
    ? '(reviewer active)'
    : presetMatches
      ? '(preset matches, reviewer runtime unavailable)'
      : `(select ${displayValue(config.presetName, config)} to activate)`
  return [
    'dsh-ai-approval doctor',
    '✓ plugin command is loaded',
    `${readiness.isReady() ? '✓' : '!'} reviewer runtime: ${readiness.isReady() ? 'ready' : 'unavailable (LLM service not installed)'}`,
    `${active ? '✓' : '!'} session preset: ${displayValue(currentPreset, config)} ${presetDetail}`,
    `${route.isWritable() ? '✓' : '!'} reviewer settings: ${route.isWritable() ? 'writable' : 'base route only'}`,
    `✓ reviewer route: ${routeText(route, config)}`,
    `✓ fail-closed limits: ${config.maxInputBytes} text bytes, ${config.timeoutMs} ms, ${config.maxAttempts} attempt(s)`,
    'ℹ provider connectivity is not probed; doctor sends no model request',
  ].join('\n')
}

/** Install operator commands without changing reviewer approval semantics. */
export function installReviewerCommands(
  ctx: Context,
  config: ResolvedConfig,
  route: ReviewerRouteSource,
  readiness: ReviewerReadiness,
): void {
  ctx.inject(['commands', 'permissionPresets'], (scope) => {
    const commands = (scope as Context & { commands?: CommandsService }).commands
    const permissionPresets = (scope as Context & { permissionPresets?: PermissionPresetService })
      .permissionPresets
    if (commands === undefined || permissionPresets === undefined) return

    scope.effect(
      () =>
        commands.register({
          name: 'ai-approval',
          description: '查看 AI 审批状态并诊断配置',
          input: { hint: '[status|doctor|help]' },
          recordInput: false,
          handler: async (invocation) => {
            const operation = invocation.rawInput.trim() || 'status'
            if (operation === 'status') {
              return {
                kind: 'success',
                text: statusText(config, route, permissionPresets, readiness, invocation.agent),
              }
            }
            if (operation === 'doctor') {
              return {
                kind: 'success',
                text: doctorText(config, route, permissionPresets, readiness, invocation.agent),
              }
            }
            if (operation === 'help') {
              return {
                kind: 'success',
                text: '/ai-approval [status|doctor|help]\n/ai-approval-models — 选择 Reviewer route',
              }
            }
            return {
              kind: 'error',
              text: '未知操作；请使用 /ai-approval help',
            }
          },
        }),
      'dsh-ai-approval: status command',
    )

    scope.effect(
      () =>
        commands.register({
          name: 'ai-approval-models',
          description: '选择 AI 审批模型',
          handler: async () => ({
            kind: 'success',
            text: `当前 AI 审批模型：${routeText(route, config)}。请在 DSH Web 的命令选择器中切换模型。`,
          }),
        }),
      'dsh-ai-approval: model command',
    )
  })
}
