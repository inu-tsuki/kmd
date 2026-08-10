import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: true,
  define: {
    'import.meta.env.BASE_URL': JSON.stringify('/'),
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [
    'vscode-languageserver/node',
    'vscode-languageserver-textdocument',
  ],
  logLevel: 'info',
});
