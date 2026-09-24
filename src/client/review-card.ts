import { createElement, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'

const cardStyle: CSSProperties = {
  border: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
  borderRadius: 12,
  background: 'color-mix(in srgb, currentColor 3%, transparent)',
  padding: '12px 14px',
  margin: '8px 0',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontWeight: 600,
}

const detailsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content minmax(0, 1fr)',
  gap: '6px 12px',
  margin: '10px 0 0',
  fontSize: 13,
  lineHeight: 1.5,
}

const labelStyle: CSSProperties = { opacity: 0.62 }
const valueStyle: CSSProperties = { margin: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }

function tone(status: ChatNodeViewProps<'ai-approval-review'>['node']['data']['status']): string {
  if (status === 'reviewing') return '#2563eb'
  if (status === 'allowed-once') return '#15803d'
  if (status === 'rejected') return '#dc2626'
  return '#b45309'
}

function isChinese(): boolean {
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')
}

function copy(zh: boolean) {
  return zh
    ? {
        reviewing: 'AI 审批中',
        'allowed-once': 'AI 已允许（仅本次）',
        rejected: 'AI 已拒绝',
        policyRejected: '本地策略未批准',
        unavailable: 'AI 审批不可用',
        cancelled: 'AI 审批已取消',
        tool: '工具',
        requestReason: '申请原因',
        reviewReason: '审批理由',
        policyReason: '策略理由',
        assessment: '判断',
        route: '审批模型',
        noReason: '未提供',
        risk: '风险',
        authorization: '授权',
        attempts: '尝试',
        duration: '耗时',
        images: '图片',
        everAdmitted: '曾获准',
      }
    : {
        reviewing: 'AI approval in progress',
        'allowed-once': 'AI allowed once',
        rejected: 'AI rejected',
        policyRejected: 'Local policy did not approve',
        unavailable: 'AI approval unavailable',
        cancelled: 'AI approval cancelled',
        tool: 'Tool',
        requestReason: 'Request reason',
        reviewReason: 'Review reason',
        policyReason: 'Policy reason',
        assessment: 'Assessment',
        route: 'Reviewer',
        noReason: 'Not provided',
        risk: 'risk',
        authorization: 'authorization',
        attempts: 'attempts',
        duration: 'duration',
        images: 'images',
        everAdmitted: 'ever admitted',
      }
}

function shield(status: ChatNodeViewProps<'ai-approval-review'>['node']['data']['status']) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  const outline = createElement('path', {
    d: 'M12 3 20 6v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-3Z',
  })
  let mark: ReactNode
  if (status === 'reviewing') {
    mark = createElement(
      'circle',
      { cx: 12, cy: 12, r: 3.2, strokeDasharray: '6 3' },
      createElement('animateTransform', {
        attributeName: 'transform',
        type: 'rotate',
        from: '0 12 12',
        to: '360 12 12',
        dur: '1s',
        repeatCount: 'indefinite',
      }),
    )
  } else if (status === 'allowed-once') {
    mark = createElement('path', { d: 'm8.5 12 2.2 2.2 4.8-5' })
  } else {
    mark = createElement('path', { d: 'M12 8.5v4.5m0 3h.01' })
  }
  return createElement('svg', common, outline, mark)
}

function row(label: string, value: ReactNode): ReactElement[] {
  return [
    createElement('dt', { key: `${label}:label`, style: labelStyle }, label),
    createElement('dd', { key: `${label}:value`, style: valueStyle }, value),
  ]
}

export function AiApprovalReviewCard({
  node,
}: ChatNodeViewProps<'ai-approval-review'>): ReactElement {
  const data = node.data
  const zh = isChinese()
  const text = copy(zh)
  const statusTone = tone(data.status)
  const terminal = data.status !== 'reviewing'
  const assessment =
    data.risk === undefined || data.authorization === undefined
      ? undefined
      : `${text.risk}: ${data.risk} · ${text.authorization}: ${data.authorization}`
  const imageMetrics =
    data.images === undefined || data.images.admitted + data.images.omitted === 0
      ? ''
      : ` · ${data.images.admitted}/${data.images.admitted + data.images.omitted} ${text.images} · ${data.images.everAdmitted} ${text.everAdmitted}`
  const metrics =
    data.attempts === undefined || data.durationMs === undefined
      ? undefined
      : `${data.attempts} ${text.attempts} · ${data.durationMs} ms ${text.duration}${imageMetrics}`
  const policyReasons = [
    ...(data.policyBlock?.maxRisk === undefined
      ? []
      : [
          zh
            ? `风险 ${data.risk} 超过配置上限 ${data.policyBlock.maxRisk}。`
            : `Risk ${data.risk} exceeds the configured maximum ${data.policyBlock.maxRisk}.`,
        ]),
    ...(data.policyBlock?.minAuthorization === undefined
      ? []
      : [
          zh
            ? `授权 ${data.authorization} 低于配置要求 ${data.policyBlock.minAuthorization}。`
            : `Authorization ${data.authorization} is below the configured minimum ${data.policyBlock.minAuthorization}.`,
        ]),
    ...(data.policyBlock?.visualOmission
      ? [
          zh
            ? '存在未验证的视觉证据，不能自动批准。'
            : 'Unverified visual evidence prevents automatic approval.',
        ]
      : []),
    ...(data.policyBlock?.visualFallback
      ? [
          zh
            ? '携图审批失败后的纯文本回退不能自动批准。'
            : 'A text-only fallback after a failed image review cannot auto-approve.',
        ]
      : []),
  ]
  const title =
    data.status === 'rejected' && data.outcome === 'allow' ? text.policyRejected : text[data.status]

  return createElement(
    'section',
    {
      style: { ...cardStyle, borderLeft: `3px solid ${statusTone}` },
      role: 'status',
      'aria-live': 'polite',
    },
    createElement(
      'div',
      { style: { ...headerStyle, color: statusTone } },
      shield(data.status),
      title,
    ),
    createElement(
      'dl',
      { style: detailsStyle },
      ...row(text.tool, data.toolName),
      ...row(text.requestReason, data.reason || text.noReason),
      ...(terminal && data.rationale ? row(text.reviewReason, data.rationale) : []),
      ...(policyReasons.length ? row(text.policyReason, policyReasons.join(' ')) : []),
      ...(assessment ? row(text.assessment, assessment) : []),
      ...(metrics
        ? row(
            text.route,
            `${data.provider}/${data.model}${data.reasoningEffort ? ` · ${data.reasoningEffort}` : ''}${data.imageMode === 'allow' ? ' · Vision' : ''} · ${metrics}`,
          )
        : []),
    ),
  )
}
