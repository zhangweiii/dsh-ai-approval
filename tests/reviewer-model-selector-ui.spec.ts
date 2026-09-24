import { beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  index: 0,
  values: [] as unknown[],
  setters: [] as Array<ReturnType<typeof vi.fn>>,
  effects: [] as Array<() => void>,
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useState(initial: unknown) {
      const index = hooks.index++
      const setter = vi.fn()
      hooks.setters[index] = setter
      return [index < hooks.values.length ? hooks.values[index] : initial, setter]
    },
    useMemo(factory: () => unknown) {
      return factory()
    },
    useEffect(effect: () => void) {
      hooks.effects.push(effect)
    },
  }
})

import {
  installReviewerModelSelector,
  ReviewerModelSelector,
  type ReviewerModelApi,
  type ReviewerModelState,
} from '../src/client/reviewer-model-selector.ts'

function ok<T>(value: T) {
  return { ok: true as const, value }
}

function namespaceView(value: unknown, revision: number) {
  return {
    ns: 'dsh-ai-approval',
    schema: {},
    value,
    applies: 'live' as const,
    secrets: [],
    revision,
  }
}

const state: ReviewerModelState = {
  groups: [
    {
      id: 'openai',
      name: 'OpenAI',
      models: [
        {
          id: 'codex-auto-review',
          name: 'Codex Auto Review',
          reasoning: {
            efforts: [
              { id: 'low', name: 'Low' },
              { id: 'medium', name: 'Medium' },
            ],
            defaultEffort: 'low',
          },
        },
      ],
    },
    {
      id: 'local',
      name: 'Local',
      models: [{ id: 'reviewer', name: 'Reviewer' }],
    },
  ],
  failures: [],
  selection: {
    provider: 'openai',
    model: 'codex-auto-review',
    reasoningEffort: 'low',
    imageMode: 'allow',
  },
  writable: true,
  revision: 3,
}

function apiFixture(mutate = vi.fn()) {
  const api: ReviewerModelApi = {
    session: {
      modelCatalog: vi.fn(async () =>
        ok({
          default: { provider: 'openai', model: 'codex-auto-review' },
          routableProviders: ['openai', 'local'],
          groups: state.groups,
          failures: [],
        }),
      ),
    },
    settings: {
      describe: vi.fn(async () =>
        ok({
          writable: true,
          hasDocument: true,
          namespaces: [namespaceView(state.selection, state.revision)],
        }),
      ),
      mutate,
    },
  }
  return api
}

function render(api: ReviewerModelApi, values: unknown[]) {
  hooks.index = 0
  hooks.values = values
  hooks.setters = []
  hooks.effects = []
  return ReviewerModelSelector({ api }) as any
}

