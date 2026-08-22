import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  outDir: 'lib',
  outExtensions: () => ({ js: '.cjs' }),
  clean: false,
  dts: false,
  sourcemap: true,
  deps: {
    neverBundle: [
      'react',
      '@deepseek-ai/dsh-client-runtime/client',
      '@deepseek-ai/dsh-client-ui-conversation/client',
    ],
  },
  banner:
    'window.__ModuleLoader__.load({ id: "ai-approval-reviewer", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
  footer: 'return module.exports; } });',
})
