import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export const repositoryRoot = resolve(import.meta.dirname, '..');

/**
 * `packages/language` is canonical. The extension paths are packaged copies
 * because a VSIX cannot resolve monorepo workspace assets at runtime.
 */
export const languageAssetPairs = Object.freeze([
  Object.freeze({
    source: 'packages/language/syntaxes/kmd.tmLanguage.json',
    packagedCopy: 'extensions/vscode-kmd/syntaxes/kmd.tmLanguage.json',
  }),
  Object.freeze({
    source: 'packages/language/language-configuration.json',
    packagedCopy: 'extensions/vscode-kmd/language-configuration.json',
  }),
]);

const defaultIo = Object.freeze({ copyFile, mkdir, readFile });

async function readIfPresent(path, io) {
  try {
    return await io.readFile(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function isPortableAbsolutePath(value) {
  return isAbsolute(value) || /^[a-z]:/i.test(value) || /^[/\\]/.test(value);
}

function isContainedPath(parentPath, candidatePath) {
  const relativePath = relative(parentPath, candidatePath);
  return relativePath.length > 0 &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath);
}

function resolvePair(root, pair, pairIndex) {
  const fields = [
    ['source', resolve(root, 'packages', 'language')],
    ['packagedCopy', resolve(root, 'extensions', 'vscode-kmd')],
  ];
  const resolvedFields = {};

  for (const [field, expectedRoot] of fields) {
    const value = pair?.[field];
    const fieldLabel = `languageAssetPairs[${pairIndex}].${field}`;
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${fieldLabel} must be a non-empty relative path; received ${JSON.stringify(value)}.`);
    }
    if (isPortableAbsolutePath(value)) {
      throw new Error(`${fieldLabel} must be relative; received ${JSON.stringify(value)}.`);
    }

    // Treat both slash styles as separators on every host. This keeps a pair
    // written on Windows safe when the same repository is checked on Linux.
    const portablePath = value.replace(/[\\/]+/g, sep);
    const resolvedPath = resolve(root, portablePath);
    if (!isContainedPath(expectedRoot, resolvedPath)) {
      const expectedRelativeRoot = relative(root, expectedRoot);
      throw new Error(
        `${fieldLabel} must resolve inside ${expectedRelativeRoot}; received ${JSON.stringify(value)}.`,
      );
    }
    resolvedFields[field] = resolvedPath;
  }

  return {
    ...pair,
    sourcePath: resolvedFields.source,
    packagedCopyPath: resolvedFields.packagedCopy,
  };
}

export async function inspectLanguageAssets({
  root = repositoryRoot,
  pairs = languageAssetPairs,
  io = defaultIo,
} = {}) {
  // Resolve and validate every configured pair before the first filesystem
  // operation. Invalid later pairs therefore cannot cause partial reads or
  // writes from earlier entries.
  const resolvedPairs = pairs.map((pair, index) => resolvePair(root, pair, index));
  const results = [];

  for (const resolvedPair of resolvedPairs) {
    const [sourceBytes, packagedCopyBytes] = await Promise.all([
      readIfPresent(resolvedPair.sourcePath, io),
      readIfPresent(resolvedPair.packagedCopyPath, io),
    ]);

    let status;
    if (sourceBytes === null) status = 'missing-source';
    else if (packagedCopyBytes === null) status = 'missing-packaged-copy';
    else status = sourceBytes.equals(packagedCopyBytes) ? 'synced' : 'drift';

    results.push({
      ...resolvedPair,
      sourceDisplayPath: relative(root, resolvedPair.sourcePath),
      packagedCopyDisplayPath: relative(root, resolvedPair.packagedCopyPath),
      status,
    });
  }

  return results;
}

export async function syncLanguageAssets(options = {}) {
  const results = await inspectLanguageAssets(options);
  const missingSources = results.filter(result => result.status === 'missing-source');
  if (missingSources.length > 0) {
    throw new Error(
      `Canonical language asset is missing: ${missingSources
        .map(result => result.sourceDisplayPath)
        .join(', ')}`,
    );
  }

  const io = options.io ?? defaultIo;
  const syncResults = [];
  for (const result of results) {
    if (result.status === 'synced') {
      syncResults.push({ ...result, action: 'unchanged' });
      continue;
    }

    await io.mkdir(dirname(result.packagedCopyPath), { recursive: true });
    // Keep the packaged copy byte-for-byte identical to the canonical asset.
    // Do not parse/stringify JSON here: that would rewrite whitespace or EOLs.
    await io.copyFile(result.sourcePath, result.packagedCopyPath);
    syncResults.push({ ...result, action: 'copied' });
  }

  return syncResults;
}
