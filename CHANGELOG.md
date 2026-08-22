# Changelog

All notable changes are documented here. This project is pre-release; configuration and compatibility details may change between release candidates.

## 0.1.1-rc.2

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
- Added `/ai-approval-models` to list DSH provider/model routes and persist a validated reviewer
  selection through the same Settings namespace used by the Web page.
- Raised the bundled end-to-end reviewer deadline from 30 to 60 seconds after slow routes were
  observed consistently reaching the former deadline before completing; timeouts still fail closed.
- Added a DSH Bundle manifest and patch so `dsh plugin --profile web add ai-approval-reviewer`
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
