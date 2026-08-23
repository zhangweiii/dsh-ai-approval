import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { resolveConfig } from '../src/config.ts'
import { installReviewerCommands, ReviewerReadiness } from '../src/reviewer-command.ts'
import { ReviewerRouteSource } from '../src/reviewer-route-settings.ts'

function fixture(preset = 'ai-approval', ready = true) {
  const definitions: any[] = []
  const scope: any = {
    commands: {
      register: (value: unknown) => {
        definitions.push(value)
        return vi.fn()
      },
    },
    permissionPresets: { current: () => preset },
    effect: (setup: () => unknown) => setup(),
  }
  const ctx = {
    inject: (_dependencies: string[], callback: (injected: any) => void) => callback(scope),
  } as unknown as Context
  const route = new ReviewerRouteSource({
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    imageMode: 'omit',
  })
  const config = resolveConfig({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  const readiness = new ReviewerReadiness()
  const deactivate = ready ? readiness.activate() : undefined
  installReviewerCommands(ctx, config, route, readiness)
  const agent = { session: { events: [] } } as unknown as Agent
  const invoke = (name: string, rawInput = '') =>
    definitions
      .find((definition) => definition.name === name)
      .handler({ rawInput, signal: new AbortController().signal, agent })
  return { definitions, invoke, route, deactivate }
}

describe('AI approval operator commands', () => {
  it('keeps the model picker command and reports the active reviewer route', async () => {
    const { definitions, invoke } = fixture()

    expect(definitions.map((definition) => definition.name)).toEqual([
      'ai-approval',
      'ai-approval-models',
    ])
    expect(definitions.find((definition) => definition.name === 'ai-approval')).toMatchObject({
      recordInput: false,
    })
    const listed = await invoke('ai-approval-models')
    expect(listed).toMatchObject({ kind: 'success' })
    expect(listed.text).toContain('deepseek-official/deepseek-v4-flash')
    expect(
      definitions.find((definition) => definition.name === 'ai-approval-models'),
    ).not.toHaveProperty('input')
  })

  it('reports status and diagnoses activation without probing the provider', async () => {
    const active = fixture()
    const status = await active.invoke('ai-approval', 'status')
    expect(status).toMatchObject({ kind: 'success' })
    expect(status.text).toContain('dsh-ai-approval: active')
    expect(status.text).toContain('maxRisk high')
    active.route.useWriter(async () => undefined)
    expect((await active.invoke('ai-approval', 'doctor')).text).toContain(
      'reviewer settings: writable',
    )
    active.deactivate?.()
    expect((await active.invoke('ai-approval', 'status')).text).toContain(
      'dsh-ai-approval: unavailable',
    )

    const unavailable = fixture('ai-approval', false)
    expect((await unavailable.invoke('ai-approval', 'status')).text).toContain(
      'dsh-ai-approval: unavailable',
    )
    expect((await unavailable.invoke('ai-approval', 'doctor')).text).toContain(
      'reviewer runtime: unavailable',
    )

    const inactive = fixture('token=operator-secret')
    inactive.route.use(() => ({
      provider: 'authorization=Bearer route-secret',
      model: '/Users/alice/private-model',
      imageMode: 'omit',
    }))
    const doctor = await inactive.invoke('ai-approval', 'doctor')
    expect(doctor).toMatchObject({ kind: 'success' })
    expect(doctor.text).toContain('select ai-approval to activate')
    expect(doctor.text).toContain('base route only')
    expect(doctor.text).toContain('sends no model request')
    expect(doctor.text).not.toContain('operator-secret')
    expect(doctor.text).not.toContain('route-secret')
    expect(doctor.text).not.toContain('/Users/alice')

    const unknown = await inactive.invoke('ai-approval', 'unexpected token=command-secret')
    expect(unknown).toMatchObject({ kind: 'error' })
    expect(unknown.text).not.toContain('command-secret')
  })
})
