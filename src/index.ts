/** Independent AI reviewer for one-shot agent approval requests. */
import { Context } from '@deepseek-ai/cordis'
import type { PermissionPresetService } from '@deepseek-ai/dsh-permission-presets'
import { resolveConfig, Config } from './config.js'
import { AiApprovalPlugin } from './plugin.js'
import { installReviewerRouteSettings, ReviewerRouteSource } from './reviewer-route-settings.js'
import { installReviewerModelCommand } from './reviewer-model-command.js'
export * from './assessment.js'
export * from './config.js'
export * from './types.js'
export { REVIEWER_SETTINGS_NAMESPACE } from './reviewer-route-settings.js'
export { redactSensitiveText } from './privacy.js'
export {
  buildReviewContext,
  buildReviewPrompt,
  estimateReviewImageTokens,
  GUARDIAN_MAX_IMAGE_ITEM_TOKENS,
  REVIEW_IMAGE_OMITTED_TEXT,
  type ReviewContext,
  type ReviewImageAudit,
  type ReviewImageStats,
} from './review-context.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    permissionPresets: PermissionPresetService
  }
}
/** Install the independent AI approval reviewer plugin. */
export function apply(ctx: Context, config: import('./config.js').Config): void {
  const resolved = resolveConfig(config)
  const route = new ReviewerRouteSource(resolved)
  installReviewerRouteSettings(ctx, resolved, route)
  installReviewerModelCommand(ctx, route)
  ctx.inject(['llm', 'permissionPresets'], (scope) => {
    new AiApprovalPlugin(scope, resolved, route).install()
  })
}
/** Default plugin installer; equivalent to {@link apply}. */
export default apply
