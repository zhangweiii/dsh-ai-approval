# Changelog

All notable changes are documented here. This project is pre-release; configuration and compatibility details may change between release candidates.

## 0.1.2-rc.1

- Restored compatibility with DSH `0.1.7-alpha.2`. The host made several breaking changes that this
  plugin had to follow, and the old pins silently degraded rather than failing loudly:
  - `ctx.settings.register()` (settings namespaces) no longer exists; `ctx.settings` is now a
    configuration-form service over profile entries. The reviewer route moved onto the plugin's own
    `Config` entry, whose four route fields are declared `volatile()` (the marker that makes them
    live and editable), and writes go through `ctx.configEditor.edit()` against that entry. At
    runtime the removed method previously threw `TypeError: s.register is not a function`, which
    aborted the route binding and left reviewer settings unwritable.
  - The shared `plugin` LLM message source was removed. Each producer now declares its own
    `MessageSourceMap` kind, so the reviewer request carries `kind: 'dsh-ai-approval'`.
  - The nested `tool-result` content block was removed. Tool output is now a first-class
    `role: 'tool'` message carrying `toolCallId` and `isError`, so the bounded transcript
    projection reads those fields from the message instead of from a nested block.
  - The keyed `conversation.chat.node` slot now types its copy against the Chat package's `chat`
    dictionary and requires the slot-level hooks face; registering with the Conversation shell
    namespace no longer satisfied the slot contract.
- Corrected the synthetic review summary's `command/run` producer record: it claimed
  `source: { kind: 'plugin', plugin: 'dsh-ai-approval' }`, a shape DSH's `CommandSourceMap` has never
  contained (in 0.1.5 or 0.1.7 — the shipped vocabulary lists only `user`). The old code cast the
  call to hide the mismatch. DSH documents that map as merge-extensible, so this package now
  declares its own `'dsh-ai-approval'` source kind and appends through the typed `Session.append`
  with no cast. Rendering is unaffected: the chat client resolves command rows from `commandId` and
  `name` and never reads `source`.
- Fixed two defects that only surfaced against a live 0.1.7 runtime and would have left the plugin
  looking installed but partly inert:
  - The module's `export default apply` was shadowing the `Config` schema. DSH's Loader resolves a
    plugin module to `exports.default ?? exports` and the settings form reads
    `entry.fiber.runtime.Config`, so the default export silently removed the **AI approval** page
    from Settings. The module now exports a named `apply` (the shape DSH's own function plugins
    use), and a regression test pins the resolved module shape.
  - `settings.configure()` was passed the fiber created inside the `inject` callback instead of the
    plugin's owning fiber, so the page policy landed on the wrong instance and the auto-generated
    form stayed enabled beside the custom reviewer page.
- Aligned every `@deepseek-ai/*` peer and dev dependency with the host runtime
  DSH `0.1.7-alpha.2` (and `@deepseek-ai/cordis` `4.0.4`), added `@deepseek-ai/dsh-config-editor`
  and `@deepseek-ai/dsh-client-ui-settings` as dev-only types dependencies, and raised
  `@deepseek-ai/schemastery` to `3.18.4` for the `volatile()` schema marker.
- Regenerated the lockfile from scratch after the bump: the incremental update had left stale
  `0.1.0-rc.7`/`0.1.5-rc.2` transitive resolutions in place, which made a public type re-export
  (`assertNever`) resolve against an older `@deepseek-ai/dsh-llm` and broke the runtime contract
  suite.

## 0.1.1-rc.2

- Renamed the public package, plugin row, settings namespace, browser module, and audit source to `dsh-ai-approval` before the first public release.
- Made `maxInputBytes` a fail-closed ceiling over combined reviewer system and user text. An exact action that cannot fit intact now returns `input-too-large` before provider preparation and is not retried.
- Expanded credential redaction for Bearer and Basic authorization headers (including proxy and structured forms), multi-cookie headers, credentialed URLs, compact CLI basic auth, XML credential fields, JWTs, and Google-style keys while preserving shell/JSON delimiters and non-secret action suffixes.
- Serialized distinct in-session reviews so concurrent denials or provider failures cannot collapse fail-closed threshold counters; cancelled queued calls no longer start a provider request, and local oversized-input failures no longer poison the provider circuit.
- Added `/ai-approval status` and `/ai-approval doctor` for activation, route, policy, privacy, settings, and limit diagnostics without contacting the reviewer provider or durably recording raw command input.
- Expanded secret scanning to current files and all reachable Git-history blobs, represented peer dependency ranges accurately in the SBOM, classified prereleases from SemVer core versions, and attached the exact npm tarball, SBOM, and checksums to production GitHub Releases.
- Smoke-test the exact release tarball, including packaged command registration and the history-repair executable; fixed npm-bin symlink detection and made permission-preserving repair backups exclusive and collision-resistant.
- Added single-route multimodal approval review using DSH 0.1.1-rc.2 prepared-call modality metadata. Vision models require persisted `imageMode: allow` consent; existing and manual routes default to `omit`, and `action-only` never sends transcript images.
- Added nested-image discovery across the complete bounded-context candidate set, attachment-id deduplication with conflicting-metadata rejection, newer-first admission, non-truncating attachment indexes, prepared-context reservation, and independent default limits of 10,000 estimated tokens, 8 images, and 16 MiB raw bytes.
- Added explicit image-omission warnings and deterministic fail-closed policy blocks: omitted visual evidence and text-only fallback after a failed image-bearing attempt cannot auto-approve. Audit events and cards retain final and cumulative disclosure facts.
- Marked vision-capable catalog models in Settings and `/ai-approval-models`, including the injected `codex-auto-review` candidate, and made selection persist the visual-consent boundary.
- Aligned every `@deepseek-ai/*` peer and dev dependency, and the package version, with host
  runtime DSH 0.1.1-rc.2; added `@deepseek-ai/dsh-client-ui-slots` as a dev-only types dependency
  because the conversation client's published declarations import it without declaring a runtime
  dependency on it.
