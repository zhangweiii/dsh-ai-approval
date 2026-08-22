# Security policy

## Scope and security model

This plugin may send the exact pending action (tool name, arguments, working directory, reason, and call id) to a configured reviewer provider. With `contextMode: bounded`, it may also send selected session messages, tool calls, and tool results. Provider configuration, transport, retention, training use, residency, and logs are part of the deployment security boundary.

The Codex-like default is `contextMode: bounded`, `maxRisk: medium`, `minAuthorization: high`, `redactPaths: true`, and `sendSessionId: false`. Use explicit `contextMode: action-only` when transcript content cannot cross the reviewer-provider boundary. Credential/path redaction is best effort and never replaces secret management or provider isolation. The reviewer is advisory; retain human approval for secret disclosure, credential probing, broad security weakening, irreversible destruction, and other high-impact capabilities.

## Reporting a vulnerability

Do **not** disclose suspected vulnerabilities in a public issue, pull request, or discussion. Use GitHub's [private vulnerability reporting form](https://github.com/zhangweiii/dsh-ai-approval/security/advisories/new). If private reporting is unavailable, do not publish sensitive details; ask a maintainer for a private channel through a non-sensitive issue.

Include, when safe:

- affected version or commit;
- reproduction steps or a minimal proof of concept;
- security impact and prerequisites;
- logs with secrets, tokens, and private repository content removed;
- a proposed mitigation, if known.

Please allow maintainers reasonable time to investigate and coordinate a fix before public disclosure. Never include live credentials or private data in a report.
