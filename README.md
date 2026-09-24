# dsh-ai-approval

English | [中文](README.zh.md)

`dsh-ai-approval` is an independent Cordis plugin that reviews one-shot agent approval requests through a separately configured LLM route. It does not replace the host's approval vocabulary, sandbox provider, or tool implementation.

The plugin is activated when the current session uses the configured `ai-approval` permission preset. It captures the exact pending tool action, constructs a bounded review request, and can return `allowed-once` only when risk and authorization thresholds pass. Parse errors, missing context, timeouts, provider failures, and an open failure circuit fail closed.

> **Default behavior:** To assess explicit user authorization like Codex Auto-review, the Bundle defaults to `contextMode: bounded`, `maxRisk: high`, and `minAuthorization: high`. This sends a budgeted, best-effort-redacted transcript projection to the reviewer route. Sensitive deployments can explicitly select `action-only`, at the cost of frequently leaving authorization unknown.

## Compatibility

The host must provide compatible LLM, session, tool, permission-preset, system-prompt, timeout, and user-approval services. Operator commands additionally use DSH's optional commands service; the Web model selector uses DSH's settings and host model-catalog APIs. Without those optional surfaces, approval review remains active but the related operator UI is unavailable. The peer versions are pinned in `package.json` and target DSH `0.1.7-alpha.2`; keep them aligned with the host runtime. The package is independently named and branded and is not endorsed by any host-runtime vendor or model provider.

### DSH 0.1.7 settings model

DSH 0.1.7 replaced settings _namespace registration_ with profile-entry configuration forms. There is no `ctx.settings.register()` and no package-owned settings namespace for a plugin; instead the reviewer route lives on this plugin's own `Config` entry, and its four route fields (`provider`, `model`, `reasoningEffort`, `imageMode`) are declared `volatile()` — the marker that makes a field live and editable. DSH's settings service projects those fields into the **AI approval** page, and a write goes through `ctx.configEditor.edit()` on the same entry. The plugin registers `configure({ auto: false })` so its custom page is the entry's face rather than an auto-generated duplicate. `provider` and `model` remain required schema fields, so an unconfigured route still fails loudly instead of silently reviewing with an empty route.

## Install and load

Install the DSH Bundle into the Web profile:

```bash
dsh plugin --profile web add dsh-ai-approval
```

Restart `dsh web`, create or open a session, and select **AI Approval** in the permission selector. The equivalent session command is:

```text
/permission ai-approval
```

The Bundle installs the plugin and adds the activating `ai-approval` preset. It uses DSH's default `deepseek-official` / `deepseek-v4-flash` route with `reasoningEffort: off`, preventing the model's default reasoning from exhausting the short JSON assessment's output budget. That route and its credentials must be configured. A provider outage or missing credentials fail closed and never become approval.

Approval outcomes continue to use DSH's built-in `approval/asked`, `approval/decided`, and tool lifecycle. Every completed AI review also appends one privacy-filtered, plugin-authored `command/run` / `command/done` lifecycle containing the outcome, risk, authorization, rationale, policy block, and reviewer route. This is DSH's durable, model-invisible transcript channel, so Web and TUI render the same persisted review result and reconnects retain it. Detailed reviewer facts remain available to same-process observers through `ai-approval/review-started` and `ai-approval/reviewed`, but those custom events are not persisted: as of DSH 0.1.7-alpha.2 the harness honors an `ignorable` envelope marker only on the read path, while the generated known-event catalog explicitly defers a registration surface for out-of-repo plugin events. The Web Conversation Node remains only for rendering repaired legacy events. No DSH source is modified.

The **AI approval** page in DSH Web Settings selects the reviewer independently from the session's main model. It lists every model returned by DSH's registered provider catalog, grouped by provider, and stores `provider`, `model`, optional `reasoningEffort`, and explicit `imageMode` consent on the plugin config entry through DSH Settings. DSH 0.1.5 stopped reporting per-model image modalities to the browser, so the page marks only the package-owned Codex route as **Vision** and exposes image sharing as an explicit Off/On control; the Host still verifies the exact prepared route before any image is sent. Changes apply to the next approval; an in-flight review keeps the route it started with so its audit facts remain accurate.

Use the native operator commands to inspect the current session without contacting the reviewer provider:

```text
/ai-approval status
/ai-approval doctor
```

`status` reports activation, runtime readiness, preset, route, policy, and privacy mode. `doctor` additionally checks whether the approval handler is installed, whether the session preset activates it, and whether persisted route settings are writable; it deliberately does not send a model request, and the operator command disables raw-input recording. To change the reviewer route, open DSH Web's native model picker with:

