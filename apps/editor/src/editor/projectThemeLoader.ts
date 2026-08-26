import {
  normalizeProjectRelativePath,
  readProjectTextFile,
  resolveProjectRelativePath,
} from '../services/fileSystem';
import {
  DEFAULT_THEME_NAME,
  parseVsCodeThemeDocument,
  themeService,
  type IVsCodeTheme,
  type IVsCodeThemeDocument,
  type ThemeLoadResult,
  type ThemeService,
} from './ThemeService';

export const MAX_THEME_INCLUDE_DEPTH = 16;

export interface ProjectThemeLoadResult extends ThemeLoadResult {
  source: string | null;
  preservedPreviousTheme?: boolean;
}

export type ProjectTextReader = (
  projectRoot: FileSystemDirectoryHandle,
  relativePath: string,
) => Promise<string | null>;

export type EditorThemePathResult =
  | { kind: 'absent' }
  | { kind: 'valid'; path: string }
  | { kind: 'invalid'; error: string };

export function parseEditorThemePath(projectYaml: string): EditorThemePathResult {
  for (const line of projectYaml.split(/\r?\n/)) {
    const match = /^editorTheme\s*:\s*(.*?)\s*$/.exec(line);
    if (!match) {
      if (/^editorTheme(?:\s|$)/.test(line)) {
        return {
          kind: 'invalid',
          error: 'Invalid project.yaml editorTheme: expected a colon followed by a project-relative path.',
        };
      }
      continue;
    }
    let value = match[1]?.trim() ?? '';
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0]!;
      const closingQuote = value.indexOf(quote, 1);
      if (closingQuote < 0 || value.slice(closingQuote + 1).trim().replace(/^#.*$/, '') !== '') {
        return {
          kind: 'invalid',
          error: 'Invalid project.yaml editorTheme: malformed quoted path.',
        };
      }
      value = value.slice(1, closingQuote).trim();
    } else {
      value = value.startsWith('#') ? '' : value.replace(/\s+#.*$/, '').trim();
      if (/^[\[\]{},]|^[|>][+-]?[1-9]?$/.test(value)) {
        return {
          kind: 'invalid',
          error: 'Invalid project.yaml editorTheme: expected a plain or quoted scalar path.',
        };
      }
    }
    if (!value) {
      return {
        kind: 'invalid',
        error: 'Invalid project.yaml editorTheme: path must not be empty.',
      };
    }
    return { kind: 'valid', path: value };
  }
  return { kind: 'absent' };
}

function themeNameFromPath(path: string): string {
  const slug = path
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return `kmd-project-theme-${slug || 'custom'}`;
}

export function mergeVsCodeThemeDocuments(
  base: IVsCodeTheme,
  child: IVsCodeThemeDocument,
): IVsCodeTheme {
  const merged: IVsCodeTheme = {};
  const name = child.name ?? base.name;
  const type = child.type ?? base.type;
  if (name !== undefined) merged.name = name;
  if (type !== undefined) merged.type = type;

  if (base.tokenColors !== undefined || child.tokenColors !== undefined) {
    merged.tokenColors = [
      ...(base.tokenColors ?? []),
      ...(child.tokenColors ?? []),
    ];
  }

  if (base.colors !== undefined || child.colors !== undefined) {
    const colors = { ...base.colors };
    for (const [key, value] of Object.entries(child.colors ?? {})) {
      if (value === null) delete colors[key];
      else colors[key] = value;
    }
    merged.colors = colors;
  }
  return merged;
}

async function loadThemeTree(
  projectRoot: FileSystemDirectoryHandle,
  source: string,
  readText: ProjectTextReader,
  includeStack: readonly string[],
): Promise<IVsCodeTheme> {
  const canonicalSource = normalizeProjectRelativePath(source);
  const chain = [...includeStack, canonicalSource];
  if (includeStack.includes(canonicalSource)) {
    throw new Error(`Theme include cycle detected: ${chain.join(' -> ')}`);
  }
  if (chain.length > MAX_THEME_INCLUDE_DEPTH) {
    throw new Error(
      `Theme include depth exceeds ${MAX_THEME_INCLUDE_DEPTH}: ${chain.join(' -> ')}`,
    );
  }

  const input = await readText(projectRoot, canonicalSource);
  if (input === null) {
    throw new Error(`Theme file was not found in include chain: ${chain.join(' -> ')}`);
  }
  const document = parseVsCodeThemeDocument(input);

  let base: IVsCodeTheme = {};
  if (document.include !== undefined) {
    const includeSource = resolveProjectRelativePath(canonicalSource, document.include);
    base = await loadThemeTree(
      projectRoot,
      includeSource,
      readText,
      chain,
    );
  }
  return mergeVsCodeThemeDocuments(base, document);
}

export async function loadProjectTheme(
  projectRoot: FileSystemDirectoryHandle,
  service: ThemeService = themeService,
  readText: ProjectTextReader = readProjectTextFile,
): Promise<ProjectThemeLoadResult> {
  try {
    const projectYaml = await readText(projectRoot, 'project.yaml');
    const configuredTheme = projectYaml
      ? parseEditorThemePath(projectYaml)
      : { kind: 'absent' as const };
    if (configuredTheme.kind === 'invalid') {
      return {
        themeName: service.activeThemeName,
        usedFallback: false,
        source: null,
        preservedPreviousTheme: true,
        error: configuredTheme.error,
      };
    }
    const configuredPath = configuredTheme.kind === 'valid' ? configuredTheme.path : null;
    const source = configuredPath ?? 'theme.json';
    let canonicalSource: string;
    try {
      canonicalSource = normalizeProjectRelativePath(source);
    } catch (error) {
      if (configuredPath !== null) {
        return {
          themeName: service.activeThemeName,
          usedFallback: false,
          source: null,
          preservedPreviousTheme: true,
          error: `Invalid project.yaml editorTheme path: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
      throw error;
    }

    // Preserve the configured outer path for reporting, while every recursive
    // include is compared and resolved through its canonical project path.
    const sourceInput = await readText(projectRoot, source);
    if (sourceInput === null) {
      const fallback = service.loadDefault();
      return {
        ...fallback,
        source: null,
        usedFallback: configuredPath !== null,
        error: configuredPath
          ? `Configured editor theme was not found: ${configuredPath}`
          : undefined,
      };
    }

    const theme = await loadThemeTree(
      projectRoot,
      canonicalSource,
      async (root, path) => path === canonicalSource ? sourceInput : readText(root, path),
      [],
    );
    const result = service.load(theme, themeNameFromPath(source));
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
