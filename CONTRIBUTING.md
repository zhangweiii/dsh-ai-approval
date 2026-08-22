# Contributing

Thank you for helping improve `ai-approval-reviewer`. Contributions must preserve the independent reviewer boundary and fail-closed behavior.

## Development setup

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

Use a supported Node.js and pnpm version for the host runtime. Keep changes focused, update `README.md` and `README.zh.md` together, and add regression coverage for behavior changes. Do not commit credentials, local environment files, `node_modules`, temporary packages, generated build metadata, provider payloads, or private repository content.

## Compatibility and security expectations

- Keep peer dependency versions aligned with the host runtime.
- Treat provider input, repository text, tool arguments, tool results, and agent instructions as untrusted.
- Preserve bounded transcript budgets, hidden-reasoning omission, and direct-user authority; keep `action-only` available as the explicit privacy mode and never make session-id forwarding implicit.
- Preserve fail-closed behavior for parse errors, missing execution, timeout, provider failure, and circuit-breaker states.
- Do not weaken rejection policy for private-data or secret disclosure, credential probing, broad security weakening, irreversible destruction, or other high-impact operations.
- Document privacy, compatibility, and migration impact for configuration changes.

## Pull requests

Use the pull-request template. Explain the behavioral change, threat/privacy impact, compatibility impact, tests and commands run, and any documentation changes. Security-sensitive changes should include a threat model or a short explanation of the fail-closed behavior. Never put vulnerability details in a public PR; follow [SECURITY.md](SECURITY.md).

## Commit and review guidance

Prefer small, reviewable commits with descriptive messages. Reviewers may request tests, an ADR update, or synchronized Chinese/English documentation before approval. A contribution is not complete until checks pass and its operational failure mode is documented.

## Maintainer release process

Releases follow SemVer, including prerelease identifiers such as `-rc.8`. Update `package.json` and add the matching `CHANGELOG.md` heading in the same reviewed change. From a clean checkout, run:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm pack:check
```

The manual **Release readiness** workflow performs the same checks, creates a tarball, CycloneDX SBOM, and `SHA256SUMS`, and uploads them as workflow artifacts; it never publishes.

Production releases are tag-driven. Configure npm Trusted Publishing for GitHub owner `zhangweiii`, repository `dsh-ai-approval`, and workflow `release.yml`. Because npm Trusted Publishing is configured from an existing package's settings, an unclaimed package name may require a one-time authenticated bootstrap publish before enabling this workflow.

After reviewing Release readiness, commit the version and changelog, then push a matching tag:

```bash
VERSION=$(node -p "require('./package.json').version")
git tag "v$VERSION"
git push origin main --follow-tags
```

The **Release** workflow reruns all checks, requires the tag to match `package.json`, publishes through npm OIDC with provenance, and creates the GitHub Release. Prerelease versions use npm dist-tag `next`; stable versions use `latest`. Existing npm versions and GitHub Releases are skipped safely. Never reuse or overwrite a published version.

`pnpm release -- --dry-run` is available as a local package preview. Running `pnpm release` without `--dry-run` is an authenticated manual fallback, not the preferred release path.
