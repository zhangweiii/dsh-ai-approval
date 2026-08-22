import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cache = mkdtempSync(join(tmpdir(), 'ai-approval-pack-cache-'))
const cleanProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith('npm_config_')),
)
try {
  execFileSync('npm', ['pack', '--dry-run'], {
    cwd: new URL('../', import.meta.url),
    env: {
      ...cleanProcessEnv,
      npm_config_cache: cache,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
    },
    stdio: 'inherit',
  })
} finally {
  rmSync(cache, { recursive: true, force: true })
}
