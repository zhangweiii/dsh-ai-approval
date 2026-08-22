import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const skippedDirectories = new Set(['.git', 'coverage', 'lib', 'node_modules'])
const highConfidenceSecret =
  /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:gh[pousr]|github_pat|AKIA)[A-Za-z0-9_\-]{16,}|sk-[A-Za-z0-9]{20,})/

function fallbackFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...fallbackFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function trackedFiles() {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const files = output
      .split('\0')
      .filter(Boolean)
      .map((file) => resolve(root, file))
    return files.length ? files : fallbackFiles(root)
  } catch {
    return fallbackFiles(root)
  }
}

const files = trackedFiles()
const findings = []
for (const file of files) {
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (highConfidenceSecret.test(line)) findings.push(`${relative(root, file)}:${index + 1}`)
  }
}
if (findings.length) {
  console.error(`Potential secrets found:\n${findings.join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`secret scan passed (${files.length} files checked)`)
}
