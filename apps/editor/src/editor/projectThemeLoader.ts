import { readProjectTextFile } from '../services/fileSystem';
import { DEFAULT_THEME_NAME, themeService, type ThemeLoadResult, type ThemeService } from './ThemeService';

export interface ProjectThemeLoadResult extends ThemeLoadResult {
  source: string | null;
}

export type ProjectTextReader = (
  projectRoot: FileSystemDirectoryHandle,
  relativePath: string,
) => Promise<string | null>;

export function parseEditorThemePath(projectYaml: string): string | null {
  for (const line of projectYaml.split(/\r?\n/)) {
    const match = /^editorTheme\s*:\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[1]?.trim() ?? '';
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0]!;
      const closingQuote = value.indexOf(quote, 1);
      if (closingQuote < 0 || value.slice(closingQuote + 1).trim().replace(/^#.*$/, '') !== '') {
        return null;
      }
      value = value.slice(1, closingQuote).trim();
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    return value || null;
  }
  return null;
}

function themeNameFromPath(path: string): string {
  return `kmd-project-theme:${path.replace(/[^a-z0-9_-]+/gi, '-')}`;
}

export async function loadProjectTheme(
  projectRoot: FileSystemDirectoryHandle,
  service: ThemeService = themeService,
  readText: ProjectTextReader = readProjectTextFile,
): Promise<ProjectThemeLoadResult> {
  try {
    const projectYaml = await readText(projectRoot, 'project.yaml');
    const configuredPath = projectYaml ? parseEditorThemePath(projectYaml) : null;
    const source = configuredPath ?? 'theme.json';
    const themeJson = await readText(projectRoot, source);

    if (themeJson === null) {
      const fallback = service.loadDefault();
      return {
        ...fallback,
        source: null,
        usedFallback: configuredPath !== null,
        error: configuredPath ? `Configured editor theme was not found: ${configuredPath}` : undefined,
      };
    }

    const result = service.load(themeJson, themeNameFromPath(source));
    return {
      ...result,
      source: result.usedFallback ? null : source,
      themeName: result.usedFallback ? DEFAULT_THEME_NAME : result.themeName,
    };
  } catch (error) {
    const fallback = service.loadDefault();
    return {
      ...fallback,
      source: null,
      usedFallback: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
