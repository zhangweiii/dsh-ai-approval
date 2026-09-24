import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  CODEX_AUTO_REVIEW_MODEL,
  loadReviewerModelState,
  saveReviewerModelSelection,
  selectionKey,
} from '../src/client/reviewer-model-selector.ts'

function ok<T>(value: T) {
  return { ok: true as const, value }
}

function fail(message: string) {
  return { ok: false as const, error: new RemoteError('gateway/internal', message, {}) }
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

describe('reviewer model selector data flow', () => {
  it('loads every registered DSH provider group and the persisted reviewer route', async () => {
    const api = {
      session: {
        modelCatalog: async () =>
          ok({
            default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
            routableProviders: ['deepseek-official', 'openai'],
            groups: [
              {
                id: 'deepseek-official',
                name: 'DeepSeek',
                models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }],
              },
              {
                id: 'openai',
                name: 'OpenAI',
                models: [
                  {
                    id: 'gpt-5.2',
                    name: 'GPT-5.2',
                    reasoning: {
                      efforts: [
                        { id: 'low', name: 'Low' },
                        { id: 'medium', name: 'Medium' },
                      ],
                      defaultEffort: 'medium',
                    },
                  },
                ],
              },
            ],
            failures: [],
          }),
      },
      settings: {
        describe: async () =>
          ok({
            writable: true,
            hasDocument: true,
            namespaces: [
              namespaceView({ provider: 'openai', model: 'gpt-5.2', reasoningEffort: 'medium' }, 4),
            ],
          }),
        mutate: async () => {
          throw new Error('not used')
        },
      },
    }

    const state = await loadReviewerModelState(api)
    expect(state.groups.map((group) => group.id)).toEqual(['deepseek-official', 'openai'])
    expect(state.groups[1]?.models.map((model) => model.id)).toEqual([
      CODEX_AUTO_REVIEW_MODEL,
      'gpt-5.2',
    ])
    expect(state.groups[1]?.models[0]?.reasoning?.defaultEffort).toBe('low')
    expect(state.selection).toEqual({
      provider: 'openai',
      model: 'gpt-5.2',
      reasoningEffort: 'medium',
      imageMode: 'omit',
    })
    expect(state.revision).toBe(4)
    expect(selectionKey(state.selection)).toBe('["openai","gpt-5.2"]')
  })

  it('does not expose the Codex reviewer route without a DSH OpenAI provider group', async () => {
    const api = {
      session: {
        modelCatalog: async () =>
          ok({
            default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
            routableProviders: ['deepseek-official'],
            groups: [
              {
                id: 'deepseek-official',
                name: 'DeepSeek',
                models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }],
              },
            ],
            failures: [],
          }),
      },
      settings: {
        describe: async () =>
          ok({
            writable: true,
            hasDocument: true,
            namespaces: [
              namespaceView({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, 1),
            ],
          }),
        mutate: async () => {
          throw new Error('not used')
        },
      },
    }

    const state = await loadReviewerModelState(api)
    expect(state.groups.flatMap((group) => group.models.map((model) => model.id))).not.toContain(
      CODEX_AUTO_REVIEW_MODEL,
    )
  })

  it('updates only route fields and masks stale base reasoning through DSH settings', async () => {
    const requests: unknown[] = []
    const api = {
      session: {
        modelCatalog: async () =>
          ok({
            default: { provider: 'local', model: 'reviewer' },
            routableProviders: [],
            groups: [],
            failures: [],
          }),
      },
      settings: {
        describe: async () => ok({ writable: true, hasDocument: true, namespaces: [] }),
        mutate: async (...args: unknown[]) => {
          requests.push(args)
          return ok(namespaceView({ provider: 'local', model: 'reviewer' }, 8))
        },
      },
    }

    const saved = await saveReviewerModelSelection(api, { provider: 'local', model: 'reviewer' }, 7)
    expect(requests).toEqual([
      [
        'dsh-ai-approval',
        [
          { op: 'set', path: ['provider'], value: 'local' },
          { op: 'set', path: ['model'], value: 'reviewer' },
          { op: 'set', path: ['reasoningEffort'], value: null },
          { op: 'set', path: ['imageMode'], value: 'omit' },
        ],
        7,
      ],
    ])
    expect(saved.revision).toBe(8)
  })

  it('surfaces DSH business errors without falling back to another provider', async () => {
    const api = {
      session: {
        modelCatalog: async () => fail('model catalog unavailable'),
      },
      settings: {
        describe: async () => ok({ writable: true, hasDocument: true, namespaces: [] }),
        mutate: async () => ok(namespaceView({}, 0)),
      },
    }
    await expect(loadReviewerModelState(api)).rejects.toThrow('model catalog unavailable')
  })
})
