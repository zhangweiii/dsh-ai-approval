#!/usr/bin/env node

import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const LEGACY_TYPES = new Set(['ai-approval/review-started', 'ai-approval/reviewed'])

export function repairJsonLines(text) {
  let repaired = 0
  const lines = text.split('\n')
  const output = lines.map((line, index) => {
    if (!line) return line
    let event
    try {
      event = JSON.parse(line)
    } catch (error) {
      throw new Error(`第 ${index + 1} 行不是有效 JSON：${error.message}`)
    }
    if (LEGACY_TYPES.has(event.type) && event.ignorable !== true) {
      event.ignorable = true
      repaired++
      return JSON.stringify(event)
    }
    return line
  })
  return { text: output.join('\n'), repaired }
}

export function inspectJsonLines(text) {
  let legacy = 0
  let unmarked = 0
  for (const [index, line] of text.split('\n').entries()) {
    if (!line) continue
    let event
    try {
      event = JSON.parse(line)
    } catch (error) {
      throw new Error(`第 ${index + 1} 行不是有效 JSON：${error.message}`)
    }
    if (!LEGACY_TYPES.has(event.type)) continue
    legacy++
    if (event.ignorable !== true) unmarked++
  }
  return { legacy, unmarked }
}

function runZstd(args) {
  const result = spawnSync('zstd', args, { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim() || `zstd 退出码 ${result.status}`)
}

function readZstd(target) {
  const result = spawnSync('zstd', ['--quiet', '--decompress', '--stdout', target], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim() || `zstd 退出码 ${result.status}`)
  return result.stdout
}

async function findSessionLogs(input) {
  const target = resolve(input)
  const info = await stat(target)
  if (info.isFile()) {
    if (!target.endsWith('.jsonl.zstd')) throw new Error('只接受 .jsonl.zstd 会话日志')
    return [target]
  }
  if (!info.isDirectory()) throw new Error('目标必须是会话日志或 session 目录')
  const found = []
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && entry.name === 'session.jsonl.zstd') found.push(path)
    }
  }
  await visit(target)
  return found
}

export async function auditHistories(input) {
  const targets = await findSessionLogs(input)
  const files = targets.map((target) => ({ target, ...inspectJsonLines(readZstd(target)) }))
  return {
    scanned: files.length,
    legacy: files.reduce((total, file) => total + file.legacy, 0),
    unmarked: files.reduce((total, file) => total + file.unmarked, 0),
    files,
  }
}

export async function repairHistories(input) {
  const audit = await auditHistories(input)
  const candidates = audit.files.filter((file) => file.unmarked > 0)
  const files = []
  for (const candidate of candidates) files.push(await repairHistory(candidate.target))
  return {
    scanned: audit.scanned,
    repairedFiles: files.length,
    repaired: files.reduce((total, file) => total + file.repaired, 0),
    files,
  }
}

export async function repairHistory(input) {
  const target = resolve(input)
  if (!target.endsWith('.jsonl.zstd')) throw new Error('只接受 .jsonl.zstd 会话日志')
  const info = await stat(target)
  if (!info.isFile()) throw new Error('目标不是普通文件')

  const work = await mkdtemp(join(dirname(target), '.ai-approval-repair-'))
  const decoded = join(work, 'session.jsonl')
  const header = join(work, 'header.jsonl')
  const body = join(work, 'events.jsonl')
  const encodedHeader = `${header}.zstd`
  const encodedBody = `${body}.zstd`
  const encoded = join(work, 'session.jsonl.zstd')
  try {
    runZstd(['--quiet', '--force', '--decompress', target, '-o', decoded])
    const result = repairJsonLines(await readFile(decoded, 'utf8'))
    if (result.repaired === 0) return { target, backup: undefined, repaired: 0 }
    const headerEnd = result.text.indexOf('\n')
    if (headerEnd < 0 || headerEnd === result.text.length - 1)
      throw new Error('会话日志必须包含独立 header 行和至少一条事件')
    await writeFile(header, result.text.slice(0, headerEnd + 1), 'utf8')
    await writeFile(body, result.text.slice(headerEnd + 1), 'utf8')
    runZstd(['--quiet', '--force', header, '-o', encodedHeader])
    runZstd(['--quiet', '--force', body, '-o', encodedBody])
    await writeFile(
      encoded,
      Buffer.concat([await readFile(encodedHeader), await readFile(encodedBody)]),
    )
    await chmod(encoded, info.mode & 0o7777)
    const backup = `${target}.bak-ai-approval-${Date.now()}-${randomUUID()}`
    await copyFile(target, backup, constants.COPYFILE_EXCL)
    await rename(encoded, target)
    return { target, backup, repaired: result.repaired }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

function isMainModule() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isMainModule()) {
  const check = process.argv[2] === '--check'
  const input = process.argv[check ? 3 : 2]
  if (!input) {
    console.error(
      '用法：node scripts/repair-ai-approval-history.mjs [--check] <session.jsonl.zstd|sessions-directory>',
    )
    process.exitCode = 2
  } else {
    try {
      if (check) {
        const result = await auditHistories(input)
        console.log(
          `已检查 ${result.scanned} 个 session；旧 AI 审批事件 ${result.legacy} 条，未标记 ${result.unmarked} 条。`,
        )
        if (result.unmarked > 0) process.exitCode = 1
      } else {
        const result = await repairHistories(input)
        if (result.repaired === 0) console.log(`已检查 ${result.scanned} 个 session，无需修复。`)
        else
          console.log(
            `已检查 ${result.scanned} 个 session；修复 ${result.repairedFiles} 个文件、${result.repaired} 条旧 AI 审批事件。`,
          )
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
