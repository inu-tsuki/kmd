import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const coreRoot = path.join(repoRoot, 'packages', 'core', 'src');
const legacyCoreRoot = path.join(repoRoot, 'apps', 'editor', 'src', 'core');
const readerSourceRoot = path.join(repoRoot, 'packages', 'reader-runtime-web', 'src');

const forbiddenPackages = new Set([
  'vue',
  'pinia',
  'monaco-editor',
  'vscode-textmate',
  'vscode-oniguruma',
]);

function listFiles(root) {
  return readdirSync(root).flatMap((name) => {
    const fullPath = path.join(root, name);
    return statSync(fullPath).isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

function sourceImports(source) {
  const imports = [];
  const pattern = /(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) imports.push(match[1]);
  return imports;
}

const violations = [];

if (!existsSync(coreRoot)) {
  violations.push('packages/core/src 不存在');
} else {
  for (const file of listFiles(coreRoot).filter((candidate) => candidate.endsWith('.ts'))) {
    const source = readFileSync(file, 'utf8');
    for (const specifier of sourceImports(source)) {
      if (forbiddenPackages.has(specifier) || [...forbiddenPackages].some((name) => specifier.startsWith(`${name}/`))) {
        violations.push(`${path.relative(repoRoot, file)} imports editor-only package ${specifier}`);
      }
      if (specifier.startsWith('.')) {
        const resolved = path.resolve(path.dirname(file), specifier);
        if (!resolved.startsWith(coreRoot + path.sep) && resolved !== coreRoot) {
          violations.push(`${path.relative(repoRoot, file)} escapes @kmd/core via ${specifier}`);
        }
      }
    }
  }
}

if (existsSync(legacyCoreRoot)) {
  violations.push('apps/editor/src/core 仍存在；core 必须只有 packages/core/src 一个事实来源');
}

if (existsSync(readerSourceRoot)) {
  for (const file of listFiles(readerSourceRoot).filter((candidate) => candidate.endsWith('.ts'))) {
    const source = readFileSync(file, 'utf8');
    if (source.includes('apps/editor/src/core')) {
      violations.push(`${path.relative(repoRoot, file)} 仍直接引用 editor 内的 legacy core 路径`);
    }
    for (const specifier of sourceImports(source)) {
      if (forbiddenPackages.has(specifier) || [...forbiddenPackages].some((name) => specifier.startsWith(`${name}/`))) {
        violations.push(`${path.relative(repoRoot, file)} imports editor-only package ${specifier}`);
      }
      if (specifier.startsWith('.')) {
        const resolved = path.resolve(path.dirname(file), specifier);
        if (!resolved.startsWith(readerSourceRoot + path.sep) && resolved !== readerSourceRoot) {
          violations.push(`${path.relative(repoRoot, file)} escapes reader source via ${specifier}`);
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error('[core-boundary] failed');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

const coreFileCount = listFiles(coreRoot).filter((candidate) => candidate.endsWith('.ts')).length;
console.log(`[core-boundary] ok: ${coreFileCount} core TypeScript files, no editor-only imports`);
