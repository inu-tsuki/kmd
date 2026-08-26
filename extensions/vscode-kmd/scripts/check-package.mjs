import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { languageAssetPairs } from '../../../scripts/language-assets.mjs';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(extensionRoot, '..', '..');
const manifest = JSON.parse(await readFile(resolve(extensionRoot, 'package.json'), 'utf8'));
const serverPath = resolve(extensionRoot, 'dist', 'server.js');
const clientSource = await readFile(resolve(extensionRoot, 'client.ts'), 'utf8');
const builtClient = await readFile(resolve(extensionRoot, 'dist', 'client.js'), 'utf8');
const builtServer = await readFile(serverPath, 'utf8');
const ignore = await readFile(resolve(extensionRoot, '.vscodeignore'), 'utf8');

const manifestAssetPaths = [
  ...manifest.contributes.languages.map(language => language.configuration),
  ...manifest.contributes.grammars.map(grammar => grammar.path),
];
const configuredPackagedCopies = new Map(languageAssetPairs.map(pair => [
  resolve(repositoryRoot, pair.packagedCopy),
  resolve(repositoryRoot, pair.source),
]));
const manifestPackagedCopies = new Set();

for (const manifestAssetPath of manifestAssetPaths) {
  const packagedCopyPath = resolve(extensionRoot, manifestAssetPath);
  manifestPackagedCopies.add(packagedCopyPath);
  const canonicalPath = configuredPackagedCopies.get(packagedCopyPath);
  assert.ok(
    canonicalPath,
    `VS Code language asset is not declared in the shared asset pair list: ${manifestAssetPath}`,
  );
  const [packagedCopyBytes, canonicalBytes] = await Promise.all([
    readFile(packagedCopyPath),
    readFile(canonicalPath),
  ]);
  assert.doesNotThrow(
    () => JSON.parse(packagedCopyBytes.toString('utf8')),
    `VS Code language asset is not valid JSON: ${manifestAssetPath}`,
  );
  assert.ok(
    packagedCopyBytes.equals(canonicalBytes),
    `VS Code language asset drifted from its canonical @kmd/language source: ${manifestAssetPath}`,
  );
}

assert.equal(
  manifestPackagedCopies.size,
  manifestAssetPaths.length,
  'VS Code extension manifest language asset paths must not be duplicated.',
);
assert.deepEqual(
  manifestPackagedCopies,
  new Set(configuredPackagedCopies.keys()),
  'The VS Code extension manifest must reference every packaged language asset exactly once.',
);

assert.deepEqual(manifest.dependencies, {});
assert.match(clientSource, /join\(context\.extensionPath, 'dist', 'server\.js'\)/);
assert.ok((await stat(serverPath)).size > 100_000, 'dist/server.js is missing or unexpectedly small');
assert.doesNotMatch(builtClient, /require\(["']vscode-languageclient/);
assert.doesNotMatch(builtServer, /require\(["'](?:@kmd\/|vscode-languageserver)/);
assert.match(ignore, /node_modules\/\*\*/);
assert.doesNotMatch(ignore, /!node_modules/);
console.log('[vscode-kmd] packaged server and runtime dependency surface are self-contained.');
