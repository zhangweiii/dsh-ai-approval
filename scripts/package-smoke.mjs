import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
const temp = mkdtempSync(join(tmpdir(), 'ai-approval-smoke-'))
const cleanProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith('npm_config_')),
)
const npmEnv = {
  ...cleanProcessEnv,
  npm_config_cache: join(temp, 'cache'),
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  npm_config_update_notifier: 'false',
}
try {
  const tarball = execFileSync('npm', ['pack', '--silent', '--pack-destination', temp], {
    cwd: root,
    encoding: 'utf8',
    env: npmEnv,
  })
    .trim()
    .split(/\r?\n/)
    .pop()
  const tarballPath = join(temp, tarball)
  if (!existsSync(tarballPath)) throw new Error(`npm pack did not create ${tarballPath}`)
  const entries = execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
  const forbidden = entries.filter((entry) => /(^|\/)(src|tests)\/|tsbuildinfo$/.test(entry))
  if (forbidden.length) throw new Error(`tarball contains forbidden files: ${forbidden.join(', ')}`)
  const bundlePatch = packageJson.dsh?.bundle?.patch
  if (typeof bundlePatch !== 'string' || !bundlePatch.startsWith('./')) {
    throw new Error('package manifest must declare a relative dsh.bundle.patch')
  }
  const packagedBundlePatch = `package/${bundlePatch.slice(2)}`
  for (const required of [
    `package/lib/index.js`,
    `package/lib/index.d.ts`,
    `package/lib/client.cjs`,
    `package/lib/client/index.d.ts`,
    `package/lib/types.js`,
    `package/lib/types.d.ts`,
    packagedBundlePatch,
  ]) {
    if (!entries.includes(required)) throw new Error(`tarball is missing ${required}`)
  }
  execFileSync('npm', ['init', '--yes'], { cwd: temp, stdio: 'ignore', env: npmEnv })
  const peerSpecs = Object.entries(packageJson.peerDependencies ?? {})
    .filter(([name]) => packageJson.peerDependenciesMeta?.[name]?.optional !== true)
    .map(([name, version]) => `${name}@${version}`)
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--legacy-peer-deps',
      '--no-audit',
      '--no-fund',
      ...peerSpecs,
      join(temp, tarball),
    ],
    {
      cwd: temp,
      stdio: 'inherit',
      env: npmEnv,
    },
  )

  const installed = join(temp, 'node_modules', packageJson.name)
  if (!existsSync(join(installed, bundlePatch))) {
    throw new Error(`installed package is missing DSH bundle patch ${bundlePatch}`)
  }
  const installedBundlePatch = readFileSync(join(installed, bundlePatch), 'utf8')
  for (const [name, pattern] of [
    ['bounded reviewer context', /contextMode:\s*bounded/],
    ['medium risk threshold', /maxRisk:\s*medium/],
    ['high authorization threshold', /minAuthorization:\s*high/],
    ['disabled reasoning effort', /reasoningEffort:\s*['"]?off['"]?/],
  ]) {
    if (!pattern.test(installedBundlePatch)) {
      throw new Error(`installed DSH bundle patch is missing ${name}`)
    }
  }
  if (packageJson.dsh?.client?.platform !== 'web') {
    throw new Error('package manifest must declare a Web dsh.client entry')
  }
  const clientBundle = readFileSync(join(installed, 'lib/client.cjs'), 'utf8')
  if (!clientBundle.includes('window.__ModuleLoader__.load')) {
    throw new Error('installed package client entry is not a DSH ModuleLoader bundle')
  }
  writeFileSync(
    join(temp, 'import.mjs'),
    `const module = await import(${JSON.stringify(packageJson.name)})\nif (!module || typeof module !== 'object') throw new Error('package import returned no module')\n`,
  )
  execFileSync(process.execPath, ['import.mjs'], { cwd: temp, stdio: 'inherit' })
  const resolved = execFileSync(
    process.execPath,
    ['-e', `console.log(require.resolve(${JSON.stringify(`${packageJson.name}/package.json`)}))`],
    {
      cwd: temp,
      encoding: 'utf8',
    },
  ).trim()
  if (!realpathSync(resolved).startsWith(realpathSync(installed))) {
    throw new Error('package.json export resolved outside installed package')
  }

  writeFileSync(
    join(temp, 'index.ts'),
    `import type * as Package from ${JSON.stringify(packageJson.name)}\nconst value: typeof Package = {} as typeof Package\nvoid value\n`,
  )
  execFileSync(
    join(root, 'node_modules', '.bin', 'tsc'),
    [
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      join(temp, 'index.ts'),
    ],
    { cwd: temp, stdio: 'ignore' },
  )
  console.log(`smoke checks passed for ${packageJson.name}`)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