- Documented that DSH 0.1.1-rc.2 honors the session event `ignorable` marker on the read path only,
  with no registration surface for out-of-repo plugin events yet, so reviewer audit events remain
  process-local. Noted the harness LLM default retry increase from 2 to 5: review attempts stay
  bounded by the 60-second deadline and still fail closed.
- Moved reviewer model selection from the composer into a dedicated DSH Web Settings page with
  grouped providers, route details, and reasoning controls.
- Added live reviewer-route selection backed by the DSH model catalog and Settings service,
  including a guarded `codex-auto-review` candidate only for an active DSH OpenAI route.
- Fixed model switching so choosing the provider default explicitly masks a composition-level
  `reasoningEffort`; an inherited value such as `off` can no longer break a route that supports
  only `high` or `max` before review begins.
- Added a plain-text AI approval summary through DSH's standard `command/run` / `command/done`
  transcript channel, including the one-shot outcome, risk, authorization, rationale, policy
  block, and reviewer route. This is visible through both Web and TUI clients without requiring a
  custom conversation component and cannot be overwritten by tool-owned `finalizeContent`.
- Added `/ai-approval-models` to list DSH provider/model routes and persist a validated reviewer
  selection through the same Settings namespace used by the Web page.
- Raised the bundled end-to-end reviewer deadline from 30 to 60 seconds after slow routes were
  observed consistently reaching the former deadline before completing; timeouts still fail closed.
- Added a DSH Bundle manifest and patch so `dsh plugin --profile web add dsh-ai-approval`
  installs the reviewer and its `ai-approval` permission preset without manual profile edits.
- Stopped persisting package-owned review events because DSH offers no API for third-party packages
  to write ignorable durable events (verified still true in 0.1.1-rc.2), which made other Harness
  versions refuse to load affected histories; retained process-local audit events and legacy card
  rendering. Added a backed-up directory migration command with read-only auditing and
  DSH-compatible Zstandard header framing.
- Disabled the default reasoning effort for the bundled DeepSeek Flash reviewer so its short JSON
  result does not exhaust the output budget, and added privacy-safe failure details to review cards.
- Changed the Bundle and schema defaults to bounded transcript context with a high-risk ceiling,
  so explicitly authorized, narrowly scoped one-shot escalations can be reviewed like Codex
  Auto-review while hidden reasoning remains omitted.
- Ask the host agent to request known workspace-boundary escalations on its initial tool call, and
  distinguish reviewer denials from stricter local-policy blocks in audit events and review cards.
- Tightened reviewer policy around direct-user authority, secret disclosure, credential probing,
  persistent security weakening, irreversible destruction, and rejected-action workarounds.

## 0.1.0-rc.7

- Added the independent, fail-closed reviewer implementation with risk and authorization thresholds, usage auditing, denial limits, failure cooldowns, and one-shot approval outcomes.
- Made `action-only` the default context policy; bounded session context is opt-in.
- Split review coordination, model calls, context projection, privacy, configuration, and execution correlation into focused Modules.
- Added strict cross-session execution correlation, same-call single-flight reviews, normalized failure auditing, and broader credential redaction.
- Added installation, plugin loading, provider routing, compatibility, verification, troubleshooting, security, contribution, governance, domain context, and ADR documentation.
- Added security contract tests, coverage thresholds, formatting, clean builds, package linting, isolated tarball smoke tests, secret scanning, dependency auditing, SBOM artifacts, a non-publishing release-readiness workflow, and tag-driven npm/GitHub releases with provenance.
- Fixed npm exports and stale build artifacts.
