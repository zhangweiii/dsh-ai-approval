import { describe, expect, it } from 'vitest'
import type {
  ConversationMatch,
  ConversationNodeContext,
} from '@deepseek-ai/dsh-client-runtime/client'
import { aiApprovalReviewDefinition } from '../src/client/conversation.ts'

const started = {
  seq: 12,
  time: 100,
  type: 'ai-approval/review-started',
  data: {
    reviewId: 'call-1:1',
    callId: 'call-1',
    toolName: 'shell',
    reason: 'Network access is required.',
    provider: 'local',
    model: 'reviewer',
  },
} as any

const reviewed = {
  seq: 13,
  time: 200,
  type: 'ai-approval/reviewed',
  data: {
    ...started.data,
    cwd: '/workspace',
    risk: 'low',
    authorization: 'high',
    outcome: 'allow',
    approvalOutcome: 'allowed-once',
    rationale: 'The user explicitly requested this read-only check.',
    attempts: 1,
    durationMs: 100,
  },
} as any

function match(event: any, role: 'start' | 'update'): ConversationMatch {
  return { event, view: undefined, role, location: { kind: 'unresolved' } }
}

describe('AI approval conversation node', () => {
  it('correlates start and terminal events by review id', () => {
    expect(aiApprovalReviewDefinition.match(started)).toEqual({ id: 'call-1:1', role: 'start' })
    expect(aiApprovalReviewDefinition.match(reviewed)).toEqual({ id: 'call-1:1', role: 'update' })
    expect(aiApprovalReviewDefinition.match({ ...reviewed, data: { reviewId: '' } })).toBeNull()
  })

  it('folds reviewing into an allowed terminal card without changing identity', () => {
    const startMatch = match(started, 'start')
    const initialContext = {
      key: 'ai-approval-review:call-1:1',
      kind: 'ai-approval-review',
      id: 'call-1:1',
      matches: [startMatch],
      start: startMatch,
      state: undefined,
      current: new Map(),
    } satisfies ConversationNodeContext
    const running = aiApprovalReviewDefinition.start(initialContext, startMatch, {} as never)
    expect(running).toMatchObject({ status: 'reviewing', reason: 'Network access is required.' })

    const terminal = aiApprovalReviewDefinition.update(
      { ...initialContext, state: running },
      match(reviewed, 'update'),
    )
    expect(terminal).toMatchObject({
      status: 'allowed-once',
      risk: 'low',
      authorization: 'high',
      rationale: 'The user explicitly requested this read-only check.',
    })

    const node = aiApprovalReviewDefinition.buildViewNode?.({
      ...initialContext,
      state: terminal,
      matches: [startMatch, match(reviewed, 'update')],
    })
    expect(node).toMatchObject({
      key: 'ai-approval-review:call-1:1',
      kind: 'ai-approval-review',
      anchorSeq: 12,
      visibility: 'visible',
      data: { status: 'allowed-once' },
    })
  })

  it('preserves a local policy block for the review card', () => {
    const startMatch = match(started, 'start')
    const terminal = aiApprovalReviewDefinition.update(
      {
        key: 'ai-approval-review:call-1:1',
        kind: 'ai-approval-review',
        id: 'call-1:1',
        matches: [startMatch],
        start: startMatch,
        state: aiApprovalReviewDefinition.start(
          {
            key: 'ai-approval-review:call-1:1',
            kind: 'ai-approval-review',
            id: 'call-1:1',
            matches: [startMatch],
            start: startMatch,
            state: undefined,
            current: new Map(),
          },
          startMatch,
          {} as never,
        ),
        current: new Map(),
      },
      match(
        {
          ...reviewed,
          data: {
            ...reviewed.data,
            risk: 'high',
            outcome: 'allow',
            approvalOutcome: 'rejected',
            policyBlock: { maxRisk: 'medium' },
          },
        },
        'update',
      ),
    )
    expect(terminal).toMatchObject({
      status: 'rejected',
      outcome: 'allow',
      policyBlock: { maxRisk: 'medium' },
    })
  })
})
