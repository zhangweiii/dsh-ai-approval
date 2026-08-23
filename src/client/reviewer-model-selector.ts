import {
  createElement,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReviewerRoute } from '../config.js'

const SETTINGS_NAMESPACE = 'ai-approval-reviewer'
export const CODEX_AUTO_REVIEW_MODEL = 'codex-auto-review'

interface RpcErrorView {
  message: string
}

interface RpcResponseView<T> {
  result: { ok: true; value: T } | { ok: false; error: RpcErrorView }
}

export interface ReviewerCatalogModel {
  id: string
  name: string
  description?: string
  inputModalities?: Array<'text' | 'image'>
  reasoning?: {
    efforts: Array<{ id: string; name: string; description?: string }>
    defaultEffort?: string
  }
}

export interface ReviewerCatalogGroup {
  id: string
  name: string
  models: ReviewerCatalogModel[]
}

interface ReviewerSettingsView {
  ns: string
  value: unknown
  revision: number
}

export interface ReviewerModelApi {
  llm: {
    models(payload: {}): Promise<
      RpcResponseView<{
        groups: ReviewerCatalogGroup[]
        failures: Array<{ id: string; name: string; message: string }>
      }>
    >
  }
  settings: {
    describe(payload: {}): Promise<
      RpcResponseView<{
        writable: boolean
        hasDocument: boolean
        namespaces: ReviewerSettingsView[]
      }>
    >
    mutate(payload: {
      ns: string
      ops: Array<{ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }>
      expectedRevision?: number
    }): Promise<RpcResponseView<ReviewerSettingsView>>
  }
}

export interface ReviewerModelState {
  groups: ReviewerCatalogGroup[]
  failures: Array<{ id: string; name: string; message: string }>
  selection: ReviewerRoute
  writable: boolean
  revision: number
}

interface SettingsSectionSlots {
  inject(name: 'settings.section', callback: () => void): void
  register(
    options: {
      name: 'settings.section'
      id: string
      order: number
      label: string
    },
    component: () => ReactElement,
  ): () => void
}

function withCodexAutoReview(groups: ReviewerCatalogGroup[]): ReviewerCatalogGroup[] {
  return groups.map((group) => {
    if (group.id !== 'openai' || group.models.some((model) => model.id === CODEX_AUTO_REVIEW_MODEL))
      return group
    return {
      ...group,
      models: [
        {
          id: CODEX_AUTO_REVIEW_MODEL,
          name: 'Codex Auto Review',
          description: 'OpenAI Codex approval-review route, requested through DSH.',
          inputModalities: ['text', 'image'],
          reasoning: {
            efforts: [
              { id: 'low', name: 'Low' },
              { id: 'medium', name: 'Medium' },
              { id: 'high', name: 'High' },
              { id: 'xhigh', name: 'Extra high' },
            ],
            defaultEffort: 'low',
          },
        },
        ...group.models,
      ],
    }
  })
}

function valueOf<T>(response: RpcResponseView<T>): T {
  if (!response.result.ok) throw new Error(response.result.error.message)
  return response.result.value
}

function routeOf(value: unknown): ReviewerRoute {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid reviewer settings')
  const route = value as Record<string, unknown>
  if (typeof route.provider !== 'string' || typeof route.model !== 'string')
    throw new Error('Invalid reviewer route')
  return {
    provider: route.provider,
    model: route.model,
    ...(typeof route.reasoningEffort === 'string'
      ? { reasoningEffort: route.reasoningEffort }
      : {}),
    imageMode: route.imageMode === 'allow' ? 'allow' : 'omit',
  }
}

export function selectionKey(selection: Pick<ReviewerRoute, 'provider' | 'model'>): string {
  return JSON.stringify([selection.provider, selection.model])
}

export async function loadReviewerModelState(api: ReviewerModelApi): Promise<ReviewerModelState> {
  const [catalogResponse, settingsResponse] = await Promise.all([
    api.llm.models({}),
    api.settings.describe({}),
  ])
  const catalog = valueOf(catalogResponse)
  const settings = valueOf(settingsResponse)
  const section = settings.namespaces.find((item) => item.ns === SETTINGS_NAMESPACE)
  if (section === undefined) throw new Error('AI approval reviewer settings are unavailable')
  return {
    groups: withCodexAutoReview(catalog.groups),
    failures: catalog.failures,
    selection: routeOf(section.value),
    writable: settings.writable,
    revision: section.revision,
  }
}