```text
/ai-approval-models
```

The model command never asks for a route to be typed manually. Its picker lists every provider/model registered in DSH and saves the selection to the same plugin Config entry used by **Settings → AI approval**. The next review uses the change. If a model advertises reasoning efforts, the picker applies its declared default; the Settings page can adjust it independently afterward. The command does not configure providers or credentials.

Codex's open-source implementation uses a hidden `codex-auto-review` route for automatic approval review. This package exposes that route only when DSH already has a successfully listed `openai` provider group, marks it as vision-capable, and requests it through the same DSH LLM adapter with low reasoning effort. It never reads OpenAI credentials, imports Codex authentication, or implements an OpenAI provider. If DSH has no OpenAI route, the option is absent; if the upstream account cannot use that hidden route, the review fails closed and another DSH-listed model should be selected.

Reviewer selection is single-route, not parallel: each approval uses either the normal text route or the selected vision-capable route. Images are admitted only in `bounded` mode when persisted `imageMode` is `allow` **and** the exact DSH prepared route explicitly declares `image` in `inputModalities`; old or manually configured routes default to `imageMode: omit`, and an absent modality declaration is treated as unknown. Enabling **Image sharing** in Settings is the explicit action that persists `allow`; choosing a model keeps the current consent, and the command picker never changes it. Admitted references must have consistent metadata, are deduplicated, and newer evidence is retained first under independent `maxImageTokens` (10,000), `maxImages` (8), and `maxImageBytes` (16 MiB) defaults plus the prepared model's remaining context capacity; an absent context-window declaration is treated as unknown and omits images. Image discovery covers the complete bounded-context candidate set, so transcript-entry selection cannot silently hide visual evidence; every admitted image also receives a non-truncating transcript index marker. Omitted images become an explicit `[image omitted — reviewer cannot verify visual content]` warning and deterministically block automatic approval. If an image-bearing attempt fails and another configured attempt remains, the retry drops all images for diagnostic assessment, but its result cannot auto-approve.

To test a local checkout, build it before adding the checkout itself:

```bash
pnpm build
dsh plugin --profile web add .
```

For another Cordis host, install the package with its package manager and mount the default export (`apply`) through its plugin loader:

```ts
import { apply as approvalReviewer } from 'dsh-ai-approval'
ctx.plugin(approvalReviewer, {
  presetName: 'ai-approval',
  provider: 'local-reviewer',
  model: 'reviewer-model',
  imageMode: 'omit',
  contextMode: 'bounded',
  maxRisk: 'high',
  minAuthorization: 'high',
  redactPaths: true,
  sendSessionId: false,
})
```

The exact loader syntax outside DSH is host-specific. Do not copy the example into a host that uses a different plugin registration API without adapting it.

## Provider and policy configuration

`provider` is the independently registered host LLM route; `model` is an identifier on that route. `provider: local` is not a built-in provider. Register and test the route with the host first, then configure it here. For sensitive repositories, prefer a local or contractually approved provider and review retention, training, residency, and logging terms.

In DSH Web, prefer **Settings → AI approval** over editing YAML for ordinary route changes. The settings page does not configure providers or credentials: configure those through DSH first, then reopen the page. A newly active provider appears from DSH's model catalog; a removed or unauthenticated provider is never synthesized, except for the hidden Codex route described above under an already active `openai` group.

To override the Bundle defaults in a DSH profile, replace the complete plugin row in that profile's `cordis.patch.yml`:

```yaml
- id: dsh-ai-approval
  config:
    presetName: ai-approval
    provider: local-reviewer
    model: reviewer-model
    # reasoningEffort: off # set only when the route explicitly supports it
    imageMode: omit # set allow only after reviewing the selected vision provider
    contextMode: bounded
    maxRisk: high
    minAuthorization: high
    redactPaths: true
    sendSessionId: false
    timeoutMs: 60000
    maxAttempts: 2
    maxInputBytes: 48000
    maxImageTokens: 10000
    maxImages: 8
    maxImageBytes: 16777216
```

DSH profile patches replace a row's complete `config`; restate every Bundle setting that must remain active.

`bounded` sends the exact action plus independently budgeted user messages, recent visible agent text, tool calls, and results; hidden reasoning is omitted. `maxInputBytes` caps the combined UTF-8 bytes of reviewer system and user text. If the exact action cannot fit intact, the plugin returns a fail-closed `input-too-large` result before preparing or contacting the reviewer route; images use separate limits. When the user selects a vision-capable reviewer, admitted transcript images also cross the reviewer-provider boundary through DSH's attachment and LLM adapters. Direct user messages are the authority, while repository text, tool arguments, images, and agent instructions are evidence only. `action-only` sends the tool name, call id, arguments, working directory, and requested reason, but no session history or images. Common structured credentials, authorization headers, credentialed URLs, CLI basic-auth values, JWTs, and provider-shaped keys are redacted, but credential and path redaction remains best effort only.

