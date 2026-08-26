import { describe, expect, it } from 'vitest';
import {
  MAX_THEME_INCLUDE_DEPTH,
  loadProjectTheme,
  mergeVsCodeThemeDocuments,
  parseEditorThemePath,
  type ProjectTextReader,
} from '../editor/projectThemeLoader';
import {
  DEFAULT_THEME_NAME,
  FALLBACK_WORKBENCH_COLORS,
  FALLBACK_ACCENT_TEXT_COLORS,
  ThemeService,
  type IVsCodeTheme,
  type IVsCodeThemeDocument,
} from '../editor/ThemeService';
import {
  normalizeProjectRelativePath,
  readProjectTextFile,
  resolveProjectRelativePath,
} from '../services/fileSystem';

function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const SHELL_SURFACE_KEYS = [
  'editor.background',
  'sideBar.background',
  'titleBar.activeBackground',
  'list.activeSelectionBackground',
] as const;

function mapReader(
  files: Record<string, string>,
  requested: string[] = [],
): ProjectTextReader {
  return async (_root, path) => {
    requested.push(path);
    return files[path] ?? null;
  };
}

describe('project theme path boundary', () => {
  it('distinguishes an absent, valid, and malformed editorTheme field', () => {
    expect(parseEditorThemePath('name: demo')).toEqual({ kind: 'absent' });
    expect(parseEditorThemePath('editorTheme: ./themes/demo.json')).toEqual({
      kind: 'valid',
      path: './themes/demo.json',
    });
    expect(parseEditorThemePath('editorTheme: "./themes/demo.json')).toMatchObject({
      kind: 'invalid',
      error: expect.stringContaining('malformed quoted path'),
    });
    expect(parseEditorThemePath('editorTheme: # missing path')).toMatchObject({
      kind: 'invalid',
      error: expect.stringContaining('must not be empty'),
    });
    expect(parseEditorThemePath('editorTheme ./themes/demo.json')).toMatchObject({
      kind: 'invalid',
      error: expect.stringContaining('expected a colon'),
    });
    for (const value of ['[]', '{}', '[theme.json]', '{ path: theme.json }', '|', '|-', '>+']) {
      expect(parseEditorThemePath(`editorTheme: ${value}`)).toMatchObject({
        kind: 'invalid',
        error: expect.stringContaining('plain or quoted scalar'),
      });
    }
  });

  it('normalizes project-local parent segments relative to the containing theme', () => {
    expect(normalizeProjectRelativePath('./themes/night/../base.json')).toBe(
      'themes/base.json',
    );
    expect(resolveProjectRelativePath('themes/night/child.json', '../base.json')).toBe(
      'themes/base.json',
    );
    expect(resolveProjectRelativePath('theme.json', './base.json')).toBe('base.json');
  });

  it.each([
    '',
    '   ',
    '/absolute.json',
    'C:\\themes\\base.json',
    '\\\\server\\share\\base.json',
    'https://example.com/base.json',
    'file:base.json',
    '../outside.json',
    'themes/../../outside.json',
  ])('rejects a non-project path before file-system access: %j', path => {
    expect(() => normalizeProjectRelativePath(path)).toThrow();
  });

  it.each([
    '',
    '/absolute.json',
    'D:\\base.json',
    '\\\\server\\share\\base.json',
    'https://example.com/base.json',
  ])('rejects a non-relative include even from a nested theme: %j', include => {
    expect(() => resolveProjectRelativePath('themes/child.json', include)).toThrow(
      'must',
    );
  });

  it('reads a normalized in-project parent path through the root handle', async () => {
    const requested: string[] = [];
    const themeFile = {
      getFile: async () => ({ text: async () => '{"type":"dark"}' }),
    } as unknown as FileSystemFileHandle;
    const themesDirectory = {
      getFileHandle: async (name: string) => {
        requested.push(`file:${name}`);
        return themeFile;
      },
    } as unknown as FileSystemDirectoryHandle;
    const projectRoot = {
      getDirectoryHandle: async (name: string) => {
        requested.push(`directory:${name}`);
        return themesDirectory;
      },
    } as unknown as FileSystemDirectoryHandle;

    await expect(readProjectTextFile(
      projectRoot,
      'themes/variants/../base.json',
    )).resolves.toBe('{"type":"dark"}');
    expect(requested).toEqual(['directory:themes', 'file:base.json']);
  });
});

