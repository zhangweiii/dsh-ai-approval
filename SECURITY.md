# Security policy

## Supported versions

This project is pre-release. Before the first npm publication, security fixes are provided on the default branch. After publication, fixes are provided only for the current release candidate on npm's `next` dist-tag and the default branch until a stable line is published.

## Scope and security model

This plugin may send the exact pending action (tool name, arguments, working directory, reason, and call id) to a configured reviewer provider. With `contextMode: bounded`, it may also send selected session messages, tool calls, and tool results. Selecting a vision-capable route with explicit `imageMode: allow` consent may additionally send admitted image bytes. Provider configuration, transport, retention, training use, residency, and logs are part of the deployment security boundary.

The Codex-like default is `contextMode: bounded`, `maxRisk: high`, `minAuthorization: high`, `redactPaths: true`, and `sendSessionId: false`. A model-classified high-risk action can therefore receive one-shot approval only when the reviewer also reports high user authorization and no stricter local policy block applies. `critical` risk never auto-approves. Use explicit `contextMode: action-only` when transcript content cannot cross the reviewer-provider boundary.

`maxInputBytes` caps the combined UTF-8 bytes of reviewer system and user text. If the exact action cannot fit intact, the plugin fails closed before preparing or contacting the reviewer route. Images have independent count, token, and raw-byte limits. Credential and path redaction covers common structured, header, URL, CLI, token, and key forms, but remains best effort and never replaces secret management, provider isolation, or review of provider-side retention. The reviewer is advisory; retain human approval for secret disclosure, credential probing, broad security weakening, irreversible destruction, and other high-impact capabilities.

## Reporting a vulnerability

Do **not** disclose suspected vulnerabilities in a public issue, pull request, or discussion. Use GitHub's [private vulnerability reporting form](https://github.com/zhangweiii/dsh-ai-approval/security/advisories/new). If private reporting is unavailable, do not publish sensitive details; open a non-sensitive issue asking a maintainer to establish a private channel.

Include, when safe:

- affected version or commit;
- reproduction steps or a minimal proof of concept;
- security impact and prerequisites;
- logs with secrets, tokens, and private repository content removed;
- a proposed mitigation, if known.

Please allow maintainers reasonable time to investigate and coordinate a fix before public disclosure. Never include live credentials or private data in a report.
