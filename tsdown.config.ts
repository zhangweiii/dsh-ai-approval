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
      '@deepseek-ai/dsh-client-ui-chat/client',
      '@deepseek-ai/dsh-client-ui-conversation/client',
    ],
  },
  banner:
    'window.__ModuleLoader__.load({ id: "dsh-ai-approval", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
  footer: 'return module.exports; } });',
})