describe('project theme inheritance', () => {
  it('merges metadata, colors, deletions, and token rules base-first', () => {
    const base: IVsCodeTheme = {
      name: 'base',
      type: 'dark',
      colors: {
        'editor.background': '#111111',
        'editor.foreground': '#eeeeee',
      },
      tokenColors: [{ scope: 'base', settings: { foreground: '#111111' } }],
    };
    const child: IVsCodeThemeDocument = {
      include: './base.json',
      name: 'child',
      colors: {
        'editor.background': '#222222',
        'editor.foreground': null,
      },
      tokenColors: [{ scope: 'child', settings: { foreground: '#222222' } }],
    };

    expect(mergeVsCodeThemeDocuments(base, child)).toEqual({
      name: 'child',
      type: 'dark',
      colors: { 'editor.background': '#222222' },
      tokenColors: [
        { scope: 'base', settings: { foreground: '#111111' } },
        { scope: 'child', settings: { foreground: '#222222' } },
      ],
    });
  });

  it('loads JSONC includes relative to each file and reports the outer source', async () => {
    const requested: string[] = [];
    const definitions: Array<{ name: string; data: unknown }> = [];
    const service = new ThemeService(() => null);
    service.attachMonaco({
      defineTheme: (name, data) => definitions.push({ name, data }),
      setTheme: () => undefined,
    });

    const result = await loadProjectTheme(
      {} as FileSystemDirectoryHandle,
      service,
      mapReader({
        'project.yaml': 'editorTheme: ./themes/variants/child.json',
        './themes/variants/child.json': `{
          // Include is relative to this file, not project.yaml.
          "include": "../base.json",
          "name": "child",
          "colors": {
            "editor.background": "#222222",
            "editor.foreground": null,
          },
          "tokenColors": [
            { "scope": "child", "settings": { "foreground": "#222222" } },
          ],
        }`,
        'themes/base.json': `{
          "type": "dark",
          "colors": {
            "editor.background": "#111111",
            "editor.foreground": "#eeeeee",
          },
          "tokenColors": [
            { "scope": "base", "settings": { "foreground": "#111111" } },
          ],
        }`,
      }, requested),
    );

    expect(requested).toEqual([
      'project.yaml',
      './themes/variants/child.json',
      'themes/base.json',
    ]);
    expect(result).toMatchObject({
      source: './themes/variants/child.json',
      usedFallback: false,
    });
    expect(definitions.at(-1)).toMatchObject({
      name: 'kmd-project-theme-themes-variants-child-json',
      data: {
        base: 'vs-dark',
        colors: { 'editor.background': '#222222' },
        rules: [
          { token: 'base', foreground: '111111' },
          { token: 'child', foreground: '222222' },
        ],
      },
    });
  });

  it.each([
    ['dark', 'vs-dark', '#1E1E1E', '#CCCCCC', '#007ACC', '#FFFFFF'],
    ['light', 'vs', '#FFFFFF', '#333333', '#005FB8', '#FFFFFF'],
    ['hc', 'hc-black', '#000000', '#FFFFFF', '#000000', '#FFFFFF'],
    ['hcLight', 'hc-light', '#FFFFFF', '#292929', '#0066B8', '#FFFFFF'],
  ] as const)(
    'uses the readable %s fallback palette in Monaco and the shell after inheritance deletes colors',
    async (
      type,
      expectedBase,
      expectedBackground,
      expectedForeground,
      expectedAccentBackground,
      expectedAccentForeground,
    ) => {
      const variables = new Map<string, string>();
      const definitions: Array<{ name: string; data: any }> = [];
      const service = new ThemeService(() => ({
        getPropertyValue: name => variables.get(name) ?? '',
        removeProperty: name => variables.delete(name) ? undefined : undefined,
        setProperty: (name, value) => variables.set(name, value),
      }));
      service.attachMonaco({
        defineTheme: (name, data) => definitions.push({ name, data }),
        setTheme: () => undefined,
      });

      const result = await loadProjectTheme(
        {} as FileSystemDirectoryHandle,
        service,
        mapReader({
          'theme.json': JSON.stringify({
            include: './base.json',
            type,
            colors: {
              'editor.background': null,
              'editor.foreground': null,
              'activityBar.background': null,
              'activityBar.foreground': null,
            },
          }),
          'base.json': JSON.stringify({
            colors: {
              'editor.background': '#fefefe',
              'editor.foreground': '#010101',
              'activityBar.background': '#fefefe',
              'activityBar.foreground': '#010101',
            },
          }),
        }),
      );

      expect(result.usedFallback).toBe(false);
      expect(definitions.at(-1)?.data).toMatchObject({
        base: expectedBase,
        colors: {
          'editor.background': expectedBackground,
          'editor.foreground': expectedForeground,
          'activityBar.background': expectedAccentBackground,
          'activityBar.foreground': expectedAccentForeground,
        },
      });
      expect(variables.get('--bg-editor')).toBe(expectedBackground);
      expect(variables.get('--text-main')).toBe(expectedForeground);
      expect(variables.get('--accent-background')).toBe(expectedAccentBackground);
      expect(variables.get('--accent-foreground')).toBe(expectedAccentForeground);
      expect(variables.get('--accent-text')).toBe(FALLBACK_ACCENT_TEXT_COLORS[type]);
      expect(FALLBACK_WORKBENCH_COLORS[type]).toMatchObject({
        'editor.background': expectedBackground,
        'editor.foreground': expectedForeground,
      });
      expect(contrastRatio(expectedForeground, expectedBackground)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(expectedAccentForeground, expectedAccentBackground))
        .toBeGreaterThanOrEqual(4.5);
      for (const surface of SHELL_SURFACE_KEYS) {
        expect(contrastRatio(
          FALLBACK_ACCENT_TEXT_COLORS[type],
          FALLBACK_WORKBENCH_COLORS[type][surface],
        )).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('treats empty authored colors as missing before light theme materialization', async () => {
    const variables = new Map<string, string>();
    const definitions: any[] = [];
    const service = new ThemeService(() => ({
      getPropertyValue: name => variables.get(name) ?? '',
      removeProperty: name => variables.delete(name) ? undefined : undefined,
      setProperty: (name, value) => variables.set(name, value),
    }));
    service.attachMonaco({
      defineTheme: (_name, data) => definitions.push(data),
      setTheme: () => undefined,
    });

    await loadProjectTheme(
      {} as FileSystemDirectoryHandle,
      service,
      mapReader({
        'theme.json': JSON.stringify({
          type: 'light',
          colors: {
            'editor.background': '   ',
            'editor.foreground': '',
            'activityBar.background': '\t',
          },
        }),
      }),
    );

    expect(definitions.at(-1)?.colors).toMatchObject({
      'editor.background': '#FFFFFF',
      'editor.foreground': '#333333',
      'activityBar.background': '#005FB8',
    });
    expect(variables.get('--bg-editor')).toBe('#FFFFFF');
    expect(variables.get('--text-main')).toBe('#333333');
    expect(variables.get('--accent-background')).toBe('#005FB8');
  });

  it.each([
    'editorTheme: "./themes/demo.json',
    'editorTheme: # no path',
    'editorTheme: ../outside.json',
    'editorTheme: []',
    'editorTheme: {}',
    'editorTheme: |',
    'editorTheme: >-',
  ])('preserves the active theme and never probes theme.json for invalid config: %s', async projectYaml => {
    const requested: string[] = [];
    const activations: string[] = [];
    const service = new ThemeService(() => null);
    service.attachMonaco({
      defineTheme: () => undefined,
      setTheme: name => activations.push(name),
    });
    service.load({ colors: { 'editor.background': '#123456' } }, 'stable-theme');
    activations.length = 0;

    const result = await loadProjectTheme(
      {} as FileSystemDirectoryHandle,
      service,
      async (_root, path) => {
        requested.push(path);
        if (path === 'project.yaml') return projectYaml;
        if (path === 'theme.json') return '{"type":"light"}';
        return null;
      },
    );

    expect(result).toMatchObject({
      themeName: 'stable-theme',
      source: null,
      usedFallback: false,
      preservedPreviousTheme: true,
      error: expect.stringContaining('editorTheme'),
    });
    expect(requested).toEqual(['project.yaml']);
    expect(service.activeThemeName).toBe('stable-theme');
    expect(activations).toEqual([]);
  });

  it('falls back with a diagnostic when an included file loses read permission', async () => {
    const service = new ThemeService(() => null);
    service.load({ colors: { 'editor.background': '#123456' } }, 'stable-theme');

    const result = await loadProjectTheme(
      {} as FileSystemDirectoryHandle,
      service,
      async (_root, path) => {
        if (path === 'project.yaml') return null;
        if (path === 'theme.json') return '{"include":"./base.json"}';
        if (path === 'base.json') {
          throw new DOMException('Permission denied by user', 'NotAllowedError');
        }
        return null;
      },
    );

    expect(result).toMatchObject({
      themeName: DEFAULT_THEME_NAME,
      source: null,
      usedFallback: true,
      error: expect.stringContaining('Permission denied by user'),
    });
    expect(service.activeThemeName).toBe(DEFAULT_THEME_NAME);
  });

  it.each([
    {
      name: 'cycle',
      files: {
        'theme.json': '{"include":"./base.json"}',
        'base.json': '{"include":"./theme.json"}',
      },
      error: 'cycle',
    },
    {
      name: 'missing include',
      files: { 'theme.json': '{"include":"./missing.json"}' },
      error: 'not found',
    },
    {
      name: 'invalid included JSONC',
      files: {
        'theme.json': '{"include":"./base.json"}',
        'base.json': '{ invalid',
      },
      error: 'Invalid theme JSONC',
    },
    {
      name: 'project-root escape',
      files: { 'theme.json': '{"include":"../outside.json"}' },
      error: 'escapes the project root',
    },
  ])('atomically falls back for $name', async ({ name, files, error }) => {
    const activations: string[] = [];
    const service = new ThemeService(() => null);
    service.attachMonaco({
      defineTheme: () => undefined,
      setTheme: name => activations.push(name),
    });
    activations.length = 0;

    const result = await loadProjectTheme(
      {} as FileSystemDirectoryHandle,
      service,
      mapReader(files),
    );

    expect(result).toMatchObject({
      themeName: DEFAULT_THEME_NAME,
      source: null,
      usedFallback: true,
    });
    expect(result.error?.toLowerCase()).toContain(error.toLowerCase());
    if (name === 'missing include') {
      expect(result.error).toContain('theme.json -> missing.json');
    }
    expect(activations).toEqual([DEFAULT_THEME_NAME]);
  });

  it(`rejects include chains deeper than ${MAX_THEME_INCLUDE_DEPTH} files`, async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < MAX_THEME_INCLUDE_DEPTH; index += 1) {
      files[`theme-${index}.json`] = JSON.stringify({
        include: `./theme-${index + 1}.json`,
      });
    }
    files[`theme-${MAX_THEME_INCLUDE_DEPTH}.json`] = '{}';
    files['project.yaml'] = 'editorTheme: theme-0.json';

    const result = await loadProjectTheme(
      {} as FileSystemDirectoryHandle,
      new ThemeService(() => null),
      mapReader(files),
    );

    expect(result).toMatchObject({
      themeName: DEFAULT_THEME_NAME,
      source: null,
      usedFallback: true,
    });
    expect(result.error).toContain(`exceeds ${MAX_THEME_INCLUDE_DEPTH}`);
    expect(result.error).toContain('theme-0.json -> theme-1.json');
    expect(result.error).toContain(`theme-${MAX_THEME_INCLUDE_DEPTH}.json`);
  });

  it(`accepts include chains containing exactly ${MAX_THEME_INCLUDE_DEPTH} files`, async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < MAX_THEME_INCLUDE_DEPTH - 1; index += 1) {
      files[`theme-${index}.json`] = JSON.stringify({
        include: `./theme-${index + 1}.json`,
      });
    }
    files[`theme-${MAX_THEME_INCLUDE_DEPTH - 1}.json`] = JSON.stringify({
      type: 'light',
      colors: { 'editor.background': '#ffffff' },
    });
    files['project.yaml'] = 'editorTheme: theme-0.json';

    const result = await loadProjectTheme(
      {} as FileSystemDirectoryHandle,
      new ThemeService(() => null),
      mapReader(files),
    );

    expect(result).toMatchObject({
      source: 'theme-0.json',
      usedFallback: false,
    });
  });

  it('detects cycles after canonicalizing path aliases and reports the chain', async () => {
    const result = await loadProjectTheme(
      {} as FileSystemDirectoryHandle,
      new ThemeService(() => null),
      mapReader({
        'project.yaml': 'editorTheme: themes/root.json',
        'themes/root.json': '{"include":"./nested/../base.json"}',
        'themes/base.json': '{"include":"././root.json"}',
      }),
    );

    expect(result).toMatchObject({
      themeName: DEFAULT_THEME_NAME,
      source: null,
      usedFallback: true,
    });
    expect(result.error).toContain(
      'themes/root.json -> themes/base.json -> themes/root.json',
    );
  });
});
