import type * as monaco from 'monaco-editor';
import defaultThemeJson from '../themes/kmd-dark.theme.json';

export const DEFAULT_THEME_NAME = 'kmd-theme';

export interface IVsCodeTokenColorSettings {
  foreground?: string;
  background?: string;
  fontStyle?: string;
}

export interface IVsCodeTokenColor {
  name?: string;
  scope?: string | string[];
  settings: IVsCodeTokenColorSettings;
}

export interface IVsCodeTheme {
  name?: string;
  type?: 'dark' | 'light' | 'hc' | 'hcLight';
  tokenColors?: IVsCodeTokenColor[];
  colors?: Record<string, string>;
}

export interface MonacoThemeApi {
  defineTheme(name: string, data: monaco.editor.IStandaloneThemeData): void;
  setTheme(name: string): void;
}

export interface CssVariableTarget {
  setProperty(name: string, value: string): void;
}

export interface ThemeLoadResult {
  themeName: string;
  usedFallback: boolean;
  error?: string;
}

export const WORKBENCH_COLOR_TO_CSS_VARIABLE = {
  'editor.background': '--bg-editor',
  'editor.foreground': '--text-main',
  'sideBar.background': '--bg-sidebar',
  'sideBar.foreground': '--text-sidebar',
  'titleBar.activeBackground': '--bg-header',
  'titleBar.activeForeground': '--text-header',
  'statusBar.background': '--bg-status-bar',
  'statusBar.foreground': '--text-status-bar',
  'input.background': '--bg-input',
  'input.foreground': '--text-input',
  'input.border': '--border-light',
  'list.activeSelectionBackground': '--bg-active',
  'list.hoverBackground': '--bg-hover',
  'panel.border': '--border-main',
  'editorGroup.border': '--border-dark',
  'focusBorder': '--focus-border',
  'activityBar.background': '--accent-secondary',
  'activityBar.foreground': '--accent-primary',
  'errorForeground': '--accent-error',
  'descriptionForeground': '--text-dim',
} as const;

