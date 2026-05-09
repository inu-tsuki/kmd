import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

const pairs = [
  [
    'packages/language/syntaxes/kmd.tmLanguage.json',
    'extensions/vscode-kmd/syntaxes/kmd.tmLanguage.json',
  ],
  [
    'packages/language/language-configuration.json',
    'extensions/vscode-kmd/language-configuration.json',
  ],
];

let hasMismatch = false;

for (const [packagePath, extensionPath] of pairs) {
  const packageFile = resolve(root, packagePath);
  const extensionFile = resolve(root, extensionPath);
  const [packageContent, extensionContent] = await Promise.all([
    readFile(packageFile, 'utf8'),
    readFile(extensionFile, 'utf8'),
  ]);

  if (packageContent !== extensionContent) {
    hasMismatch = true;
    console.error(`Language asset drift: ${relative(root, packageFile)} != ${relative(root, extensionFile)}`);
  }
}

if (hasMismatch) {
  console.error('Keep @kmd/language and the VS Code extension packaged assets in sync.');
  process.exitCode = 1;
} else {
  console.log('Language assets are in sync.');
}
