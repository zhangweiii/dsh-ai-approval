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

function addComponent(name, version) {
  const ref = purl(name, version)
  if (!components.has(ref)) {
    components.set(ref, {
      type: 'library',
      name,
      version,
      'bom-ref': ref,
      purl: ref,
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
dependencies.set(rootRef, [...new Set(rootDependencies)].sort())

const peerProperties = Object.entries(packageJson.peerDependencies ?? {})
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([name, range]) => ({
    name: `dsh-ai-approval:peerDependency:${name}`,
    value: String(range),
  }))

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
      ...(peerProperties.length === 0 ? {} : { properties: peerProperties }),
    },
    tools: {
      components: [{ type: 'application', name: 'dsh-ai-approval-sbom', version: '1' }],
    },
  },
  components: [...components.values()].sort((left, right) =>
    left['bom-ref'].localeCompare(right['bom-ref']),
  ),
  dependencies: [...dependencies.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([ref, dependsOn]) => ({ ref, dependsOn })),
}

function validateBom(value) {
  if (value.bomFormat !== 'CycloneDX' || value.specVersion !== '1.6') {
    throw new Error('SBOM must use CycloneDX 1.6')
  }
  const refs = new Set([rootRef, ...value.components.map((component) => component['bom-ref'])])
  if (refs.size !== value.components.length + 1)
    throw new Error('SBOM contains duplicate bom-ref values')
  for (const component of value.components) {
    if (typeof component.version !== 'string' || /^[*<>=~^]|\s\|\|\s/.test(component.version)) {
      throw new Error(
        `SBOM component ${component.name} has a dependency range instead of a version`,
      )
    }
  }
  for (const dependency of value.dependencies) {
    if (!refs.has(dependency.ref))
      throw new Error(`SBOM dependency ref is unknown: ${dependency.ref}`)
    for (const ref of dependency.dependsOn) {
      if (!refs.has(ref)) throw new Error(`SBOM dependsOn ref is unknown: ${ref}`)
    }
  }
  for (const property of peerProperties) {
    if (!property.name.startsWith('dsh-ai-approval:peerDependency:')) {
      throw new Error('SBOM peer dependency property is malformed')
    }
  }
}

validateBom(bom)
if (process.argv.includes('--check')) {
  console.log(
    `SBOM checks passed (${bom.components.length} resolved components, ${peerProperties.length} peer ranges)`,
  )
} else {
  process.stdout.write(`${JSON.stringify(bom, null, 2)}\n`)
}
