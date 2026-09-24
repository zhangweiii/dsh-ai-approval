import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-settings'
import {
  readRouteFields,
  resolveReviewerRoute,
  type Config,
  type ReviewerRoute,
  type ReviewerRouteSettings,
} from './config.js'

/** Profile entry id owning the reviewer route; DSH 0.1.7 addresses config by entry id. */
export const REVIEWER_SETTINGS_NAMESPACE = 'dsh-ai-approval'

/**
 * DSH 0.1.7 replaced the settings namespace-registration surface with
 * profile-entry configuration forms. The reviewer route therefore lives on the
 * plugin's own Config entry: the four route fields are declared `volatile()` in
 * {@link Config}, which is what makes them visible to the Web settings form and
 * mutable without reloading the plugin.
 */

/** Mutable indirection whose returned route is snapshotted at the start of each review. */
export class ReviewerRouteSource {
  private current: () => Readonly<ReviewerRoute>
  private replace: ((route: ReviewerRoute) => Promise<void>) | undefined

  constructor(private readonly base: Readonly<ReviewerRoute>) {
    this.current = () => base
  }

  get(): Readonly<ReviewerRoute> {
    return this.current()
  }

  isWritable(): boolean {
    return this.replace !== undefined
  }

  use(source: () => ReviewerRouteSettings): void {
    this.current = () => resolveReviewerRoute(source())
  }

  async select(route: ReviewerRoute): Promise<Readonly<ReviewerRoute>> {
    const resolved = resolveReviewerRoute(route)
    if (this.replace === undefined)
      throw new Error('AI 审批模型设置当前不可写，请确认 DSH settings 服务已启用')
    await this.replace(resolved)
    return this.get()
  }

  useWriter(replace: (route: ReviewerRoute) => Promise<void>): void {
    this.replace = replace
  }

  reset(): void {
    this.current = () => this.base
    this.replace = undefined
  }
}

/**
 * Bind the route to the live plugin Config and, when the host exposes them, to
 * DSH's settings form and configuration editor.
 *
 * The live read is always installed, because the volatile Config references are
 * the authoritative route under DSH 0.1.7: a form edit or a config-editor write
 * updates those references in place. The write path is additionally installed
 * only when the host offers the profile-editing services, which is what
 * `isWritable()` reports to `/ai-approval doctor`.
 */
export function installReviewerRouteSettings(
  ctx: Context,
  config: Config,
  source: ReviewerRouteSource,
): void {
  source.use(() => readRouteFields(config))

  // `configure` keys its page policy by the OWNING plugin fiber, and the fiber
  // inside an `inject` callback is a derived child — passing it would register
  // the policy against the wrong instance and silently leave the generated form
  // in place. Capture the plugin's own fiber while it is still current.
  const owner = ctx.fiber
  ctx.inject(['settings', 'configEditor'], (scope) => {
    const settings = scope.settings
    const editor = scope.configEditor
    const entry = owner?.entry
    if (settings === undefined || editor === undefined || entry === undefined) return
    // Keep the custom reviewer page as the entry's face; the auto-generated form
    // would otherwise duplicate the same four fields beside it.
    scope.effect(() => settings.configure({ auto: false }, owner))
    source.useWriter(async (selection) => {
      await editor.edit(entry, (current) => ({
        ...current,
        provider: selection.provider,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort ?? null,
        imageMode: selection.imageMode ?? 'omit',
      }))
    })
    scope.effect(() => () => source.reset())
  })
}