export async function saveReviewerModelSelection(
  api: ReviewerModelApi,
  selection: ReviewerRoute,
  expectedRevision?: number,
): Promise<{ selection: ReviewerRoute; revision: number }> {
  const response = await api.settings.mutate({
    ns: SETTINGS_NAMESPACE,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    ops: [
      { op: 'set', path: ['provider'], value: selection.provider },
      { op: 'set', path: ['model'], value: selection.model },
      ...(selection.reasoningEffort === undefined
        ? [{ op: 'set' as const, path: ['reasoningEffort'], value: null }]
        : [
            {
              op: 'set' as const,
              path: ['reasoningEffort'],
              value: selection.reasoningEffort,
            },
          ]),
      { op: 'set', path: ['imageMode'], value: selection.imageMode ?? 'omit' },
    ],
  })
  const section = valueOf(response)
  return { selection: routeOf(section.value), revision: section.revision }
}

function isChinese(): boolean {
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')
}

function shield(): ReactElement {
  return createElement(
    'svg',
    {
      width: 17,
      height: 17,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      style: { flex: 'none', opacity: 0.72 },
    },
    createElement('path', { d: 'M12 3 20 6v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-3Z' }),
    createElement('path', { d: 'm8.7 12 2.1 2.1 4.6-4.8' }),
  )
}

const pageStyle: CSSProperties = {
  width: '100%',
  maxWidth: 760,
  margin: '0 auto',
  padding: '28px 24px 48px',
  color: 'inherit',
  boxSizing: 'border-box',
}

const summaryStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 18,
  marginTop: 24,
  padding: '16px 18px',
  border: '1px solid color-mix(in srgb, currentColor 16%, transparent)',
  borderRadius: 12,
  background: 'color-mix(in srgb, currentColor 4%, transparent)',
}

const modelButtonStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '20px minmax(0, 1fr)',
  alignItems: 'start',
  gap: 8,
  width: '100%',
  minHeight: 58,
  padding: '11px 12px',
  border: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
  borderRadius: 10,
  background: 'transparent',
  color: 'inherit',
  textAlign: 'left',
  font: 'inherit',
  cursor: 'pointer',
}

export function reviewerModelAcceptsImages(model: ReviewerCatalogModel): boolean {
  return model.inputModalities?.includes('image') === true
}

function modelOf(
  groups: ReviewerCatalogGroup[],
  selection: Pick<ReviewerRoute, 'provider' | 'model'>,
): ReviewerCatalogModel | undefined {
  return groups
    .find((group) => group.id === selection.provider)
    ?.models.find((model) => model.id === selection.model)
}

function selectedMark(active: boolean): ReactElement {
  return createElement(
    'span',
    {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        marginTop: 1,
        borderRadius: '50%',
        color: active ? '#2563eb' : 'transparent',
        background: active ? 'color-mix(in srgb, #2563eb 14%, transparent)' : 'transparent',
      },
      'aria-hidden': true,
    },
    active ? '✓' : '',
  )
}

