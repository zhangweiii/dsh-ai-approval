import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiApprovalReviewCard } from '../src/client/review-card.ts'
import type { AiApprovalReviewCardData } from '../src/client/conversation.ts'

const base: AiApprovalReviewCardData = {
  reviewId: 'call-1:1',
  callId: 'call-1' as never,
  toolName: 'shell',
  reason: 'Network access is required.',
  provider: 'local',
  model: 'reviewer',
  status: 'reviewing',
}

function render(data: AiApprovalReviewCardData): string {
  const element = AiApprovalReviewCard({ node: { data } } as never)
  return JSON.stringify(element.props)
}

afterEach(() => vi.unstubAllGlobals())

describe('AI approval review card', () => {
  it('renders the running request and its route without terminal assessment', () => {
    const output = render(base)
    expect(output).toContain('AI approval in progress')
    expect(output).toContain('Network access is required.')
    expect(output).not.toContain('Review reason')
  })

  it.each([
    ['allowed-once', 'AI allowed once'],
    ['rejected', 'AI rejected'],
    ['unavailable', 'AI approval unavailable'],
    ['cancelled', 'AI approval cancelled'],
  ] as const)('renders the %s terminal state with rationale and metrics', (status, title) => {
    const output = render({
      ...base,
      status,
      risk: 'low',
      authorization: 'high',
      outcome: status === 'allowed-once' ? 'allow' : 'deny',
      rationale: 'The reviewer explains the decision.',
      attempts: 1,
      durationMs: 125,
      reasoningEffort: 'low',
      images: {
        admitted: 1,
        omitted: 1,
        admittedBytes: 1024,
        estimatedTokens: 255,
        everAdmitted: 1,
        everAdmittedBytes: 1024,
        everEstimatedTokens: 255,
        imageBearingAttempts: 1,
        fallbackUsed: false,
      },
    })
    expect(output).toContain(title)
    expect(output).toContain('The reviewer explains the decision.')
    expect(output).toContain('risk: low')
    expect(output).toContain('local/reviewer')
    expect(output).toContain('1/2 images')
    expect(output).toContain('low')
  })

  it('uses Chinese copy for a Chinese browser locale and handles absent reasons', () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' })
    const output = render({ ...base, reason: '' })
    expect(output).toContain('AI 审批中')
    expect(output).toContain('未提供')
  })

  it('distinguishes a local policy rejection from an AI rejection', () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' })
    const output = render({
      ...base,
      status: 'rejected',
      risk: 'high',
      authorization: 'high',
      outcome: 'allow',
      rationale: '用户明确授权了该操作。',
      policyBlock: { maxRisk: 'medium' },
      attempts: 1,
      durationMs: 100,
    })
    expect(output).toContain('本地策略未批准')
    expect(output).toContain('策略理由')
    expect(output).toContain('风险 high 超过配置上限 medium。')
    expect(output).not.toContain('AI 已拒绝')
  })
})
