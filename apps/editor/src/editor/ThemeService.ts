import type * as monaco from 'monaco-editor';
import {
  parse as parseJsonc,
  printParseErrorCode,
  type ParseError,
} from 'jsonc-parser';
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

export interface IVsCodeThemeDocument extends Omit<IVsCodeTheme, 'colors'> {
  include?: string;
  colors?: Record<string, string | null>;
}

export interface MonacoThemeApi {
  defineTheme(name: string, data: monaco.editor.IStandaloneThemeData): void;
  setTheme(name: string): void;
}

export interface CssVariableTarget {
  getPropertyValue(name: string): string;
  removeProperty(name: string): string | void;
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
  'activityBar.background': '--accent-background',
  'activityBar.foreground': '--accent-foreground',
  'errorForeground': '--accent-error',
  'descriptionForeground': '--text-dim',
} as const;

const defaultTheme = defaultThemeJson as IVsCodeTheme;

type ConcreteThemeType = NonNullable<IVsCodeTheme['type']>;
type WorkbenchColor = keyof typeof WORKBENCH_COLOR_TO_CSS_VARIABLE;

/**
 * Complete KMD shell palettes for every Monaco base theme.
 *
 * VS Code resolves missing workbench colors against the selected base theme,
 * but Monaco does not expose that resolved palette to the surrounding shell.
 * Keep these values complete and explicit so Monaco's materialized colors and
 * the CSS-variable projection always use the same type-appropriate fallback.
 */
export const FALLBACK_WORKBENCH_COLORS = {
  dark: {
    'editor.background': '#1E1E1E',
    'editor.foreground': '#CCCCCC',
    'sideBar.background': '#252526',
    'sideBar.foreground': '#CCCCCC',
    'titleBar.activeBackground': '#2D2D2D',
    'titleBar.activeForeground': '#FFFFFF',
    'statusBar.background': '#007ACC',
    'statusBar.foreground': '#FFFFFF',
    'input.background': '#3C3C3C',
    'input.foreground': '#FFFFFF',
    'input.border': '#444444',
    'list.activeSelectionBackground': '#37373D',
    'list.hoverBackground': '#3E3E3E',
    'panel.border': '#333333',
    'editorGroup.border': '#111111',
    'focusBorder': '#007ACC',
    'activityBar.background': '#007ACC',
    'activityBar.foreground': '#FFFFFF',
    'errorForeground': '#F44747',
    'descriptionForeground': '#888888',
  },
  light: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#333333',
    'sideBar.background': '#F3F3F3',
    'sideBar.foreground': '#333333',
    'titleBar.activeBackground': '#DDDDDD',
    'titleBar.activeForeground': '#333333',
    'statusBar.background': '#005FB8',
    'statusBar.foreground': '#FFFFFF',
    'input.background': '#FFFFFF',
    'input.foreground': '#333333',
    'input.border': '#CECECE',
    'list.activeSelectionBackground': '#E4E6F1',
    'list.hoverBackground': '#E8E8E8',
    'panel.border': '#D4D4D4',
    'editorGroup.border': '#E7E7E7',
    'focusBorder': '#005FB8',
    'activityBar.background': '#005FB8',
    'activityBar.foreground': '#FFFFFF',
    'errorForeground': '#B5200D',
    'descriptionForeground': '#616161',
  },
  hc: {
    'editor.background': '#000000',
    'editor.foreground': '#FFFFFF',
    'sideBar.background': '#000000',
    'sideBar.foreground': '#FFFFFF',
    'titleBar.activeBackground': '#000000',
    'titleBar.activeForeground': '#FFFFFF',
    'statusBar.background': '#000000',
    'statusBar.foreground': '#FFFFFF',
    'input.background': '#000000',
    'input.foreground': '#FFFFFF',
    'input.border': '#FFFFFF',
    'list.activeSelectionBackground': '#0E639C',
    'list.hoverBackground': '#2A2A2A',
    'panel.border': '#FFFFFF',
    'editorGroup.border': '#FFFFFF',
    'focusBorder': '#F38518',
    'activityBar.background': '#000000',
    'activityBar.foreground': '#FFFFFF',
    'errorForeground': '#F48771',
    'descriptionForeground': '#FFFFFF',
  },
  hcLight: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#292929',
    'sideBar.background': '#FFFFFF',
    'sideBar.foreground': '#292929',
    'titleBar.activeBackground': '#FFFFFF',
    'titleBar.activeForeground': '#292929',
    'statusBar.background': '#FFFFFF',
    'statusBar.foreground': '#292929',
    'input.background': '#FFFFFF',
    'input.foreground': '#292929',
    'input.border': '#292929',
    'list.activeSelectionBackground': '#CFE8FC',
    'list.hoverBackground': '#E8E8E8',
    'panel.border': '#292929',
    'editorGroup.border': '#292929',
    'focusBorder': '#0066B8',
    'activityBar.background': '#0066B8',
    'activityBar.foreground': '#FFFFFF',
    'errorForeground': '#B5200D',
    'descriptionForeground': '#4A4A4A',
  },
} as const satisfies Record<
  ConcreteThemeType,
  Record<WorkbenchColor, string>
>;

/** Accent text shown directly on editor/shell surfaces, not on accent buttons. */
export const FALLBACK_ACCENT_TEXT_COLORS = {
  dark: '#4FC08D',
  light: '#005A9E',
  hc: '#FFFF00',
  hcLight: '#005A9E',
} as const satisfies Record<ConcreteThemeType, string>;

const ACCENT_TEXT_CSS_VARIABLE = '--accent-text';

