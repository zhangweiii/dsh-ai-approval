# ADR 0002: Use action-only as the secure privacy baseline

- Status: Superseded by ADR 0004
- Date: 2026-08-20

## Context

Bounded session evidence can improve review quality but may disclose repository text, commands, tool results, or user data to a provider. Redaction cannot guarantee removal of secrets, and provider retention and training policies vary.

## Decision

The schema defaults to `contextMode: action-only`, `redactPaths: true`, and `sendSessionId: false`. Deployments should retain these defaults unless sending session context is an explicit, reviewed decision. `bounded` remains available as an opt-in and is not a privacy guarantee.

## Consequences

Action-only reduces data disclosure and makes the review boundary auditable, at the cost of less context for authorization classification. Teams choosing bounded context must document the provider, retention, residency, and data-processing decision. Human approval remains the fallback when action-only lacks enough evidence.
