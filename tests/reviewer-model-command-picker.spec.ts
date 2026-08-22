import { describe, expect, it, vi } from 'vitest'
import {
  installReviewerModelCommandPicker,
  type ReviewerCommandDecoration,
} from '../src/client/reviewer-model-command-picker.ts'
import type { ReviewerModelApi } from '../src/client/reviewer-model-selector.ts'

function ok<T>(value: T) {
  return { result: { ok: true as const, value } }
}

describe('/ai-approval-models Web picker', () => {
  it('lists every DSH model as a selectable option and saves the selected route', async () => {
    const mutate = vi.fn(async () =>
      ok({
        ns: 'ai-approval-reviewer',
        value: { provider: 'openai', model: 'gpt-5.2', reasoningEffort: 'medium' },
        revision: 5,
      }),
    )
    const api: ReviewerModelApi = {
      llm: {
        models: vi.fn(async () =>
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
        ),
      },
      settings: {
        describe: vi.fn(async () =>
          ok({
            writable: true,
            hasDocument: true,
            namespaces: [
              {
                ns: 'ai-approval-reviewer',
                value: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
                revision: 4,
              },
            ],
          }),
        ),
        mutate,
      },
    }
    let decoration: ReviewerCommandDecoration | undefined
    const dispose = vi.fn()
    const ctx = {
      connection: { api },
      commandUi: {
        decorate: vi.fn((next: ReviewerCommandDecoration) => {
          decoration = next
          return dispose
        }),
      },
      effect: vi.fn((setup: () => () => void) => setup()),
    }

    installReviewerModelCommandPicker(ctx as never)

    expect(decoration).toMatchObject({ name: 'ai-approval-models' })
    expect(decoration?.ui.kind).toBe('popupSelect')
    const options = await decoration!.ui.options(
      { sessionId: 'session-1' as never },
      new AbortController().signal,
    )
    expect(options.map((option) => option.label)).toEqual([
      'DeepSeek V4 Flash',
      'Codex Auto Review',
      'GPT-5.2',
    ])
    expect(options[0]).toMatchObject({ active: true })
    expect(options[2]?.detail).toContain('openai/gpt-5.2')

    await decoration!.ui.onSelect(options[2]!, { sessionId: 'session-1' as never })
    expect(mutate).toHaveBeenCalledWith({
      ns: 'ai-approval-reviewer',
      expectedRevision: 4,
      ops: [
        { op: 'set', path: ['provider'], value: 'openai' },
        { op: 'set', path: ['model'], value: 'gpt-5.2' },
        { op: 'set', path: ['reasoningEffort'], value: 'medium' },
      ],
    })
  })
})
