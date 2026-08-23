# Project context

## Purpose

`dsh-ai-approval` is a Cordis plugin that provides an independent, one-shot assessment before a host agent receives a narrowly scoped approval. It is an advisory policy layer, not an executor, sandbox, or replacement for human approval.

## Domain vocabulary

- **Exact action:** the pending tool name, call id, arguments, working directory, and user-requested reason.
- **Reviewer route:** the independently configured host LLM route selected by `provider`, `model`, optional reasoning effort, and explicit `imageMode` consent.
- **Permission preset:** the host session policy that activates the plugin (`ai-approval` by default).
- **One-shot approval / `allowed-once`:** approval for the current pending action only; it does not change the session preset.
- **Risk:** reviewer classification: `low`, `medium`, `high`, or `critical`.
- **Authorization:** reviewer confidence that the user authorized the action: `unknown`, `low`, `medium`, or `high`.
- **Bounded context:** selected, budgeted session evidence sent in addition to the exact action.
- **Visual admission:** deduplicated image evidence sent only when `imageMode` is `allow`, the prepared route explicitly declares image input, and token, count, byte, and context budgets all permit it.
- **Action-only:** privacy mode that omits session history, including images, and sends only the exact action.
- **Text request budget:** the combined UTF-8 byte ceiling for reviewer system and user text; images use independent limits.
- **Fail closed:** uncertainty, malformed output, timeout, missing context, provider failure, or an open circuit never becomes approval.
- **Failure circuit:** a process-local cooldown after consecutive reviewer failures.
- **Audit event:** `ai-approval/reviewed`, recording the assessment, outcome, metrics, and configured route.
- **Visible review summary:** privacy-filtered review facts persisted through DSH's standard command lifecycle so every conversation client can render them.

## Trust boundaries

Repository text, tool arguments, tool results, agent instructions, images, and model output are untrusted. The reviewer provider is an external data-processing boundary unless it is demonstrably local. Selecting a vision-capable reviewer allows DSH to send admitted image bytes to that exact provider. Human approval remains the authority for destructive, credential-related, external-write, and high-impact actions.

## Invariants

1. The plugin only intercepts requests for the configured permission preset.
2. A successful review can grant only the current action once.
3. Automatic approval requires an allowed outcome, a risk at or below `maxRisk`, and authorization at or above `minAuthorization`.
4. Review requests include a bounded, budgeted transcript projection by default so direct user authorization is visible; `action-only` remains the explicit privacy mode.
5. Images are admitted only when persisted `imageMode` is `allow` and prepared model metadata declares image input; old settings, unknown capability, and explicit `omit` never send images.
6. Omitted visual evidence is explicit and deterministically blocks automatic approval; it is never silently assumed benign.
7. Reviewer system and user text never exceed the configured text request budget; an exact action that cannot fit intact fails closed before provider preparation.
8. Secrets and local paths are redacted best-effort, never as a guarantee.
9. Unknown, unavailable, or ambiguous states fail closed and remain auditable.
10. Distinct approval calls are serialized per session so denial and failure-circuit counters remain atomic; duplicate requests for one call still share one review, and cancellation/deadline accounting begins before queue admission so an expired queued call never reaches the provider.
11. Every completed AI review is persisted once through the standard `command/run` / `command/done` transcript channel with an explicit plugin source, without entering model history.

## Operational notes

The message cursor is process-local and falls back to a full projection after history rewrites or concurrent changes. Hidden reasoning is omitted from reviewer context. Text token budgets are UTF-8-byte approximations; image-token accounting is a provider-neutral tile estimate capped at 10,000 tokens by default. Provider usage and retention behavior vary by route and must not be inferred from this plugin alone.
