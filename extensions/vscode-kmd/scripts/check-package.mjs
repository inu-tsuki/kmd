import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(extensionRoot, 'package.json'), 'utf8'));
const serverPath = resolve(extensionRoot, 'dist', 'server.js');
const clientSource = await readFile(resolve(extensionRoot, 'client.ts'), 'utf8');
const builtClient = await readFile(resolve(extensionRoot, 'dist', 'client.js'), 'utf8');
const builtServer = await readFile(serverPath, 'utf8');
const ignore = await readFile(resolve(extensionRoot, '.vscodeignore'), 'utf8');

assert.deepEqual(manifest.dependencies, {});
assert.match(clientSource, /join\(context\.extensionPath, 'dist', 'server\.js'\)/);
assert.ok((await stat(serverPath)).size > 100_000, 'dist/server.js is missing or unexpectedly small');
assert.doesNotMatch(builtClient, /require\(["']vscode-languageclient/);
assert.doesNotMatch(builtServer, /require\(["'](?:@kmd\/|vscode-languageserver)/);
assert.match(ignore, /node_modules\/\*\*/);
assert.doesNotMatch(ignore, /!node_modules/);
console.log('[vscode-kmd] packaged server and runtime dependency surface are self-contained.');
