import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { inspectLanguageAssets, syncLanguageAssets } from '../language-assets.mjs';

const temporaryRoots = [];
const pairs = [
  {
    source: 'packages/language/syntaxes/grammar.json',
    packagedCopy: 'extensions/vscode-kmd/syntaxes/grammar.json',
  },
  {
    source: 'packages/language/config.json',
    packagedCopy: 'extensions/vscode-kmd/config.json',
  },
];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'kmd-language-assets-'));
  temporaryRoots.push(root);
  return root;
}

async function write(root, relativePath, bytes) {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => (
    rm(root, { recursive: true, force: true })
  )));
});

test('creates missing packaged copies byte-for-byte without normalizing CRLF', async () => {
  const root = await makeRoot();
  const grammarBytes = Buffer.from('{\r\n  "scopeName": "source.kmd"\r\n}\r\n');
  const configBytes = Buffer.from([0x00, 0xff, 0x0d, 0x0a]);
  await write(root, pairs[0].source, grammarBytes);
  await write(root, pairs[1].source, configBytes);

  assert.deepEqual(
    (await inspectLanguageAssets({ root, pairs })).map(result => result.status),
    ['missing-packaged-copy', 'missing-packaged-copy'],
  );
  const results = await syncLanguageAssets({ root, pairs });

  assert.deepEqual(results.map(result => result.action), ['copied', 'copied']);
  assert.deepEqual(await readFile(join(root, pairs[0].packagedCopy)), grammarBytes);
  assert.deepEqual(await readFile(join(root, pairs[1].packagedCopy)), configBytes);
});

test('does not rewrite identical packaged copies', async () => {
  const root = await makeRoot();
  const bytes = [Buffer.from('grammar\r\n'), Buffer.from('config\n')];
  for (const [index, pair] of pairs.entries()) {
    await write(root, pair.source, bytes[index]);
    await write(root, pair.packagedCopy, bytes[index]);
  }
  const packagedCopyPath = join(root, pairs[0].packagedCopy);
  const fixedTime = new Date('2001-02-03T04:05:06.000Z');
  await utimes(packagedCopyPath, fixedTime, fixedTime);
  const before = await stat(packagedCopyPath);

  const results = await syncLanguageAssets({ root, pairs });
  const after = await stat(packagedCopyPath);

  assert.deepEqual(results.map(result => result.action), ['unchanged', 'unchanged']);
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test('reports drift and replaces only the stale packaged copy', async () => {
  const root = await makeRoot();
  await write(root, pairs[0].source, Buffer.from('canonical grammar\n'));
  await write(root, pairs[0].packagedCopy, Buffer.from('stale grammar\r\n'));
  await write(root, pairs[1].source, Buffer.from('same config\n'));
  await write(root, pairs[1].packagedCopy, Buffer.from('same config\n'));

  assert.deepEqual(
    (await inspectLanguageAssets({ root, pairs })).map(result => result.status),
    ['drift', 'synced'],
  );
  const results = await syncLanguageAssets({ root, pairs });

  assert.deepEqual(results.map(result => result.action), ['copied', 'unchanged']);
  assert.deepEqual(
    await readFile(join(root, pairs[0].packagedCopy)),
    Buffer.from('canonical grammar\n'),
  );
});

test(
  'accepts Windows case differences and backslash separators inside the allowed roots',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await makeRoot();
    const windowsPairs = [{
      source: 'PACKAGES\\LANGUAGE\\syntaxes\\grammar.json',
      packagedCopy: 'EXTENSIONS\\VSCODE-KMD\\syntaxes\\grammar.json',
    }];
    const bytes = Buffer.from('same bytes\r\n');
    await write(root, 'packages/language/syntaxes/grammar.json', bytes);
    await write(root, 'extensions/vscode-kmd/syntaxes/grammar.json', bytes);

    const [result] = await inspectLanguageAssets({ root, pairs: windowsPairs });
    assert.equal(result.status, 'synced');
  },
);

test('preflights every canonical source and performs zero writes when one is missing', async () => {
  const root = await makeRoot();
  await write(root, pairs[0].source, Buffer.from('canonical grammar\n'));
  await write(root, pairs[0].packagedCopy, Buffer.from('stale grammar\n'));
  let copyCount = 0;
  const io = {
    readFile,
    mkdir,
    copyFile: async (...args) => {
      copyCount += 1;
      return copyFile(...args);
    },
  };

  await assert.rejects(
    syncLanguageAssets({ root, pairs, io }),
    /Canonical language asset is missing: packages[\\/]language[\\/]config\.json/,
  );
  assert.equal(copyCount, 0);
  assert.deepEqual(
    await readFile(join(root, pairs[0].packagedCopy)),
    Buffer.from('stale grammar\n'),
  );
});

function makeCountingIo() {
  const calls = { readFile: 0, mkdir: 0, copyFile: 0 };
  return {
    calls,
    io: {
      readFile: async (...args) => {
        calls.readFile += 1;
        return readFile(...args);
      },
      mkdir: async (...args) => {
        calls.mkdir += 1;
        return mkdir(...args);
      },
      copyFile: async (...args) => {
        calls.copyFile += 1;
        return copyFile(...args);
      },
    },
  };
}

const invalidPairCases = [
  {
    name: 'absolute source',
    field: 'source',
    value: join(process.cwd(), 'absolute-source.json'),
  },
  {
    name: 'absolute packaged copy',
    field: 'packagedCopy',
    value: join(process.cwd(), 'absolute-copy.json'),
  },
  { name: 'direct parent traversal', field: 'source', value: '../outside.json' },
  {
    name: 'nested source traversal',
    field: 'source',
    value: 'packages/language/nested/../../../outside.json',
  },
  {
    name: 'nested packaged-copy traversal with Windows separators',
    field: 'packagedCopy',
    value: 'extensions\\vscode-kmd\\nested\\..\\..\\..\\outside.json',
  },
  {
    name: 'wrong canonical root',
    field: 'source',
    value: 'packages/not-language/grammar.json',
  },
  {
    name: 'wrong extension root',
    field: 'packagedCopy',
    value: 'extensions/not-vscode-kmd/grammar.json',
  },
  { name: 'empty source', field: 'source', value: '   ' },
];

for (const { name, field, value } of invalidPairCases) {
  test(`rejects ${name} before any filesystem I/O`, async () => {
    const root = await makeRoot();
    const { calls, io } = makeCountingIo();
    const invalidPairs = [
      pairs[0],
      { ...pairs[1], [field]: value },
    ];

    await assert.rejects(
      syncLanguageAssets({ root, pairs: invalidPairs, io }),
      error => {
        assert.match(error.message, new RegExp(`languageAssetPairs\\[1\\]\\.${field}`));
        assert.ok(error.message.includes(JSON.stringify(value)), error.message);
        return true;
      },
    );
    assert.deepEqual(calls, { readFile: 0, mkdir: 0, copyFile: 0 });
  });
}
