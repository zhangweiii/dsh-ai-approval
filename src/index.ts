/** Independent AI reviewer for one-shot agent approval requests. */
import { Context } from '@deepseek-ai/cordis'
import type { PermissionPresetService } from '@deepseek-ai/dsh-permission-presets'
import { resolveConfig, Config } from './config.js'
import { AiApprovalPlugin } from './plugin.js'
import { installReviewerRouteSettings, ReviewerRouteSource } from './reviewer-route-settings.js'
import { installReviewerCommands, ReviewerReadiness } from './reviewer-command.js'
export * from './assessment.js'
export * from './config.js'
export * from './types.js'
export { REVIEWER_SETTINGS_NAMESPACE } from './reviewer-route-settings.js'
export type { Config as PluginConfig } from './config.js'
export { redactSensitiveText } from './privacy.js'
export {
  buildReviewContext,
  buildReviewPrompt,
  estimateReviewImageTokens,
  GUARDIAN_MAX_IMAGE_ITEM_TOKENS,
  REVIEW_IMAGE_OMITTED_TEXT,
  ReviewInputTooLargeError,
  type ReviewContext,
  type ReviewImageAudit,
  type ReviewImageStats,
} from './review-context.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    permissionPresets: PermissionPresetService
  }
}
/**
 * Install the independent AI approval reviewer plugin.
 *
 * Deliberately the ONLY plugin export shape: DSH 0.1.7's Loader normalizes a
 * module to `exports.default ?? exports`, so a `export default apply` makes the
 * whole module resolve to this bare function and hides the `Config` schema. The
 * settings form reads `entry.fiber.runtime.Config`, so that shadowing silently
 * removed the reviewer page from Settings. Exporting named `apply` + `Config`
 * keeps the module object as the plugin, which is how DSH's own function
 * plugins are shaped.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const route = new ReviewerRouteSource(resolved)
  const readiness = new ReviewerReadiness()
  installReviewerRouteSettings(ctx, config, route)
  installReviewerCommands(ctx, resolved, route, readiness)
  ctx.inject(['llm', 'permissionPresets'], (scope) => {
    new AiApprovalPlugin(scope, resolved, route).install()
    scope.effect(() => readiness.activate(), 'dsh-ai-approval: reviewer runtime readiness')
  })
}