export function ReviewerModelSelector({ api }: { api: ReviewerModelApi }): ReactElement {
  const [state, setState] = useState<ReviewerModelState>()
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const zh = isChinese()

  const refresh = async () => {
    try {
      setState(await loadReviewerModelState(api))
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    void refresh()
  }, [api])

  const currentModel = useMemo(
    () => (state === undefined ? undefined : modelOf(state.groups, state.selection)),
    [state],
  )
  const disabled = saving || state === undefined || !state.writable
  const currentName = currentModel?.name ?? state?.selection.model

  const save = async (selection: ReviewerRoute) => {
    if (state === undefined) return
    setSaving(true)
    try {
      const saved = await saveReviewerModelSelection(api, selection, state.revision)
      setState({ ...state, ...saved })
      setError(undefined)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      try {
        setState(await loadReviewerModelState(api))
      } catch {
        // Preserve the mutation error; the next focus retries both reads.
      }
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  return createElement(
    'section',
    {
      style: pageStyle,
      'aria-labelledby': 'ai-approval-reviewer-title',
      'aria-busy': saving,
    },
    createElement(
      'header',
      { style: { display: 'flex', alignItems: 'flex-start', gap: 13 } },
      createElement(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: 10,
            color: '#2563eb',
            background: 'color-mix(in srgb, #2563eb 12%, transparent)',
          },
        },
        shield(),
      ),
      createElement(
        'div',
        null,
        createElement(
          'h2',
          { id: 'ai-approval-reviewer-title', style: { margin: 0, fontSize: 20, lineHeight: 1.4 } },
          zh ? 'AI 审批' : 'AI approval',
        ),
        createElement(
          'p',
          { style: { margin: '5px 0 0', fontSize: 13, lineHeight: 1.55, opacity: 0.62 } },
          zh
            ? '为工具权限申请选择独立的审批模型。选择带“视觉”标记的模型会允许把预算内图片发送给该 Reviewer provider。'
            : 'Choose an independent reviewer for tool permission requests. Selecting a Vision model allows budgeted images to be sent to that reviewer provider.',
        ),
      ),
    ),
    ...(state === undefined
      ? [
          createElement(
            'div',
            {
              key: 'loading',
              role: error ? 'alert' : 'status',
              style: {
                ...summaryStyle,
                justifyContent: 'flex-start',
                color: error ? '#b45309' : 'inherit',
              },
            },
            error ?? (zh ? '正在加载审批模型…' : 'Loading approval models…'),
          ),
        ]
      : [
          createElement(
            'div',
            { key: 'summary', style: summaryStyle },
            createElement(
              'div',
              null,
              createElement(
                'div',
                { style: { fontSize: 12, opacity: 0.55 } },
                zh ? '当前审批模型' : 'Current reviewer',
              ),
              createElement(
                'div',
                { style: { marginTop: 4, fontSize: 14, fontWeight: 600 } },
                currentName,
              ),
              createElement(
                'div',
                { style: { marginTop: 3, fontSize: 11, opacity: 0.55 } },
                state.selection.imageMode === 'allow'
                  ? zh
                    ? '图片发送已启用'
                    : 'Image sharing enabled'
                  : zh
                    ? '图片发送关闭'
                    : 'Image sharing off',
              ),
            ),
            createElement(
              'code',
              {
                style: {
                  fontSize: 11,
                  opacity: 0.55,
                  overflowWrap: 'anywhere',
                  textAlign: 'right',
                },
              },
              `${state.selection.provider}/${state.selection.model}`,
            ),
          ),
          createElement(
            'div',
            { key: 'models', style: { marginTop: 26 } },
            createElement(
              'h3',
              { style: { margin: '0 0 14px', fontSize: 14 } },
              zh ? '审批模型' : 'Reviewer model',
            ),
            ...state.groups.map((group) =>
              createElement(
                'div',
                { key: group.id, style: { marginTop: 18 } },
                createElement(
                  'div',
                  { style: { marginBottom: 8, fontSize: 12, fontWeight: 600, opacity: 0.58 } },
                  group.name === group.id ? group.name : `${group.name} · ${group.id}`,
                ),
                createElement(
                  'div',
                  {
                    style: {
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                      gap: 8,
                    },
                  },
                  ...group.models.map((model) => {
                    const active =
                      state.selection.provider === group.id && state.selection.model === model.id
                    return createElement(
                      'button',
                      {
                        key: model.id,
                        type: 'button',
                        disabled,
                        'aria-pressed': active,
                        'data-model-key': selectionKey({ provider: group.id, model: model.id }),
                        style: {
                          ...modelButtonStyle,
                          borderColor: active
                            ? 'color-mix(in srgb, #2563eb 58%, transparent)'
                            : modelButtonStyle.border,
                          background: active
                            ? 'color-mix(in srgb, #2563eb 9%, transparent)'
                            : 'transparent',
                        },
                        onClick: () =>
                          void save({
                            provider: group.id,
                            model: model.id,
                            ...(model.reasoning?.defaultEffort === undefined
                              ? {}
                              : { reasoningEffort: model.reasoning.defaultEffort }),
                            imageMode: reviewerModelAcceptsImages(model) ? 'allow' : 'omit',
                          }),
                      },
                      selectedMark(active),
                      createElement(
                        'span',
                        { style: { minWidth: 0 } },
                        createElement(
                          'span',
                          {
                            style: {
                              display: 'flex',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: 6,
                              fontSize: 13,
                              fontWeight: active ? 600 : 450,
                            },
                          },
                          model.name,
                          ...(reviewerModelAcceptsImages(model)
                            ? [
                                createElement(
                                  'span',
                                  {
                                    key: 'vision',
                                    style: {
                                      padding: '1px 5px',
                                      borderRadius: 5,
                                      fontSize: 10,
                                      fontWeight: 600,
                                      color: '#2563eb',
                                      background: 'color-mix(in srgb, #2563eb 12%, transparent)',
                                    },
                                  },
                                  zh ? '视觉' : 'Vision',
                                ),
                              ]
                            : []),
                        ),
                        ...(model.description
                          ? [
                              createElement(
                                'span',
                                {
                                  key: 'description',
                                  style: {
                                    display: 'block',
                                    marginTop: 3,
                                    fontSize: 11,
                                    lineHeight: 1.4,
                                    opacity: 0.52,
                                  },
                                },
                                model.description,
                              ),
                            ]
                          : []),
                      ),
                    )
                  }),
                ),
              ),
            ),
          ),
          ...(currentModel?.reasoning?.efforts.length
            ? [
                createElement(
                  'div',
                  {
                    key: 'reasoning',
                    style: {
                      marginTop: 26,
                      paddingTop: 20,
                      borderTop: '1px solid color-mix(in srgb, currentColor 12%, transparent)',
                    },
                  },
                  createElement(
                    'h3',
                    { style: { margin: '0 0 5px', fontSize: 14 } },
                    zh ? '推理强度' : 'Reasoning effort',
                  ),
                  createElement(
                    'p',
                    { style: { margin: '0 0 12px', fontSize: 12, opacity: 0.55 } },
                    zh
                      ? '仅影响审批模型，不会改变当前对话模型。'
                      : 'Only affects the reviewer, not the conversation model.',
                  ),
                  createElement(
                    'div',
                    { style: { display: 'flex', flexWrap: 'wrap', gap: 7 } },
                    ...[
                      { id: '', name: zh ? '默认' : 'Default' },
                      ...currentModel.reasoning.efforts,
                    ].map((effort) => {
                      const active = (state.selection.reasoningEffort ?? '') === effort.id
                      return createElement(
                        'button',
                        {
                          key: effort.id || 'default',
                          type: 'button',
                          disabled,
                          'aria-pressed': active,
                          'data-reasoning-effort': effort.id,
                          onClick: () =>
                            void save({
                              provider: state.selection.provider,
                              model: state.selection.model,
                              ...(effort.id ? { reasoningEffort: effort.id } : {}),
                              imageMode: state.selection.imageMode ?? 'omit',
                            }),
                          style: {
                            padding: '7px 12px',
                            border: '1px solid color-mix(in srgb, currentColor 16%, transparent)',
                            borderRadius: 8,
                            background: active
                              ? 'color-mix(in srgb, #2563eb 12%, transparent)'
                              : 'transparent',
                            color: 'inherit',
                            font: 'inherit',
                            fontSize: 12,
                            cursor: disabled ? 'not-allowed' : 'pointer',
                            opacity: disabled ? 0.58 : 1,
                          },
                        },
                        effort.name,
                      )
                    }),
                  ),
                ),
              ]
            : []),
          ...(state.failures.length
            ? [
                createElement(
                  'div',
                  {
                    key: 'failures',
                    role: 'status',
                    style: { marginTop: 18, fontSize: 11, lineHeight: 1.5, opacity: 0.58 },
                  },
                  state.failures.map((failure) => `${failure.name}: ${failure.message}`).join('；'),
                ),
              ]
            : []),
          ...(error
            ? [
                createElement(
                  'div',
                  {
                    key: 'error',
                    role: 'alert',
                    style: {
                      marginTop: 18,
                      padding: '10px 12px',
                      borderRadius: 8,
                      color: '#b45309',
                      background: 'color-mix(in srgb, #b45309 10%, transparent)',
                      fontSize: 12,
                    },
                  },
                  error,
                ),
              ]
            : []),
          ...(!state.writable
            ? [
                createElement(
                  'div',
                  {
                    key: 'readonly',
                    role: 'status',
                    style: { marginTop: 14, fontSize: 12, opacity: 0.58 },
                  },
                  zh ? '当前设置为只读，无法修改审批模型。' : 'Settings are read-only.',
                ),
              ]
            : []),
        ]),
  )
}

export function installReviewerModelSelector(ctx: ClientContext): void {
  const connection = (ctx as ClientContext & { connection?: { api: ReviewerModelApi } }).connection
  if (connection === undefined) return
  // The host owns this slot; keep the adapter narrow so conversation-package type changes stay localized.
  const slots = ctx.slots as unknown as SettingsSectionSlots
  const Entry = () => createElement(ReviewerModelSelector, { api: connection.api })
  slots.inject('settings.section', () =>
    slots.register(
      {
        name: 'settings.section',
        id: 'ai-approval-reviewer',
        order: 70,
        label: isChinese() ? 'AI 审批' : 'AI approval',
      },
      Entry,
    ),
  )
}