const defaultTheme = defaultThemeJson as IVsCodeTheme;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOptionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${path} must be a string.`);
  }
}

export function parseVsCodeTheme(input: unknown): IVsCodeTheme {
  const parsed: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  if (!isRecord(parsed)) {
    throw new Error('Theme must be a JSON object.');
  }
  if (parsed.include !== undefined) {
    throw new Error('theme.include is not supported; provide a fully expanded theme JSON file.');
  }
  assertOptionalString(parsed.name, 'theme.name');
  if (parsed.type !== undefined &&
      !['dark', 'light', 'hc', 'hcLight'].includes(String(parsed.type))) {
    throw new Error('theme.type must be dark, light, hc, or hcLight.');
  }
  if (parsed.tokenColors !== undefined && !Array.isArray(parsed.tokenColors)) {
    throw new Error('theme.tokenColors must be an array.');
  }
  if (parsed.colors !== undefined && !isRecord(parsed.colors)) {
    throw new Error('theme.colors must be an object.');
  }

  for (const [index, tokenColor] of (parsed.tokenColors ?? []).entries()) {
    if (!isRecord(tokenColor) || !isRecord(tokenColor.settings)) {
      throw new Error(`theme.tokenColors[${index}].settings must be an object.`);
    }
    const { scope, settings } = tokenColor;
    if (scope !== undefined && typeof scope !== 'string' &&
        !(Array.isArray(scope) && scope.every(item => typeof item === 'string'))) {
      throw new Error(`theme.tokenColors[${index}].scope must be a string or string array.`);
    }
    assertOptionalString(settings.foreground, `theme.tokenColors[${index}].settings.foreground`);
    assertOptionalString(settings.background, `theme.tokenColors[${index}].settings.background`);
    assertOptionalString(settings.fontStyle, `theme.tokenColors[${index}].settings.fontStyle`);
  }

  for (const [key, value] of Object.entries(parsed.colors ?? {})) {
    if (typeof value !== 'string') throw new Error(`theme.colors.${key} must be a string.`);
  }
  return parsed as unknown as IVsCodeTheme;
}

function normalizeScopeSelector(selector: string): string | null {
  const positiveParts = selector
    .trim()
    .replace(/^[LR]:/, '')
    .split(/\s+/)
    .filter(part => part.length > 0 && !part.startsWith('-'));
  return positiveParts.length > 0 ? positiveParts[positiveParts.length - 1]! : null;
}

export function expandTokenScopes(scope: string | string[] | undefined): string[] {
  if (scope === undefined) return [''];
  const values = Array.isArray(scope) ? scope : [scope];
  return values.flatMap(value => value.split(','))
    .map(normalizeScopeSelector)
    .filter((value): value is string => value !== null);
}

function normalizeTokenColor(color: unknown): string | undefined {
  if (typeof color !== 'string') return undefined;
  const normalized = color.trim().replace(/^#/, '');
  return /^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(normalized)
    ? normalized.toUpperCase()
    : undefined;
}

function normalizeFontStyle(fontStyle: unknown): string | undefined {
  if (typeof fontStyle !== 'string') return undefined;
  const supported = new Set(['italic', 'bold', 'underline', 'strikethrough']);
  return fontStyle.split(/\s+/).filter(style => supported.has(style)).join(' ');
}

function resolveBase(type: IVsCodeTheme['type']): monaco.editor.BuiltinTheme {
  if (type === 'light') return 'vs';
  if (type === 'hc') return 'hc-black';
  if (type === 'hcLight') return 'hc-light';
  return 'vs-dark';
}

export function toMonacoThemeData(theme: IVsCodeTheme): monaco.editor.IStandaloneThemeData {
  const rules: monaco.editor.ITokenThemeRule[] = [];
  for (const tokenColor of theme.tokenColors ?? []) {
    const foreground = normalizeTokenColor(tokenColor.settings.foreground);
    const background = normalizeTokenColor(tokenColor.settings.background);
    const fontStyle = normalizeFontStyle(tokenColor.settings.fontStyle);
    for (const token of expandTokenScopes(tokenColor.scope)) {
      rules.push({ token, foreground, background, fontStyle });
    }
  }

  const colors: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme.colors ?? {})) {
    if (typeof value === 'string' && value.trim().length > 0) colors[key] = value.trim();
  }

  return {
    base: resolveBase(theme.type),
    inherit: true,
    rules,
    colors,
  };
}

export function mapWorkbenchColors(
  colors: Record<string, string> = {},
  fallbackColors: Record<string, string> = {},
): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [workbenchColor, cssVariable] of Object.entries(WORKBENCH_COLOR_TO_CSS_VARIABLE)) {
    const value = colors[workbenchColor] ?? fallbackColors[workbenchColor];
    if (typeof value === 'string' && value.trim().length > 0) variables[cssVariable] = value.trim();
  }
  return variables;
}

export class ThemeService {
  private monacoApi: MonacoThemeApi | null = null;
  private currentTheme = defaultTheme;
  private currentThemeName = DEFAULT_THEME_NAME;
  private readonly cssTarget: () => CssVariableTarget | null;

  constructor(
    cssTarget: () => CssVariableTarget | null = () =>
      typeof document === 'undefined' ? null : document.documentElement.style,
  ) {
    this.cssTarget = cssTarget;
  }

  get activeThemeName(): string {
    return this.currentThemeName;
  }

  attachMonaco(api: MonacoThemeApi): void {
    this.monacoApi = api;
    this.apply(this.currentTheme, this.currentThemeName);
  }

  load(input: unknown, themeName = 'kmd-project-theme'): ThemeLoadResult {
    try {
      const theme = parseVsCodeTheme(input);
      this.apply(theme, themeName);
      return { themeName, usedFallback: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.apply(defaultTheme, DEFAULT_THEME_NAME);
      return { themeName: DEFAULT_THEME_NAME, usedFallback: true, error: message };
    }
  }

  loadDefault(): ThemeLoadResult {
    this.apply(defaultTheme, DEFAULT_THEME_NAME);
    return { themeName: DEFAULT_THEME_NAME, usedFallback: false };
  }

  private apply(theme: IVsCodeTheme, themeName: string): void {
    this.currentTheme = theme;
    this.currentThemeName = themeName;
    this.monacoApi?.defineTheme(themeName, toMonacoThemeData(theme));
    this.monacoApi?.setTheme(themeName);

    const target = this.cssTarget();
    if (!target) return;
    const variables = mapWorkbenchColors(theme.colors, defaultTheme.colors);
    for (const [name, value] of Object.entries(variables)) target.setProperty(name, value);
  }
}

export const themeService = new ThemeService();