The default policy may return `allowed-once` for a necessary, bounded, reversible action that the user explicitly requested, even when a provider labels the workspace boundary crossing as high risk. It does not reject solely because the host labels the requested sandbox `danger-full-access`. Sending private data or secrets, probing credentials, broad or persistent security weakening, significant irreversible destruction, and `critical` risk remain denied. The reviewer is advisory, not a deterministic security boundary.

## Verify

From a checkout:

```bash
pnpm install --frozen-lockfile
pnpm check       # formatting, history secret scan, tests, coverage, audits, build, package smoke
pnpm build       # declaration and JavaScript build
```

Before enabling automatic one-shot approval, run `/ai-approval doctor`, then verify that: the preset is active; the provider route and model resolve; an explicitly authorized, narrowly scoped, reversible request can receive `allowed-once`; malformed output, timeout, provider outage, and missing execution return a non-approval outcome; bounded mode includes only budgeted visible context and omits hidden reasoning; text-only routes emit image-omission warnings without image blocks; vision routes admit only budgeted, deduplicated image references; and no session history or images leave the host when explicit `action-only` mode is selected. Review same-process audit events and provider-side logs without exposing secrets.

## Troubleshooting

- **Plugin never runs:** run `/ai-approval doctor` and confirm the session's current permission preset exactly matches `presetName` (`ai-approval` by default).
- **`input-too-large`:** the complete exact action cannot fit inside the combined system/user text budget. Reduce the action itself or deliberately raise `maxInputBytes`; the plugin does not truncate an action and does not contact the provider for this failure.
- **An old session reports `SessionFormatUnsupportedError`:** an early package version persisted custom `ai-approval/review-*` events. Stop DSH, then run `ai-approval-repair-history <sessions-directory>` over the complete workspace session directory; from a checkout use `pnpm history:repair -- <sessions-directory>`. Add `--check` for a read-only audit that exits nonzero while unmarked events remain. A single `.jsonl.zstd` is also accepted. The tool only adds top-level `ignorable: true` to those two legacy event types, changes affected files only, creates a timestamped backup beside each original, preserves the original file permissions, and preserves DSH's required standalone Zstandard header frame. It requires the `zstd` executable. Never run it while a session is being written.
- **A `workspace-write` denial appears first:** the plugin's system context asks the agent to request one-shot escalation on the initial tool call when the target is already known to be outside the workspace. If the agent still tries the base sandbox first, its denial remains visible; an independent plugin cannot suppress or rewrite an error that already happened. A later approval still grants only the exact action as `allowed-once` and does not switch the session to Full Access.
- **`unavailable` or repeated timeouts:** test the host route independently, check model id and credentials, increase neither deadline nor privileges blindly, and inspect the failure cooldown before retrying.
- **The selected model shows no active reasoning choice:** reselect **Default** (or one of that model's advertised efforts). Current versions persist an explicit default override so a composition-level effort such as `off` cannot leak across models; older versions may report the resulting route failure only as `unavailable`.
- **Output parsing failures:** the card reports a safe detail such as `output-token-limit` or `malformed-json`; require the provider to return only the documented JSON object, disable tool calling, and ensure the output limit is not reached. For routes that support reasoning efforts, explicitly setting `reasoningEffort: off` is available.
- **Unexpected denials:** inspect risk/authorization thresholds, rationale, and audit usage; denials are fail-closed behavior, not permission to retry with a wider scope.
- **Sensitive data concern:** switch to explicit `action-only`, keep `sendSessionId: false`, use a provider with an acceptable retention policy, and rotate any secret that may have been exposed.

## Development and contribution

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [docs/adr](docs/adr/). Keep the English and Chinese README files synchronized.

## License

MIT License. This independent project is not affiliated with or endorsed by any host-runtime vendor, model provider, or agent product.

## Known limitations

- Text token budgets are UTF-8-byte approximations; image tokens use a provider-neutral normalized-tile estimate, not the selected provider's tokenizer.
- The delta cursor is process-local and is discarded after restart.
- Provider usage may be absent when a route does not report it.
- The reviewer currently has no separate read-only inspection tools.
- DSH exposes a generic `rejected` outcome to its tool layer, so a host tool error may say “user rejected”; the shared transcript summary and same-process audit events carry the reviewer-specific details.