const MANAGED_THEME_CSS_VARIABLES = [
  ...Object.values(WORKBENCH_COLOR_TO_CSS_VARIABLE),
  ACCENT_TEXT_CSS_VARIABLE,
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOptionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${path} must be a string.`);
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseJsoncDocument(input: string): unknown {
  const errors: ParseError[] = [];
  const parsed: unknown = parseJsonc(input, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  const firstError = errors[0];
  if (firstError) {
    throw new Error(
      `Invalid theme JSONC at offset ${firstError.offset}: ${printParseErrorCode(firstError.error)}.`,
    );
  }
  return parsed;
}

export function parseVsCodeThemeDocument(input: unknown): IVsCodeThemeDocument {
  const parsed: unknown = typeof input === 'string' ? parseJsoncDocument(input) : input;
  if (!isRecord(parsed)) {
    throw new Error('Theme must be a JSON object.');
  }
  assertOptionalString(parsed.include, 'theme.include');
  if (typeof parsed.include === 'string' && parsed.include.trim().length === 0) {
    throw new Error('theme.include must be a non-empty string.');
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
    if (value !== null && typeof value !== 'string') {
      throw new Error(`theme.colors.${key} must be a string or null.`);
    }
  }
  return parsed as unknown as IVsCodeThemeDocument;
}

export function parseVsCodeTheme(input: unknown): IVsCodeTheme {
  const document = parseVsCodeThemeDocument(input);
  if (document.include !== undefined) {
    throw new Error('theme.include is not supported without a theme file loader.');
  }

  const { include: _include, colors: documentColors, ...theme } = document;
  const colors = documentColors === undefined
    ? undefined
    : Object.fromEntries(
      Object.entries(documentColors).filter((entry): entry is [string, string] => entry[1] !== null),
    );
  return { ...theme, colors };
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

function materializeAppliedTheme(theme: IVsCodeTheme): IVsCodeTheme {
  const type = theme.type ?? 'dark';
  const authoredColors = Object.fromEntries(
    Object.entries(theme.colors ?? {}).filter(([, value]) => value.trim().length > 0),
  );
  return {
    ...theme,
    colors: { ...FALLBACK_WORKBENCH_COLORS[type], ...authoredColors },
  };
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
    this.apply(this.currentTheme, this.currentThemeName, api);
    this.monacoApi = api;
  }

  load(input: unknown, themeName = 'kmd-project-theme'): ThemeLoadResult {
    try {
      const theme = parseVsCodeTheme(input);
      this.apply(theme, themeName);
      return { themeName, usedFallback: false };
    } catch (error) {
      const message = describeError(error);
      try {
        this.apply(defaultTheme, DEFAULT_THEME_NAME);
      } catch (fallbackError) {
        throw new Error(
          `Failed to load theme "${themeName}" (${message}) and apply fallback ` +
            `"${DEFAULT_THEME_NAME}" (${describeError(fallbackError)}).`,
        );
      }
      return { themeName: DEFAULT_THEME_NAME, usedFallback: true, error: message };
    }
  }

  loadDefault(): ThemeLoadResult {
    this.apply(defaultTheme, DEFAULT_THEME_NAME);
    return { themeName: DEFAULT_THEME_NAME, usedFallback: false };
  }

  private apply(
    theme: IVsCodeTheme,
    themeName: string,
    monacoApi: MonacoThemeApi | null = this.monacoApi,
  ): void {
    // Missing colors (including values removed with `null` during include
    // merging) use the same KMD fallback in Monaco and the surrounding shell.
    // Keeping the materialized palette local to apply() preserves the authored
    // theme for rollback while preventing the two visible layers from diverging.
    const appliedTheme = materializeAppliedTheme(theme);
    const monacoTheme = toMonacoThemeData(appliedTheme);
    const variables = mapWorkbenchColors(appliedTheme.colors);
    variables[ACCENT_TEXT_CSS_VARIABLE] = FALLBACK_ACCENT_TEXT_COLORS[theme.type ?? 'dark'];
    const target = this.cssTarget();
    const previousTheme = this.currentTheme;
    const previousThemeName = this.currentThemeName;
    const previousVariables = target
      ? new Map(
        MANAGED_THEME_CSS_VARIABLES.map(name => [
          name,
          target.getPropertyValue(name),
        ]),
      )
      : null;

    try {
      monacoApi?.defineTheme(themeName, monacoTheme);
      if (target) {
        for (const name of MANAGED_THEME_CSS_VARIABLES) {
          const value = variables[name];
          if (value === undefined) target.removeProperty(name);
          else target.setProperty(name, value);
        }
      }
      monacoApi?.setTheme(themeName);
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      if (target && previousVariables) {
        for (const [name, value] of previousVariables) {
          try {
            if (value.length === 0) target.removeProperty(name);
            else target.setProperty(name, value);
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
      }
      if (monacoApi) {
        try {
          monacoApi.defineTheme(
            previousThemeName,
            toMonacoThemeData(materializeAppliedTheme(previousTheme)),
          );
          monacoApi.setTheme(previousThemeName);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }

      const message = describeError(error);
      if (rollbackErrors.length > 0) {
        throw new Error(
          `Failed to apply theme "${themeName}" (${message}); rollback also failed: ` +
            rollbackErrors.map(describeError).join('; '),
        );
      }
      throw new Error(`Failed to apply theme "${themeName}": ${message}.`);
    }

    this.currentTheme = theme;
    this.currentThemeName = themeName;
  }
}

export const themeService = new ThemeService();
