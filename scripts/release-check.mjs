import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const changelog = await readFile(new URL('CHANGELOG.md', root), 'utf8')
const security = await readFile(new URL('SECURITY.md', root), 'utf8')

const version = packageJson.version
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/
if (typeof version !== 'string' || !semver.test(version)) {
  throw new Error(`package version is not valid SemVer: ${String(version)}`)
}
if (!changelog.includes(`## ${version}`)) {
  throw new Error(`CHANGELOG.md has no release heading for ${version}`)
}
if (security.includes('<OWNER>') || security.includes('<REPOSITORY>')) {
  throw new Error('SECURITY.md still contains repository placeholders')
}
if (!String(packageJson.repository?.url).startsWith('git+https://github.com/')) {
  throw new Error('package repository must use a full git+https URL')
}

console.log(`release metadata checks passed for ${packageJson.name}@${version}`)
