import { syncLanguageAssets } from './language-assets.mjs';

try {
  const results = await syncLanguageAssets();
  for (const result of results) {
    if (result.action === 'copied') {
      console.log(
        `Synced language asset: ${result.sourceDisplayPath} -> ${result.packagedCopyDisplayPath}`,
      );
    }
  }

  if (results.every(result => result.action === 'unchanged')) {
    console.log('Language assets are already in sync.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
