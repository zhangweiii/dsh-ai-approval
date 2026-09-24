import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ReviewerRoute } from '../config.js'
import {
  loadReviewerModelState,
  reviewerModelAcceptsImages,
  saveReviewerModelSelection,
  type ReviewerCatalogModel,
  type ReviewerModelApi,
  type ReviewerModelState,
} from './reviewer-model-selector.js'

interface ClientSessionView {
  readonly sessionId: string
}

export interface ReviewerSelectOption {
  readonly id: string
  readonly label: string
  readonly detail?: string
  readonly active?: boolean
}

export interface ReviewerCommandDecoration {
  readonly name: 'ai-approval-models'
  available(session: ClientSessionView): boolean
  readonly ui: {
    readonly kind: 'popupSelect'
    options(
      session: ClientSessionView,
      signal: AbortSignal,
    ): Promise<readonly ReviewerSelectOption[]>
    onSelect(option: ReviewerSelectOption, session: ClientSessionView): void | Promise<void>
  }
}

interface CommandUiView {
  decorate(decoration: ReviewerCommandDecoration): () => void
}

interface ReviewerModelCommandContext extends ClientContext {
  commandUi?: CommandUiView
}

function effortName(model: ReviewerCatalogModel, effort: string | undefined): string | undefined {
  if (effort === undefined) return undefined
  return model.reasoning?.efforts.find((item) => item.id === effort)?.name ?? effort
}

function optionId(selection: ReviewerRoute, revision: number): string {
  return JSON.stringify([
    selection.provider,
    selection.model,
    selection.reasoningEffort ?? null,
    selection.imageMode ?? 'omit',
    revision,
  ])
}

function optionSelection(option: ReviewerSelectOption): {
  selection: ReviewerRoute
  revision: number
} {
  const value: unknown = JSON.parse(option.id)
  if (!Array.isArray(value) || value.length !== 5)
    throw new Error('Invalid AI approval model option')
  const [provider, model, reasoningEffort, imageMode, revision] = value
  if (
    typeof provider !== 'string' ||
    typeof model !== 'string' ||
    (reasoningEffort !== null && typeof reasoningEffort !== 'string') ||
    (imageMode !== 'omit' && imageMode !== 'allow') ||
    typeof revision !== 'number'
  )
    throw new Error('Invalid AI approval model option')
  return {
    selection: {
      provider,
      model,
      ...(reasoningEffort === null ? {} : { reasoningEffort }),
      imageMode,
    },
    revision,
  }
}

export function reviewerModelSelectOptions(
  state: ReviewerModelState,
): readonly ReviewerSelectOption[] {
  return state.groups.flatMap((group) =>
    group.models.map((model) => {
      const active = state.selection.provider === group.id && state.selection.model === model.id
      const reasoningEffort = active
        ? state.selection.reasoningEffort
        : model.reasoning?.defaultEffort
      const selection: ReviewerRoute = {
        provider: group.id,
        model: model.id,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
        imageMode: state.selection.imageMode ?? 'omit',
      }
      const effort = effortName(model, reasoningEffort)
      return {
        id: optionId(selection, state.revision),
        label: model.name,
        detail: `${group.name} · ${group.id}/${model.id}${
          reviewerModelAcceptsImages(model) ? ' · Vision' : ''
        }${effort === undefined ? '' : ` · ${effort}`}${active ? ` · images ${selection.imageMode}` : ''}`,
        ...(active ? { active: true } : {}),
      }
    }),
  )
}

/** Decorate the bare Web command with DSH's native popupSelect shell. */
export function installReviewerModelCommandPicker(ctx: ClientContext): void {
  const scope = ctx as ReviewerModelCommandContext
  const api = ctx.remote as ReviewerModelApi | undefined
  if (scope.commandUi === undefined || api === undefined) return
  const decoration: ReviewerCommandDecoration = {
    name: 'ai-approval-models',
    available: () => true,
    ui: {
      kind: 'popupSelect',
      options: async (_session, signal) => {
        if (signal.aborted) throw signal.reason
        const state = await loadReviewerModelState(api)
        if (!state.writable) throw new Error('AI 审批模型设置当前为只读')
        return reviewerModelSelectOptions(state)
      },
      onSelect: async (option) => {
        const { selection, revision } = optionSelection(option)
        await saveReviewerModelSelection(api, selection, revision)
      },
    },
  }
  scope.effect(() => scope.commandUi!.decorate(decoration), 'dsh-ai-approval: model command picker')
}
