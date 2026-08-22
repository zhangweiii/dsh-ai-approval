#!/usr/bin/env bash
# Optional local publisher. The preferred path is pushing a matching v* tag so
# .github/workflows/release.yml publishes through npm trusted publishing.
set -euo pipefail

cd "$(dirname "$0")/.."

name=$(node -p "require('./package.json').name")
version=$(node -p "require('./package.json').version")

if [[ "$version" == *-* ]]; then
  tag=next
else
  tag=latest
fi

existing=$(npm view "${name}@${version}" version 2>/dev/null || true)
if [[ -n "$existing" ]]; then
  echo "error: ${name}@${version} is already published; bump the version first" >&2
  exit 1
fi

if [[ -n $(git status --porcelain) ]]; then
  echo "error: the working tree must be clean before a local release" >&2
  exit 1
fi

pnpm check
printf 'Publishing %s@%s with npm dist-tag %s\n' "$name" "$version" "$tag"
npm publish --tag "$tag" --access public "$@"
