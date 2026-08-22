import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  auditHistories,
  repairHistories,
  repairHistory,
  repairJsonLines,
} from '../scripts/repair-ai-approval-history.mjs'

async function writeCompressedSession(directory: string, name: string, events: unknown[]) {
  const sessionDirectory = join(directory, name)
  await mkdir(sessionDirectory)
  const source = join(sessionDirectory, 'session.jsonl')
  const compressed = `${source}.zstd`
  await writeFile(
    source,
    [
      JSON.stringify({ version: 1, id: name }),
      ...events.map((event) => JSON.stringify(event)),
      '',
    ].join('\n'),
  )
  execFileSync('zstd', ['--quiet', '--force', source, '-o', compressed])
  return compressed
}

describe('legacy AI approval history repair', () => {
  it('marks only legacy plugin events ignorable and preserves unrelated lines', () => {
    const normal = JSON.stringify({ type: 'tool/call', seq: 1, data: {} })
    const started = JSON.stringify({
      type: 'ai-approval/review-started',
      seq: 2,
      data: { reviewId: 'review-1' },
    })
    const reviewed = JSON.stringify({
      type: 'ai-approval/reviewed',
      seq: 3,
      data: { reviewId: 'review-1' },
      ignorable: true,
    })

    const result = repairJsonLines(`${normal}\n${started}\n${reviewed}\n`)
    expect(result.repaired).toBe(1)
    const lines = result.text.trimEnd().split('\n').map(JSON.parse)
    expect(lines[0]).toEqual(JSON.parse(normal))
    expect(lines[1]).toMatchObject({
      type: 'ai-approval/review-started',
      seq: 2,
      ignorable: true,
    })
    expect(lines[2]).toEqual(JSON.parse(reviewed))
  })

  it('writes the header as its own first Zstandard frame', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-approval-history-'))
    const source = join(directory, 'session.jsonl')
    const compressed = `${source}.zstd`
    try {
      await writeFile(
        source,
        [
          JSON.stringify({ version: 1, id: 'session-1' }),
          JSON.stringify({ type: 'ai-approval/review-started', seq: 0, data: {} }),
          JSON.stringify({ type: 'tool/call', seq: 1, data: {} }),
          '',
        ].join('\n'),
      )
      execFileSync('zstd', ['--quiet', '--force', source, '-o', compressed])
      const original = await readFile(compressed)

      const result = await repairHistory(compressed)
      expect(result.repaired).toBe(1)
      const listing = execFileSync('zstd', ['--list', '--verbose', compressed], {
        encoding: 'utf8',
      })
      expect(listing).toContain('# Zstandard Frames: 2')
      const decoded = execFileSync('zstd', ['--quiet', '--decompress', '--stdout', compressed], {
        encoding: 'utf8',
      })
      const lines = decoded.trimEnd().split('\n').map(JSON.parse)
      expect(lines[0]).toEqual({ version: 1, id: 'session-1' })
      expect(lines[1]).toMatchObject({
        type: 'ai-approval/review-started',
        ignorable: true,
      })
      expect(await readFile(result.backup)).toEqual(original)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('audits and repairs every affected session in a directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-approval-histories-'))
    try {
      const affected = await writeCompressedSession(directory, 'affected', [
        { type: 'ai-approval/review-started', seq: 0, data: {} },
        { type: 'ai-approval/reviewed', seq: 1, data: {} },
      ])
      const clean = await writeCompressedSession(directory, 'clean', [
        { type: 'tool/call', seq: 0, data: {} },
      ])
      const cleanBefore = await readFile(clean)

      await expect(auditHistories(directory)).resolves.toMatchObject({
        scanned: 2,
        legacy: 2,
        unmarked: 2,
      })
      await expect(repairHistories(directory)).resolves.toMatchObject({
        scanned: 2,
        repairedFiles: 1,
        repaired: 2,
      })
      await expect(auditHistories(directory)).resolves.toMatchObject({
        scanned: 2,
        legacy: 2,
        unmarked: 0,
      })
      expect(await readFile(clean)).toEqual(cleanBefore)
      const listing = execFileSync('zstd', ['--list', '--verbose', affected], {
        encoding: 'utf8',
      })
      expect(listing).toContain('# Zstandard Frames: 2')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
