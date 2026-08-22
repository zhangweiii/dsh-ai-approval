# Project context

## Purpose

`ai-approval-reviewer` is a Cordis plugin that provides an independent, one-shot assessment before a host agent receives a narrowly scoped approval. It is an advisory policy layer, not an executor, sandbox, or replacement for human approval.

## Domain vocabulary

- **Exact action:** the pending tool name, call id, arguments, working directory, and user-requested reason.
- **Reviewer route:** the independently configured host LLM route selected by `provider` and `model`.
- **Permission preset:** the host session policy that activates the plugin (`ai-approval` by default).
- **One-shot approval / `allowed-once`:** approval for the current pending action only; it does not change the session preset.
- **Risk:** reviewer classification: `low`, `medium`, `high`, or `critical`.
- **Authorization:** reviewer confidence that the user authorized the action: `unknown`, `low`, `medium`, or `high`.
- **Bounded context:** selected, budgeted session evidence sent in addition to the exact action.
- **Action-only:** privacy mode that omits session history and sends only the exact action.
- **Fail closed:** uncertainty, malformed output, timeout, missing context, provider failure, or an open circuit never becomes approval.
- **Failure circuit:** a process-local cooldown after consecutive reviewer failures.
- **Audit event:** `ai-approval/reviewed`, recording the assessment, outcome, metrics, and configured route.

## Trust boundaries

Repository text, tool arguments, tool results, agent instructions, and model output are untrusted. The reviewer provider is an external data-processing boundary unless it is demonstrably local. Human approval remains the authority for destructive, credential-related, external-write, and high-impact actions.

## Invariants

1. The plugin only intercepts requests for the configured permission preset.
2. A successful review can grant only the current action once.
3. Automatic approval requires an allowed outcome, a risk at or below `maxRisk`, and authorization at or above `minAuthorization`.
4. Review requests include a bounded, budgeted transcript projection by default so direct user authorization is visible; `action-only` remains the explicit privacy mode.
5. Secrets and local paths are redacted best-effort, never as a guarantee.
6. Unknown, unavailable, or ambiguous states fail closed and remain auditable.

## Operational notes

The message cursor is process-local and falls back to a full projection after history rewrites or concurrent changes. Hidden reasoning is omitted from reviewer context. Token budgets are UTF-8-byte approximations. Provider usage and retention behavior vary by route and must not be inferred from this plugin alone.
