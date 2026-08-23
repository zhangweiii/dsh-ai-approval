import type { Context } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'
import {
  ReviewerRouteConfig,
  resolveReviewerRoute,
  type ResolvedConfig,
  type ReviewerRoute,
  type ReviewerRouteSettings,
} from './config.js'

export const REVIEWER_SETTINGS_NAMESPACE = 'dsh-ai-approval'

interface SettingsScope<T> {
  get(): T
  replace(section: object): Promise<void>
}

interface SettingsService {
  register<T>(
    namespace: string,
    schema: z<T>,
    options: { base: Partial<T>; applies: 'live'; validate: (value: T) => void },
  ): SettingsScope<T>
}

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

/** Optionally bind the route to DSH's persisted settings service. */
export function installReviewerRouteSettings(
  ctx: Context,
  config: ResolvedConfig,
  source: ReviewerRouteSource,
): void {
  ctx.inject(['settings'], (scope) => {
    const settings = (scope as Context & { settings?: SettingsService }).settings
    if (settings === undefined) return
    const route = settings.register(REVIEWER_SETTINGS_NAMESPACE, ReviewerRouteConfig, {
      base: {
        provider: config.provider,
        model: config.model,
        ...(config.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: config.reasoningEffort }),
        imageMode: config.imageMode,
      },
      applies: 'live',
      validate: (value) => void resolveReviewerRoute(value),
    })
    source.use(() => route.get())
    source.useWriter((selection) =>
      route.replace({
        ...selection,
        reasoningEffort: selection.reasoningEffort ?? null,
      }),
    )
    scope.effect(() => () => source.reset())
  })
}
