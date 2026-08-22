import type { CallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

const DEFAULT_CAPACITY = 128

/** Correlates approval requests with executions without crossing session seams. */
export class PendingExecutionRegistry {
  private readonly entries = new Map<string, Readonly<ToolExecution>>()

  constructor(private readonly capacity = DEFAULT_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('ai-approval: pending execution capacity must be positive')
    }
  }

  private key(sessionId: string | undefined, callId: CallId): string {
    return JSON.stringify([sessionId ?? null, String(callId)])
  }

  put(execution: Readonly<ToolExecution>): void {
    const sessionId = execution.agent?.session?.header.id
    if (sessionId === undefined || execution.agent?.session === undefined) return
    const key = this.key(sessionId, execution.callId)
    if (this.entries.size >= this.capacity && !this.entries.has(key)) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
    this.entries.set(key, execution)
  }

  remove(execution: Readonly<ToolExecution>): void {
    const sessionId = execution.agent?.session?.header.id
    if (sessionId !== undefined) this.entries.delete(this.key(sessionId, execution.callId))
  }

  lookup(
    sessionId: string | undefined,
    callId: CallId | undefined,
  ): Readonly<ToolExecution> | undefined {
    if (sessionId === undefined || callId === undefined) return undefined
    return this.entries.get(this.key(sessionId, callId))
  }
}