function nodes(root: any): any[] {
  if (root === null || root === undefined || typeof root !== 'object') return []
  const children = Array.isArray(root.props?.children)
    ? root.props.children
    : [root.props?.children].filter(Boolean)
  return [root, ...children.flatMap(nodes)]
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('reviewer model selector UI', () => {
  it('renders provider groups and reasoning as a Web settings page', async () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' })
    const api = apiFixture(
      vi.fn(async () => ok(namespaceView({ provider: 'local', model: 'reviewer' }, 4))),
    )
    const page = render(api, [state, undefined, false])
    const pageNodes = nodes(page)
    expect(page.type).toBe('section')
    expect(page.props['aria-labelledby']).toBe('dsh-ai-approval-title')
    expect(JSON.stringify(page.props.children)).toContain('AI 审批')
    expect(JSON.stringify(page.props.children)).toContain('Codex Auto Review')
    expect(JSON.stringify(page.props.children)).toContain('视觉')
    expect(pageNodes.some((node) => node.type === 'select')).toBe(false)
    const localModel = pageNodes.find(
      (node) => node.type === 'button' && node.props['data-model-key'] === '["local","reviewer"]',
    )
    localModel.props.onClick()
    await vi.waitFor(() => expect(api.settings.mutate).toHaveBeenCalledOnce())
    expect(api.settings.mutate).toHaveBeenCalledWith(
      'dsh-ai-approval',
      expect.arrayContaining([
        { op: 'set', path: ['provider'], value: 'local' },
        { op: 'set', path: ['reasoningEffort'], value: null },
        { op: 'set', path: ['imageMode'], value: 'allow' },
      ]),
      3,
    )

    const mediumEffort = pageNodes.find(
      (node) => node.type === 'button' && node.props['data-reasoning-effort'] === 'medium',
    )
    mediumEffort.props.onClick()
    await vi.waitFor(() => expect(api.settings.mutate).toHaveBeenCalledTimes(2))
    hooks.effects[0]?.()
    await vi.waitFor(() => expect(api.session.modelCatalog).toHaveBeenCalled())
  })

  it('toggles image sharing without changing the selected reviewer route', async () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' })
    const api = apiFixture(vi.fn(async () => ok(namespaceView(state.selection, 4))))
    const pageNodes = nodes(render(api, [state, undefined, false]))
    const off = pageNodes.find(
      (node) => node.type === 'button' && node.props['data-image-mode'] === 'omit',
    )
    off.props.onClick()
    await vi.waitFor(() => expect(api.settings.mutate).toHaveBeenCalledOnce())
    expect(api.settings.mutate).toHaveBeenCalledWith(
      'dsh-ai-approval',
      expect.arrayContaining([
        { op: 'set', path: ['provider'], value: 'openai' },
        { op: 'set', path: ['model'], value: 'codex-auto-review' },
        { op: 'set', path: ['reasoningEffort'], value: 'low' },
        { op: 'set', path: ['imageMode'], value: 'omit' },
      ]),
      3,
    )
  })

  it('keeps a mutation error visible after reloading the last committed selection', async () => {
    const api = apiFixture(vi.fn(async () => Promise.reject(new Error('settings conflict'))))
    const element = render(api, [state, undefined, false])
    const localModel = nodes(element).find(
      (node) => node.type === 'button' && node.props['data-model-key'] === '["local","reviewer"]',
    )
    localModel.props.onClick()
    await vi.waitFor(() => expect(hooks.setters[1]).toHaveBeenCalledWith('settings conflict'))
    expect(hooks.setters[0]).toHaveBeenCalledWith(expect.objectContaining({ revision: 3 }))
  })

  it('renders a disabled loading state and reports an initial catalog failure', async () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' })
    const api = apiFixture()
    vi.mocked(api.session.modelCatalog).mockRejectedValueOnce(new Error('catalog failed'))
    const element = render(api, [undefined, undefined, false])
    expect(JSON.stringify(element.props.children)).toContain('正在加载审批模型')
    hooks.effects[0]?.()
    await vi.waitFor(() => expect(hooks.setters[1]).toHaveBeenCalledWith('catalog failed'))
  })

  it('registers only through the additive Web settings section when the remote exists', () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' })
    let Entry: (() => unknown) | undefined
    const ctx = {
      remote: apiFixture(),
      slots: {
        inject: vi.fn((_name: string, callback: () => void) => callback()),
        register: vi.fn((_options: unknown, component: () => unknown) => {
          Entry = component
          return () => undefined
        }),
      },
    }
    installReviewerModelSelector(ctx as never)
    expect(ctx.slots.inject).toHaveBeenCalledWith('settings.section', expect.any(Function))
    expect(ctx.slots.register).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'settings.section',
        id: 'dsh-ai-approval',
        order: 70,
        label: 'AI 审批',
      }),
      expect.any(Function),
    )
    expect((Entry?.() as any).type).toBe(ReviewerModelSelector)

    installReviewerModelSelector({ slots: ctx.slots } as never)
    expect(ctx.slots.register).toHaveBeenCalledTimes(1)
  })
})
