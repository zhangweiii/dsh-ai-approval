import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const signatures = [
  ['private-key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['openai-api-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ['npm-token', /\bnpm_[A-Za-z0-9]{20,}\b/],
  ['gitlab-token', /\bglpat-[A-Za-z0-9_-]{20,}\b/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['authorization-header', /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{20,}(?=$|[\s,;}"'])/i],
  ['credentialed-url', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]{8,}@/i],
]

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
    ...options,
  })
}

function assertGitRepository() {
  if (git(['rev-parse', '--is-inside-work-tree']).trim() !== 'true') {
    throw new Error('secret scan requires a Git repository')
  }
}

function currentFiles() {
  const deleted = new Set(git(['ls-files', '-z', '--deleted']).split('\0').filter(Boolean))
  return git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter((file) => file && !deleted.has(file))
    .map((file) => resolve(root, file))
}

function historyBlobs() {
  const blobs = []
  const seen = new Set()
  for (const row of git(['rev-list', '--objects', '--all']).split(/\r?\n/)) {
    if (!row) continue
    const separator = row.indexOf(' ')
    const object = separator < 0 ? row : row.slice(0, separator)
    const path = separator < 0 ? '<unknown>' : row.slice(separator + 1)
    if (seen.has(object) || git(['cat-file', '-t', object]).trim() !== 'blob') continue
    seen.add(object)
    const text = git(['cat-file', '-p', object])
    blobs.push({ location: `${path}@${object.slice(0, 12)}`, text })
  }
  return blobs
}

function scan(location, text, findings) {
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    for (const [label, signature] of signatures) {
      if (signature.test(line)) findings.add(`${label}: ${location}:${index + 1}`)
    }
  }
}

assertGitRepository()
const current = currentFiles()
const history = historyBlobs()
const findings = new Set()
for (const file of current) scan(relative(root, file), readFileSync(file, 'utf8'), findings)
for (const blob of history) scan(blob.location, blob.text, findings)

if (findings.size) {
  console.error(`Potential secrets found:\n${[...findings].sort().join('\n')}`)
  process.exitCode = 1
} else {
  console.log(
    `secret scan passed (${current.length} current files, ${history.length} historical blobs)`,
  )
}
