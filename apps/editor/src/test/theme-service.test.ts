import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_THEME_NAME,
  FALLBACK_WORKBENCH_COLORS,
  FALLBACK_ACCENT_TEXT_COLORS,
  ThemeService,
  expandTokenScopes,
  mapWorkbenchColors,
  parseVsCodeTheme,
  parseVsCodeThemeDocument,
  toMonacoThemeData,
  type CssVariableTarget,
  type MonacoThemeApi,
} from '../editor/ThemeService';
import { loadProjectTheme, parseEditorThemePath } from '../editor/projectThemeLoader';
import { readProjectTextFile } from '../services/fileSystem';

describe('VS Code theme conversion', () => {
  it('accepts JSONC comments and trailing commas', () => {
    const theme = parseVsCodeTheme(`{
      // VS Code themes commonly use JSONC.
      "type": "dark",
      "colors": {
        "editor.background": "#101010",
      },
      "tokenColors": [],
    }`);

    expect(theme).toMatchObject({
      type: 'dark',
      colors: { 'editor.background': '#101010' },
      tokenColors: [],
    });
  });

  it('keeps include and null color deletion markers in the loader document boundary', () => {
    expect(parseVsCodeThemeDocument(`{
      "include": "./base.json",
      "colors": { "editor.background": null },
    }`)).toMatchObject({
      include: './base.json',
      colors: { 'editor.background': null },
    });
    expect(() => parseVsCodeTheme({ colors: null })).toThrow('theme.colors must be an object');
    expect(() => parseVsCodeThemeDocument({ include: '   ' })).toThrow(
      'theme.include must be a non-empty string',
    );
  });

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
      '--accent-background': '#ff00ff',
    });
  });

  it('keeps every per-type shell fallback palette complete', () => {
    const expectedKeys = Object.keys(FALLBACK_WORKBENCH_COLORS.dark).sort();
    for (const palette of Object.values(FALLBACK_WORKBENCH_COLORS)) {
      expect(Object.keys(palette).sort()).toEqual(expectedKeys);
      expect(Object.values(palette).every(color => /^#[0-9A-F]{6}$/.test(color))).toBe(true);
    }
    expect(Object.keys(FALLBACK_ACCENT_TEXT_COLORS).sort()).toEqual(
      Object.keys(FALLBACK_WORKBENCH_COLORS).sort(),
    );
  });

  it('keeps mounted editor, splitter, and accent controls on theme variables', () => {
    const files = [
      ['views/EditorView.vue', ['background: var(--bg-editor)']],
      ['components/DockSystem/SplitterBar.vue', [
        'background: var(--border-dark)',
        'background: var(--accent-background)',
        'var(--accent-foreground)',
      ]],
      ['components/Playback/TimeLordBar.vue', [
        'background: var(--accent-background)',
        'color: var(--accent-foreground)',
        'color: var(--accent-text)',
      ]],
      ['components/LayoutManager.vue', [
        'background: var(--accent-background)',
        'color: var(--accent-foreground)',
        'color: var(--accent-text)',
      ]],
      ['views/ExplorerView.vue', [
        'background: var(--accent-background)',
        'color: var(--accent-foreground)',
        'color: var(--accent-text)',
      ]],
    ] as const;

    for (const [relativePath, expectedVariables] of files) {
      const source = readFileSync(join(import.meta.dirname, '..', relativePath), 'utf8');
      for (const expected of expectedVariables) expect(source).toContain(expected);
    }

    const splitter = readFileSync(join(
      import.meta.dirname,
      '..',
      'components',
      'DockSystem',
      'SplitterBar.vue',
    ), 'utf8');
    expect(splitter).not.toMatch(/background:\s*#(?:111|007acc)/i);
    expect(splitter).not.toContain('dashed #fff');

    const editorView = readFileSync(join(import.meta.dirname, '..', 'views', 'EditorView.vue'), 'utf8');
    expect(editorView).not.toMatch(/background:\s*#1e1e1e/i);
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
      getPropertyValue: name => variables.get(name) ?? '',
      removeProperty: name => variables.delete(name) ? undefined : undefined,
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

function createCssTarget(initial: Record<string, string> = {}): {
  target: CssVariableTarget;
  variables: Map<string, string>;
  failSet: (name: string, value: string) => boolean;
} {
  const variables = new Map(Object.entries(initial));
  const state = {
    failSet: (_name: string, _value: string) => false,
  };
  return {
    target: {
      getPropertyValue: name => variables.get(name) ?? '',
      removeProperty: name => {
        const previous = variables.get(name) ?? '';
        variables.delete(name);
        return previous;
      },
      setProperty: (name, value) => {
        if (state.failSet(name, value)) throw new Error(`CSS write failed: ${name}`);
        variables.set(name, value);
      },
    },
    variables,
    get failSet() {
      return state.failSet;
    },
    set failSet(value) {
      state.failSet = value;
    },
  };
}

describe('ThemeService application transaction', () => {
  it('does not retain a Monaco API whose initial theme activation fails', () => {
    const css = createCssTarget();
    const service = new ThemeService(() => css.target);
    let calls = 0;
    const brokenApi: MonacoThemeApi = {
      defineTheme: () => {
        calls += 1;
      },
      setTheme: () => {
        calls += 1;
        throw new Error('initial activation rejected');
      },
    };

    expect(() => service.attachMonaco(brokenApi)).toThrow('initial activation rejected');
    const callsAfterRejectedAttach = calls;

    expect(service.load({ colors: { 'editor.background': '#314159' } }, 'css-only-theme'))
      .toMatchObject({ themeName: 'css-only-theme', usedFallback: false });
    expect(calls).toBe(callsAfterRejectedAttach);
    expect(service.activeThemeName).toBe('css-only-theme');
    expect(css.variables.get('--bg-editor')).toBe('#314159');
  });

  it('rolls back a partial CSS write before applying the default fallback', () => {
    const css = createCssTarget();
    const activations: string[] = [];
    const service = new ThemeService(() => css.target);
    service.attachMonaco({
      defineTheme: () => undefined,
      setTheme: name => activations.push(name),
    });
    service.load({
      colors: {
        'editor.background': '#121212',
        'sideBar.background': '#232323',
      },
    }, 'stable-theme');

    css.failSet = (name, value) => name === '--bg-sidebar' && value === '#BADBAD';
    const result = service.load({
      colors: {
        'editor.background': '#ABCDEF',
        'sideBar.background': '#BADBAD',
      },
    }, 'partial-write-theme');

    expect(result).toMatchObject({
      themeName: DEFAULT_THEME_NAME,
      usedFallback: true,
      error: expect.stringContaining('CSS write failed'),
    });
    expect(service.activeThemeName).toBe(DEFAULT_THEME_NAME);
    expect(activations.at(-1)).toBe(DEFAULT_THEME_NAME);
    expect(css.variables.get('--bg-editor')).toBe('#1E1E1E');
    expect(css.variables.get('--bg-sidebar')).toBe('#252526');
  });

  it('preserves the old visible state and reports both failures when fallback application fails', () => {
    const css = createCssTarget();
    let rejectDefaultDefinition = false;
    const activations: string[] = [];
    const service = new ThemeService(() => css.target);
    const monacoApi: MonacoThemeApi = {
      defineTheme: name => {
        if (rejectDefaultDefinition && name === DEFAULT_THEME_NAME) {
          throw new Error('default definition rejected');
        }
      },
      setTheme: name => activations.push(name),
    };
    service.attachMonaco(monacoApi);
    service.load({ colors: { 'editor.background': '#123456' } }, 'stable-theme');
    const previousVariables = new Map(css.variables);
    rejectDefaultDefinition = true;

    expect(() => service.load('{ broken JSONC', 'broken-theme')).toThrowError(
      /and apply fallback.*default definition rejected/,
    );
    expect(service.activeThemeName).toBe('stable-theme');
    expect(css.variables).toEqual(previousVariables);
    expect(activations.at(-1)).toBe('stable-theme');
  });

  it('does not publish current state when Monaco activation rejects a direct default load', () => {
    const css = createCssTarget();
    let rejectedName: string | null = null;
    const activations: string[] = [];
    const service = new ThemeService(() => css.target);
    service.attachMonaco({
      defineTheme: () => undefined,
      setTheme: name => {
        if (name === rejectedName) throw new Error(`activation rejected: ${name}`);
        activations.push(name);
      },
    });
    service.load({ colors: { 'editor.background': '#654321' } }, 'stable-theme');
    const previousVariables = new Map(css.variables);
    rejectedName = DEFAULT_THEME_NAME;

    expect(() => service.loadDefault()).toThrow('activation rejected');
    expect(service.activeThemeName).toBe('stable-theme');
    expect(css.variables).toEqual(previousVariables);
    expect(activations.at(-1)).toBe('stable-theme');
  });

  it('restores the previous definition before falling back after a same-name activation failure', () => {
    const css = createCssTarget();
    const definitions: Array<{ name: string; data: any }> = [];
    let failNextActivation = false;
    const service = new ThemeService(() => css.target);
    service.attachMonaco({
      defineTheme: (name, data) => definitions.push({ name, data }),
      setTheme: () => {
        if (failNextActivation) {
          failNextActivation = false;
          throw new Error('same-name activation rejected');
        }
      },
    });
    service.load({ colors: { 'editor.background': '#111111' } }, 'shared-theme');
    definitions.length = 0;
    failNextActivation = true;

    const result = service.load(
      { colors: { 'editor.background': '#222222' } },
      'shared-theme',
    );

    const sharedDefinitions = definitions.filter(({ name }) => name === 'shared-theme');
    expect(sharedDefinitions).toHaveLength(2);
    expect(sharedDefinitions[0]?.data.colors['editor.background']).toBe('#222222');
    expect(sharedDefinitions[1]?.data.colors['editor.background']).toBe('#111111');
    expect(result).toMatchObject({
      themeName: DEFAULT_THEME_NAME,
      usedFallback: true,
      error: expect.stringContaining('same-name activation rejected'),
    });
    expect(service.activeThemeName).toBe(DEFAULT_THEME_NAME);
  });
});

describe('project theme loading boundary', () => {
  it('reads the root-level editorTheme scalar and loads its JSON', async () => {
    expect(parseEditorThemePath('name: demo\neditorTheme: "./themes/dracula.json" # local')).toEqual({
      kind: 'valid',
      path: './themes/dracula.json',
    });

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
