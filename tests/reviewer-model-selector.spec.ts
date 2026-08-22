import { describe, expect, it } from 'vitest'
import {
  CODEX_AUTO_REVIEW_MODEL,
  loadReviewerModelState,
  saveReviewerModelSelection,
  selectionKey,
} from '../src/client/reviewer-model-selector.ts'

function ok<T>(value: T) {
  return { result: { ok: true as const, value } }
}

describe('reviewer model selector data flow', () => {
  it('loads every registered DSH provider group and the persisted reviewer route', async () => {
    const api = {
      llm: {
        models: async () =>
          ok({
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
              {
                ns: 'ai-approval-reviewer',
                value: { provider: 'openai', model: 'gpt-5.2', reasoningEffort: 'medium' },
                revision: 4,
              },
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
    })
    expect(state.revision).toBe(4)
    expect(selectionKey(state.selection)).toBe('["openai","gpt-5.2"]')
  })

  it('does not expose the Codex reviewer route without a DSH OpenAI provider group', async () => {
    const api = {
      llm: {
        models: async () =>
          ok({
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
              {
                ns: 'ai-approval-reviewer',
                value: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
                revision: 1,
              },
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

  it('updates only route fields and unsets stale reasoning through DSH settings', async () => {
    const requests: unknown[] = []
    const api = {
      llm: { models: async () => ok({ groups: [], failures: [] }) },
      settings: {
        describe: async () => ok({ writable: true, hasDocument: true, namespaces: [] }),
        mutate: async (request: unknown) => {
          requests.push(request)
          return ok({
            ns: 'ai-approval-reviewer',
            value: { provider: 'local', model: 'reviewer' },
            revision: 8,
          })
        },
      },
    }

    const saved = await saveReviewerModelSelection(api, { provider: 'local', model: 'reviewer' }, 7)
    expect(requests).toEqual([
      {
        ns: 'ai-approval-reviewer',
        expectedRevision: 7,
        ops: [
          { op: 'set', path: ['provider'], value: 'local' },
          { op: 'set', path: ['model'], value: 'reviewer' },
          { op: 'unset', path: ['reasoningEffort'] },
        ],
      },
    ])
    expect(saved.revision).toBe(8)
  })

  it('surfaces DSH business errors without falling back to another provider', async () => {
    const api = {
      llm: {
        models: async () => ({
          result: {
            ok: false as const,
            error: { message: 'model catalog unavailable' },
          },
        }),
      },
      settings: {
        describe: async () => ok({ writable: true, hasDocument: true, namespaces: [] }),
        mutate: async () => ok({ value: {}, revision: 0 }),
      },
    }
    await expect(loadReviewerModelState(api)).rejects.toThrow('model catalog unavailable')
  })
})
