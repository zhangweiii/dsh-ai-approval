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
  return { result: { ok: true as const, value } }
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
          inputModalities: ['text', 'image'],
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
    llm: { models: vi.fn(async () => ok({ groups: state.groups, failures: [] })) },
    settings: {
      describe: vi.fn(async () =>
        ok({
          writable: true,
          hasDocument: true,
          namespaces: [
            {
              ns: 'dsh-ai-approval',
              value: state.selection,
              revision: state.revision,
            },
          ],
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
      vi.fn(async () =>
        ok({
          ns: 'dsh-ai-approval',
          value: { provider: 'local', model: 'reviewer' },
          revision: 4,
        }),
      ),
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
      expect.objectContaining({
        expectedRevision: 3,
        ops: expect.arrayContaining([
          { op: 'set', path: ['provider'], value: 'local' },
          { op: 'set', path: ['reasoningEffort'], value: null },
          { op: 'set', path: ['imageMode'], value: 'omit' },
        ]),
      }),
    )

    const mediumEffort = pageNodes.find(
      (node) => node.type === 'button' && node.props['data-reasoning-effort'] === 'medium',
    )
    mediumEffort.props.onClick()
    await vi.waitFor(() => expect(api.settings.mutate).toHaveBeenCalledTimes(2))
    hooks.effects[0]?.()
    await vi.waitFor(() => expect(api.llm.models).toHaveBeenCalled())
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
    vi.mocked(api.llm.models).mockRejectedValueOnce(new Error('catalog failed'))
    const element = render(api, [undefined, undefined, false])
    expect(JSON.stringify(element.props.children)).toContain('正在加载审批模型')
    hooks.effects[0]?.()
    await vi.waitFor(() => expect(hooks.setters[1]).toHaveBeenCalledWith('catalog failed'))
  })

  it('registers only through the additive Web settings section when connection exists', () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' })
    let Entry: (() => unknown) | undefined
    const ctx = {
      connection: { api: apiFixture() },
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
