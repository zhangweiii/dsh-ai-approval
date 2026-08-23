import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

describe('release security scripts', () => {
  it('fails the secret scan when Git cannot be inspected', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-ai-approval-git-failure-'))
    try {
      const windows = process.platform === 'win32'
      const shim = join(directory, windows ? 'git.cmd' : 'git')
      writeFileSync(shim, windows ? '@exit /b 42\r\n' : '#!/bin/sh\nexit 42\n', {
        mode: 0o755,
      })
      const result = spawnSync(process.execPath, ['scripts/secret-scan.mjs'], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
        },
      })
      expect(result.status).not.toBe(0)
      expect(result.stdout).not.toContain('secret scan passed')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
