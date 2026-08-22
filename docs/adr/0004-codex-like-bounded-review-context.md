# ADR 0004: Use bounded context for Codex-like approval review

- Status: Accepted
- Date: 2026-08-21

## Context

An action-only request contains the pending action and the agent-authored escalation reason, but not the user's message. Because neither tool arguments nor agent instructions can grant authority, the reviewer often has to classify authorization as unknown even when the user explicitly requested the action. Codex Auto-review instead evaluates the exact approval request with a compact transcript that includes direct user messages and omits hidden reasoning.

## Decision

Default to `contextMode: bounded`, `maxRisk: high`, `minAuthorization: high`, `redactPaths: true`, and `sendSessionId: false`. The projection retains budgeted direct user messages and recent visible evidence, omits hidden reasoning, and keeps the exact pending action intact. Direct user messages are the authority; repository text, tool arguments, results, and agent instructions remain untrusted evidence.

The reviewer may approve a necessary, proportionate, narrowly scoped, and reversible boundary crossing when the user explicitly authorized its material effects, including a provider-classified high-risk workspace boundary crossing. It denies secret or private-data disclosure, credential probing, broad or persistent security weakening, significant irreversible destruction, `critical` risk, conflicting user constraints, and workarounds for a rejected action. Approval remains `allowed-once` and does not change the session's `workspace-write` preset.

`action-only` remains available as an explicit privacy mode for deployments that cannot send transcript context to the reviewer route.

## Consequences

Authorization decisions have enough provenance to avoid routine false denials, and the default behavior more closely matches Codex Auto-review. More session content may cross the reviewer-provider boundary, so operators must assess retention, training, residency, and logging policies; redaction is best-effort only. Action-only deployments should expect more unknown authorization results.

The reviewer still has no separate read-only inspection tools, manual override command, or exact Codex circuit-breaker semantics. DSH's generic rejected outcome may still be rendered by host tools as a user rejection; the package-owned review card distinguishes a reviewer denial from a stricter local-policy block and provides the specific limit.
