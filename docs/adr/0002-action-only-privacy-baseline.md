# ADR 0002: Use action-only as the secure privacy baseline

- Status: Superseded by ADR 0004
- Date: 2026-08-20

## Context

Bounded session evidence can improve review quality but may disclose repository text, commands, tool results, or user data to a provider. Redaction cannot guarantee removal of secrets, and provider retention and training policies vary.

## Decision

The schema defaults to `contextMode: action-only`, `redactPaths: true`, and `sendSessionId: false`. Deployments should retain these defaults unless sending session context is an explicit, reviewed decision. `bounded` remains available as an opt-in and is not a privacy guarantee.

## Consequences

Action-only reduces data disclosure and makes the review boundary auditable, at the cost of less context for authorization classification. Teams choosing bounded context must document the provider, retention, residency, and data-processing decision. Human approval remains the fallback when action-only lacks enough evidence.

## Multimodal supplement

Bounded context may include images only when the persisted route has explicit `imageMode: allow` consent and that exact prepared DSH route declares `image` in `inputModalities`. Existing, migrated, and manually configured routes default to `imageMode: omit`; selecting a Vision route through the Settings page or command picker is the explicit action that persists `allow`. An absent modality declaration is unknown capability and therefore does not admit images. `action-only` never sends transcript images.

Selecting a vision route expands the external data-processing boundary: DSH may resolve attachment references and send image bytes to that selected reviewer provider. Image bytes are not sent to a text-only, unknown-capability, or fallback route. Operators making this selection must review the provider's retention, training, residency, and logging terms for visual data as well as text.

Visual admission surveys the complete bounded-context candidate set before transcript-entry selection, rejects conflicting duplicate metadata, deduplicates attachment ids, and retains newer selected evidence first under independent approximate-token (10,000), count (8), raw-byte (16 MiB), and prepared-context limits; an absent context-window declaration is unknown capacity and omits images. Every admitted image receives a non-truncating transcript index marker. Images outside any bound, images in transcript entries rejected by text budgets, images rejected after a failed image-bearing attempt, and all images on non-vision routes become explicit omission warnings. Any omitted visual evidence deterministically blocks automatic approval; a text-only retry after an image-bearing failure can produce a diagnostic assessment but cannot approve. Audit data records the final projection, maximum previously admitted count/bytes/token estimate, image-bearing attempt count, and fallback use so a later text-only attempt cannot erase prior disclosure. These controls reduce disclosure and silent blindness but do not make provider-side image processing a privacy guarantee.

### DSH 0.1.5 client-API update

DSH 0.1.5 no longer exposes per-model image modalities to the browser client, so the Settings page cannot mark arbitrary catalog models as Vision and selecting a model can no longer be the consent action. Image sharing is now an explicit Off/On control that persists `imageMode`; selecting a model preserves the current consent, and only the package-owned `codex-auto-review` route is still marked Vision. Admission itself is unchanged: the Host still requires `imageMode: allow` plus an exact prepared route that declares image input, so consent recorded for one model never sends images through a route the Host cannot verify.
