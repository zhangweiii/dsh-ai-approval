# ADR 0005: Select reviewer routes through DSH services

## Context

The reviewer needs a Web model picker that can use any provider already registered in DSH, without modifying DSH source or duplicating provider authentication. OpenAI Codex also has an internal automatic-review route, but this independent package must not import Codex credentials or implement another OpenAI adapter.

## Decision

Register a `dsh-ai-approval` DSH Settings namespace containing only `provider`, `model`, and optional `reasoningEffort`. The Web control reads DSH's host-wide `llm.models` catalog and updates that namespace through the standard settings mutation API. The configured Bundle route remains the base layer and fallback when no settings provider is mounted.

Snapshot the resolved route at the start of one review. Retries and audit events for that review use the same snapshot; later settings changes affect only later approval requests.

The [Codex provider implementation](https://github.com/openai/codex/blob/main/codex-rs/model-provider/src/provider.rs) names `codex-auto-review` as its preferred default review model, while the [guardian implementation](https://github.com/openai/codex/blob/main/codex-rs/core/src/guardian/review.rs) prefers low reasoning when available and otherwise falls back to the active model. Expose this hidden candidate only under a successfully listed DSH provider group whose exact route id is `openai`. DSH remains responsible for authentication, transport, and authorization; an unavailable route fails closed.

## Consequences

All active DSH providers can supply the reviewer without package-specific integrations, and the choice persists through DSH's normal settings layer. The main agent model and reviewer model remain independent. Custom providers that do not support `codex-auto-review` never receive the synthetic option. An active OpenAI route can still reject the hidden alias due to account or upstream availability, which is reported as reviewer unavailability rather than silently falling back to another model.
