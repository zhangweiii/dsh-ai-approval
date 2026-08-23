import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const changelog = await readFile(new URL('CHANGELOG.md', root), 'utf8')
const security = await readFile(new URL('SECURITY.md', root), 'utf8')

const version = packageJson.version
const numericIdentifier = String.raw`(?:0|[1-9]\d*)`
const prereleaseIdentifier = String.raw`(?:${numericIdentifier}|\d*[A-Za-z-][0-9A-Za-z-]*)`
const buildIdentifier = String.raw`[0-9A-Za-z-]+`
const semver = new RegExp(
  String.raw`^${numericIdentifier}\.${numericIdentifier}\.${numericIdentifier}(?:-${prereleaseIdentifier}(?:\.${prereleaseIdentifier})*)?(?:\+${buildIdentifier}(?:\.${buildIdentifier})*)?$`,
)
if (typeof version !== 'string' || !semver.test(version)) {
  throw new Error(`package version is not valid SemVer: ${String(version)}`)
}
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
if (!new RegExp(`^## ${escapedVersion}\\s*$`, 'm').test(changelog)) {
  throw new Error(`CHANGELOG.md has no exact release heading for ${version}`)
}
if (security.includes('<OWNER>') || security.includes('<REPOSITORY>')) {
  throw new Error('SECURITY.md still contains repository placeholders')
}
const repository = String(packageJson.repository?.url)
if (
  !repository.startsWith('git+https://github.com/') ||
  !repository.endsWith(`/${packageJson.name}.git`)
) {
  throw new Error('package repository must be a matching full git+https GitHub URL')
}
if (packageJson.private === true || packageJson.publishConfig?.access !== 'public') {
  throw new Error('package must be configured for public publication')
}
const repositoryWeb = repository.slice(4, -4)
if (packageJson.homepage !== `${repositoryWeb}#readme`) {
  throw new Error('package homepage must match the GitHub repository')
}
if (packageJson.bugs?.url !== `${repositoryWeb}/issues`) {
  throw new Error('package bugs URL must match the GitHub repository')
}

console.log(`release metadata checks passed for ${packageJson.name}@${version}`)
