import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_THEME_NAME,
  ThemeService,
  expandTokenScopes,
  mapWorkbenchColors,
  parseVsCodeTheme,
  toMonacoThemeData,
  type MonacoThemeApi,
} from '../editor/ThemeService';
import { loadProjectTheme, parseEditorThemePath } from '../editor/projectThemeLoader';
import { readProjectTextFile } from '../services/fileSystem';

describe('VS Code theme conversion', () => {
  it('projects tokenColors selectors and workbench colors into Monaco data', () => {
    const theme = parseVsCodeTheme({
      type: 'light',
      tokenColors: [
        {
          scope: 'L:source.kmd meta.command entity.name.function.kmd, keyword.operator',
          settings: {
            foreground: '#aabbcc',
            background: '#11223344',
            fontStyle: 'bold unsupported italic',
          },
        },
        { settings: { foreground: '#fff', fontStyle: '' } },
      ],
      colors: {
        'editor.background': '#fafafa',
        'sideBar.background': '#eeeeee',
      },
    });

    expect(expandTokenScopes(theme.tokenColors?.[0]?.scope)).toEqual([
      'entity.name.function.kmd',
      'keyword.operator',
    ]);
    expect(toMonacoThemeData(theme)).toEqual({
      base: 'vs',
      inherit: true,
      rules: [
        {
          token: 'entity.name.function.kmd',
          foreground: 'AABBCC',
          background: '11223344',
          fontStyle: 'bold italic',
        },
        {
          token: 'keyword.operator',
          foreground: 'AABBCC',
          background: '11223344',
          fontStyle: 'bold italic',
        },
        { token: '', foreground: undefined, background: undefined, fontStyle: '' },
      ],
      colors: {
        'editor.background': '#fafafa',
        'sideBar.background': '#eeeeee',
      },
    });
  });

  it('maps shell variables with per-key default fallbacks', () => {
    expect(mapWorkbenchColors(
      {
        'editor.background': '#101010',
        'activityBar.background': '#ff00ff',
      },
      {
        'editor.background': '#000000',
        'sideBar.background': '#202020',
      },
    )).toMatchObject({
      '--bg-editor': '#101010',
      '--bg-sidebar': '#202020',
      '--accent-secondary': '#ff00ff',
    });
  });

  it('keeps every bundled KMD token selector aligned with a grammar scope prefix', () => {
    const theme = JSON.parse(readFileSync(
      join(import.meta.dirname, '..', 'themes', 'kmd-dark.theme.json'),
      'utf8',
    ));
    const grammar = JSON.parse(readFileSync(
      join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        '..',
        'packages',
        'language',
        'syntaxes',
        'kmd.tmLanguage.json',
      ),
      'utf8',
    ));
    const grammarScopes = Array.from(
      JSON.stringify(grammar).matchAll(/\"name\"\s*:\s*\"([^\"]+)\"/g),
      (match) => match[1]!,
    );
    const selectors = theme.tokenColors.flatMap((rule: { scope?: string | string[] }) => (
      Array.isArray(rule.scope) ? rule.scope : [rule.scope]
    )).filter((scope: unknown): scope is string => typeof scope === 'string');

    for (const selector of selectors) {
      expect(
        grammarScopes.some((scope: string) => scope === selector || scope.startsWith(`${selector}.`)),
        `${selector} does not match a KMD TextMate grammar scope`,
      ).toBe(true);
    }
  });
});

describe('ThemeService fallback', () => {
  it('defines and activates the bundled default after invalid JSON', () => {
    const definitions: Array<{ name: string; data: unknown }> = [];
    const activations: string[] = [];
    const variables = new Map<string, string>();
    const monacoApi: MonacoThemeApi = {
      defineTheme: (name, data) => definitions.push({ name, data }),
      setTheme: name => activations.push(name),
    };
    const service = new ThemeService(() => ({
      setProperty: (name, value) => variables.set(name, value),
    }));
    service.attachMonaco(monacoApi);
    definitions.length = 0;
    activations.length = 0;

    const result = service.load('{not valid JSON', 'broken-theme');

    expect(result.usedFallback).toBe(true);
    expect(result.themeName).toBe(DEFAULT_THEME_NAME);
    expect(result.error).toBeTruthy();
    expect(service.activeThemeName).toBe(DEFAULT_THEME_NAME);
    expect(definitions.at(-1)?.name).toBe(DEFAULT_THEME_NAME);
    expect(activations).toEqual([DEFAULT_THEME_NAME]);
    expect(variables.get('--bg-editor')).toBe('#1E1E1E');
    expect(variables.get('--bg-status-bar')).toBe('#007ACC');
  });

  it('rejects structurally invalid tokenColors instead of partially applying it', () => {
    const service = new ThemeService(() => null);
    const result = service.load({ tokenColors: [{ settings: 'invalid' }] });
    expect(result.usedFallback).toBe(true);
    expect(result.error).toContain('settings must be an object');
  });

  it('falls back for unresolved VS Code include inheritance', () => {
    const service = new ThemeService(() => null);
    const result = service.load({ include: './base-theme.json', colors: {} });
    expect(result.usedFallback).toBe(true);
    expect(result.error).toContain('theme.include is not supported');
    expect(service.activeThemeName).toBe(DEFAULT_THEME_NAME);
  });
});

describe('project theme loading boundary', () => {
  it('reads the root-level editorTheme scalar and loads its JSON', async () => {
    expect(parseEditorThemePath('name: demo\neditorTheme: "./themes/dracula.json" # local')).toBe(
      './themes/dracula.json',
    );

    const requested: string[] = [];
    const definedThemeNames: string[] = [];
    const service = new ThemeService(() => null);
    service.attachMonaco({
      defineTheme: (name) => {
        expect(name).toMatch(/^[a-z0-9-]+$/i);
        definedThemeNames.push(name);
      },
      setTheme: () => undefined,
    });
    const result = await loadProjectTheme(
      {} as FileSystemDirectoryHandle,
      service,
      async (_root, path) => {
        requested.push(path);
        if (path === 'project.yaml') return 'editorTheme: ./themes/dracula.json';
        return JSON.stringify({ type: 'dark', tokenColors: [], colors: {} });
      },
    );

    expect(requested).toEqual(['project.yaml', './themes/dracula.json']);
    expect(result).toMatchObject({
      source: './themes/dracula.json',
      usedFallback: false,
    });
    expect(service.activeThemeName).toContain('themes-dracula-json');
    expect(definedThemeNames.at(-1)).toBe('kmd-project-theme-themes-dracula-json');
  });

  it('falls back when a configured theme is missing', async () => {
    const service = new ThemeService(() => null);
    const result = await loadProjectTheme(
      {} as FileSystemDirectoryHandle,
      service,
      async (_root, path) => path === 'project.yaml' ? 'editorTheme: missing.json' : null,
    );

    expect(result).toEqual({
      themeName: DEFAULT_THEME_NAME,
      usedFallback: true,
      source: null,
      error: 'Configured editor theme was not found: missing.json',
    });
    expect(service.activeThemeName).toBe(DEFAULT_THEME_NAME);
  });

  it('rejects project-root traversal before touching the directory handle', async () => {
    await expect(readProjectTextFile(
      {} as FileSystemDirectoryHandle,
      '../outside.json',
    )).rejects.toThrow('escapes the project root');
  });

  it('resolves nested theme paths from the supplied project root', async () => {
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

    await expect(readProjectTextFile(projectRoot, './themes/dracula.json')).resolves.toBe(
      '{"type":"dark"}',
    );
    expect(requested).toEqual(['directory:themes', 'file:dracula.json']);
  });
});
