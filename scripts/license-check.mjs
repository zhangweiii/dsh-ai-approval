import { execFileSync } from 'node:child_process'

const report = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { encoding: 'utf8' }),
)
const allowed = new Set(['0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MIT'])
const rejected = Object.keys(report).filter((license) => !allowed.has(license))
if (rejected.length > 0) {
  throw new Error(`production dependencies use unapproved licenses: ${rejected.join(', ')}`)
}
const packages = Object.values(report).reduce((count, entries) => count + entries.length, 0)
console.log(`license checks passed (${packages} production packages)`)
