# ADR 0003: Fail closed and keep approval one-shot

- Status: Accepted
- Date: 2026-08-20

## Context

Model output, provider availability, transcript state, and approval requests are uncertain. Treating uncertainty as approval could widen host capabilities or authorize an action the user did not intend.

## Decision

Automatic approval requires a strict JSON assessment whose outcome is `allow`, risk is within `maxRisk`, and authorization meets `minAuthorization`. Parse errors, missing execution, missing context, timeouts, provider failures, exhausted attempts, and an open failure circuit return a non-approval outcome. A successful result is `allowed-once` for the exact pending call and never changes the session preset. Consecutive failures open a cooldown circuit; audit events record outcomes and metrics.

## Consequences

False negatives require human intervention, but the reviewer cannot silently widen authority. Operators can diagnose behavior through audit events, rationale, attempts, duration, and optional provider usage. Retry and cooldown settings must remain within the overall approval deadline.
