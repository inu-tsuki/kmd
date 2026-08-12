import { build } from 'esbuild';

await build({
  entryPoints: ['client.ts'],
  outfile: 'dist/client.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['vscode'],
  logLevel: 'info',
});
