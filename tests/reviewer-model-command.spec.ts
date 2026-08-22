import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { installReviewerModelCommand } from '../src/reviewer-model-command.ts'
import { ReviewerRouteSource } from '../src/reviewer-route-settings.ts'

describe('/ai-approval-models', () => {
  it('registers a bare command without advertising manual route input', async () => {
    let definition: any
    const active = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    const route = new ReviewerRouteSource(active)
    const scope: any = {
      commands: { register: (value: unknown) => void (definition = value) },
    }
    const ctx = {
      inject: (_dependencies: string[], callback: (injected: any) => void) => callback(scope),
    } as unknown as Context
    installReviewerModelCommand(ctx, route)

    const listed = await definition.handler({ rawInput: '', signal: new AbortController().signal })
    expect(listed).toMatchObject({ kind: 'success' })
    expect(listed.text).toContain('deepseek-official/deepseek-v4-flash')
    expect(definition).not.toHaveProperty('input')
    expect(listed.text).not.toContain('<provider>/<model>')
  })
})
