import { inspectLanguageAssets } from './language-assets.mjs';

const results = await inspectLanguageAssets();
const problems = results.filter(result => result.status !== 'synced');

for (const result of problems) {
  if (result.status === 'missing-source') {
    console.error(`Canonical language asset is missing: ${result.sourceDisplayPath}`);
  } else if (result.status === 'missing-packaged-copy') {
    console.error(`Packaged language asset is missing: ${result.packagedCopyDisplayPath}`);
  } else {
    console.error(
      `Language asset drift: ${result.sourceDisplayPath} != ${result.packagedCopyDisplayPath}`,
    );
  }
}

if (problems.length > 0) {
  console.error('Keep @kmd/language and the VS Code extension packaged assets in sync.');
  console.error('Run `pnpm language:sync`, review the copied assets, then rerun this check.');
  process.exitCode = 1;
} else {
  console.log('Language assets are in sync.');
}
