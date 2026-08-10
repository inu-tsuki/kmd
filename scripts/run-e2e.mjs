import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const repoRoot = path.resolve(import.meta.dirname, '..');
const serverUrl = 'http://127.0.0.1:4174';
const viteCli = path.join(
  repoRoot,
  'packages',
  'reader-runtime-web',
  'node_modules',
  'vite',
  'bin',
  'vite.js',
);
const viteConfig = path.join(repoRoot, 'packages', 'reader-runtime-web', 'vite.config.ts');
const playwrightCli = path.join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js');

async function serverIsReady() {
  try {
    const response = await fetch(serverUrl, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(server) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (await serverIsReady()) return;
    if (server.exitCode !== null) {
      throw new Error(`reader preview exited before becoming ready (code ${server.exitCode})`);
    }
    await delay(100);
  }
  throw new Error(`reader preview did not become ready at ${serverUrl} within 15 seconds`);
}

function runPlaywright(args) {
  const child = spawn(process.execPath, [playwrightCli, 'test', ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      KMD_E2E_EXTERNAL_SERVER: '1',
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`Playwright exited from signal ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

async function stopOwnedServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, 'exit');
  server.kill();
  await Promise.race([exited, delay(5_000)]);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGKILL');
    await once(server, 'exit');
  }
}

const existingServer = await serverIsReady();
const server = existingServer
  ? null
  : spawn(
      process.execPath,
      [viteCli, 'preview', '--config', viteConfig, '--host', '127.0.0.1', '--port', '4174'],
      {
        cwd: repoRoot,
        stdio: 'inherit',
        windowsHide: true,
      },
    );

try {
  if (server) await waitForServer(server);
  process.exitCode = await runPlaywright(process.argv.slice(2));
} finally {
  if (server) await stopOwnedServer(server);
}
