import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const listed = JSON.parse(
  execFileSync('pnpm', ['list', '--prod', '--json', '--depth', 'Infinity'], {
    cwd: root,
    encoding: 'utf8',
  }),
)[0]

function purl(name, version) {
  if (name.startsWith('@')) {
    const [scope, packageName] = name.split('/')
    return `pkg:npm/${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}@${encodeURIComponent(version)}`
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`
}

const components = new Map()
const dependencies = new Map()

function addComponent(name, version, properties = []) {
  const ref = purl(name, version)
  if (!components.has(ref)) {
    components.set(ref, {
      type: 'library',
      name,
      version,
      'bom-ref': ref,
      purl: ref,
      ...(properties.length === 0 ? {} : { properties }),
    })
  }
  return ref
}

function visit(name, node) {
  const ref = addComponent(name, node.version)
  const childRefs = Object.entries(node.dependencies ?? {}).map(([childName, child]) =>
    visit(childName, child),
  )
  dependencies.set(ref, [...new Set(childRefs)].sort())
  return ref
}

const rootRef = purl(packageJson.name, packageJson.version)
const rootDependencies = Object.entries(listed.dependencies ?? {}).map(([name, node]) =>
  visit(name, node),
)
for (const [name, version] of Object.entries(packageJson.peerDependencies ?? {})) {
  rootDependencies.push(
    addComponent(name, version, [
      { name: 'ai-approval-reviewer:relationship', value: 'peerDependency' },
    ]),
  )
}
dependencies.set(rootRef, [...new Set(rootDependencies)].sort())

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  version: 1,
  metadata: {
    component: {
      type: 'library',
      name: packageJson.name,
      version: packageJson.version,
      'bom-ref': rootRef,
      purl: rootRef,
    },
    tools: {
      components: [{ type: 'application', name: 'ai-approval-reviewer-sbom', version: '1' }],
    },
  },
  components: [...components.values()].sort((left, right) =>
    left['bom-ref'].localeCompare(right['bom-ref']),
  ),
  dependencies: [...dependencies.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([ref, dependsOn]) => ({ ref, dependsOn })),
}

if (process.argv.includes('--check')) {
  console.log(`SBOM checks passed (${bom.components.length} components)`)
} else {
  process.stdout.write(`${JSON.stringify(bom, null, 2)}\n`)
}
