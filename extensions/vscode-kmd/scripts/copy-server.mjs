import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(extensionRoot, '..', '..');
const source = resolve(repositoryRoot, 'packages', 'kmd-language-server', 'dist', 'server.js');
const destination = resolve(extensionRoot, 'dist', 'server.js');
const licenseSource = resolve(repositoryRoot, 'LICENSE');
const licenseDestination = resolve(extensionRoot, 'LICENSE');

await mkdir(dirname(destination), { recursive: true });
await Promise.all([
  copyFile(source, destination),
  copyFile(licenseSource, licenseDestination),
]);
