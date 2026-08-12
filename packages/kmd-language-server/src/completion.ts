import {
  CompletionItemKind,
  type CompletionItem,
  type Position,
  type Range,
} from 'vscode-languageserver/node';
import {
  BUILTIN_EFFECT_COMMANDS,
  BUILTIN_LAYOUT_COMMANDS,
  BUILTIN_STAGE_COMMANDS,
  BUILTIN_STYLE_COMMANDS,
} from './completionCatalog';
import { extractFrontMatterBlock } from '@kmd/core/parser/frontmatter';

const LEVELS = ['char', 'group', 'block'] as const;
const WORD_SUFFIX = /[A-Za-z0-9_-]*$/;
const AUTHOR_COMMANDS = new Set<string>([
  ...BUILTIN_EFFECT_COMMANDS,
  ...BUILTIN_STYLE_COMMANDS,
  ...BUILTIN_STAGE_COMMANDS,
  ...BUILTIN_LAYOUT_COMMANDS,
]);

interface LineContext {
  quote: '"' | "'" | null;
  parenDepth: number;
  commandSeparator: number;
}

/** Match AstParser.findAtSymbol(): the first unescaped @ outside an inline group. */
function findCommandSeparator(text: string): number {
  let braceDepth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === '\\') {
      index++;
      continue;
    }
    if (char === '{') braceDepth++;
    else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
    else if (char === '@' && braceDepth === 0) return index;
  }
  return -1;
}

/** Scan only the command-zone prefix for quote and parenthesis state. */
function scanLineContext(text: string): LineContext {
  const commandSeparator = findCommandSeparator(text);
  let quote: LineContext['quote'] = null;
  let escaped = false;
  let parenDepth = 0;

  for (let index = commandSeparator + 1; commandSeparator >= 0 && index < text.length; index++) {
    const char = text[index]!;
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      parenDepth++;
    } else if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
    }
  }

  return { quote, parenDepth, commandSeparator };
}

function getLine(source: string, lineNumber: number): string | null {
  if (!Number.isInteger(lineNumber) || lineNumber < 0) return null;
  return source.split(/\r?\n/)[lineNumber] ?? null;
}

function replacementRange(line: string, position: Position): Range {
  const before = line.slice(0, position.character);
  const currentWord = before.match(WORD_SUFFIX)?.[0] ?? '';
  return {
    start: { line: position.line, character: position.character - currentWord.length },
    end: position,
  };
}

function item(
  label: string,
  kind: CompletionItemKind,
  range: Range,
  insertText = label,
): CompletionItem {
  return {
    label,
    kind,
    textEdit: { range, newText: insertText },
  };
}

function splitArguments(source: string): string[] {
  const argumentsList: string[] = [];
  let start = 0;
  let quote: LineContext['quote'] = null;
  let escaped = false;
  let depth = 0;

  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      argumentsList.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  argumentsList.push(source.slice(start).trim());
  return argumentsList;
}

function findClosingParen(source: string, openIndex: number): number {
  let quote: LineContext['quote'] = null;
  let escaped = false;
  let depth = 1;
  for (let index = openIndex + 1; index < source.length; index++) {
    const char = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth++;
    else if (char === ')' && --depth === 0) return index;
  }
  return -1;
}

function markerName(value: string | undefined): string | null {
  if (!value) return null;
  const assignmentIndex = value.indexOf('=');
  const raw = (assignmentIndex >= 0 ? value.slice(assignmentIndex + 1) : value).trim();
  const unquoted = (
    (raw.startsWith('"') && raw.endsWith('"'))
    || (raw.startsWith("'") && raw.endsWith("'"))
  ) ? raw.slice(1, -1) : raw;
  return /^[A-Za-z0-9_-]+$/.test(unquoted) ? unquoted : null;
}

function stripLineComment(line: string): string {
  let quote: LineContext['quote'] = null;
  let escaped = false;
  for (let index = 0; index < line.length - 1; index++) {
    const char = line[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '/' && line[index + 1] === '/' && (index === 0 || line[index - 1] === ' ')) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line;
}

function collectMarkers(source: string): string[] {
  const markers = new Set<string>();
  const markerCommands = new Set(['mark', 'markStart', 'markEnd', 'markMiddle', 'markChar']);

  for (const sourceLine of source.split(/\r?\n/)) {
    const line = stripLineComment(sourceLine);
    const separator = findCommandSeparator(line);
    if (separator < 0) continue;
    const commandZone = line.slice(separator + 1);
    let quote: LineContext['quote'] = null;
    let escaped = false;
    let depth = 0;

    for (let index = 0; index < commandZone.length;) {
      const char = commandZone[index]!;
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = null;
        index++;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        index++;
        continue;
      }
      if (char === '(') {
        depth++;
        index++;
        continue;
      }
      if (char === ')') {
        depth = Math.max(0, depth - 1);
        index++;
        continue;
      }
      if (depth > 0) {
        index++;
        continue;
      }
      if (!/[A-Za-z_]/.test(commandZone[index]!)) {
        index++;
        continue;
      }
      const nameStart = index;
      index++;
      while (index < commandZone.length && /[A-Za-z0-9_-]/.test(commandZone[index]!)) index++;
      const command = commandZone.slice(nameStart, index);
      if (nameStart >= 4 && commandZone.slice(nameStart - 4, nameStart) === 'cam.') {
        continue;
      }
      let openIndex = index;
      while (commandZone[openIndex] === ' ' || commandZone[openIndex] === '\t') openIndex++;
      if (commandZone[openIndex] !== '(') continue;

      const closeIndex = findClosingParen(commandZone, openIndex);
      if (closeIndex < 0) break;
      index = closeIndex + 1;
      if (!markerCommands.has(command)) continue;

      const args = splitArguments(commandZone.slice(openIndex + 1, closeIndex));
      const named = new Map<string, string>();
      for (const arg of args) {
        const namedMatch = arg.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
        if (namedMatch) named.set(namedMatch[1]!, namedMatch[2]!);
      }

      let candidate: string | undefined;
      if (command === 'mark') {
        candidate = named.get('name') ?? named.get('val')
          ?? (args.length >= 3 ? args[2] : args.length >= 2 ? args[1] : args[0]);
      } else if (command === 'markChar') {
        candidate = named.get('label') ?? named.get('val') ?? args[1];
      } else {
        candidate = named.get('name') ?? named.get('label') ?? named.get('val') ?? args[0];
      }
      const name = markerName(candidate);
      if (name) markers.add(name);
    }
  }
  return [...markers];
}

function collectDocumentReferences(source: string): {
  markers: string[];
  variables: string[];
} {
  const variables = new Set<string>();
  const frontmatter = extractFrontMatterBlock(source);
  for (const line of frontmatter?.lines ?? []) {
    if (line.type === 'var-entry' && line.key) variables.add(`var.${line.key}`);
  }

  return {
    markers: collectMarkers(source),
    variables: [...variables],
  };
}

function isKnownCommandMember(member: string): boolean {
  const normalized = member.startsWith('f.') ? member.slice(2) : member;
  if (normalized.startsWith('cam.')) return AUTHOR_COMMANDS.has(normalized);
  if (AUTHOR_COMMANDS.has(normalized)) return true;
  const finalMember = normalized.split('.').at(-1);
  return finalMember !== undefined && AUTHOR_COMMANDS.has(finalMember);
}

function isLevelMemberExpression(expression: string): boolean {
  const member = expression.match(/[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/);
  if (!member || member.index === undefined) return false;
  if (member.index > 0 && !/[.\s+[]/.test(expression[member.index - 1]!)) return false;
  return isKnownCommandMember(member[0]);
}

function isBlockOptionLevelContext(textBefore: string): boolean {
  const firstNonWhitespace = textBefore.search(/\S/);
  if (firstNonWhitespace < 0 || textBefore[firstNonWhitespace] !== '[') return false;
  const expression = textBefore.slice(firstNonWhitespace + 1, -1);
  if (expression.includes(']')) return false;
  const context = scanLineContext(`@${expression}`);
  return context.quote === null
    && context.parenDepth === 0
    && isLevelMemberExpression(expression);
}

function isCommandLevelContext(textBefore: string, context: LineContext): boolean {
  if (
    !textBefore.endsWith(':')
  ) return false;

  if (context.commandSeparator < 0) return isBlockOptionLevelContext(textBefore);
  if (context.quote !== null || context.parenDepth !== 0) return false;

  const commandZone = textBefore.slice(context.commandSeparator + 1, -1);
  return isLevelMemberExpression(commandZone);
}

/** Pure completion adapter shared by stdio and Node IPC transports. */
export function provideKmdCompletions(
  source: string,
  position: Position,
): CompletionItem[] {
  const line = getLine(source, position.line);
  if (
    line === null
    || !Number.isInteger(position.character)
    || position.character < 0
    || position.character > line.length
  ) return [];
  const textBefore = line.slice(0, position.character);
  const range = replacementRange(line, position);
  const context = scanLineContext(textBefore);
  const commandBefore = context.commandSeparator >= 0
    ? textBefore.slice(context.commandSeparator + 1)
    : '';

  if (isCommandLevelContext(textBefore, context)) {
    return LEVELS.map((level) => item(level, CompletionItemKind.Keyword, range));
  }
  if (textBefore.endsWith(':')) return [];

  if (context.quote !== null) return [];

  if (context.commandSeparator >= 0 && context.parenDepth > 0) {
    const references = collectDocumentReferences(source);
    return [
      ...references.markers.map((label) => item(label, CompletionItemKind.Variable, range)),
      ...references.variables.map((label) => item(label, CompletionItemKind.Variable, range)),
    ];
  }

  const effectContext = commandBefore.match(/(?:^|[\s+])f\.([A-Za-z0-9_-]*)$/);
  if (effectContext) {
    return [...BUILTIN_EFFECT_COMMANDS, ...BUILTIN_STYLE_COMMANDS]
      .map((name) => item(name, CompletionItemKind.Function, range));
  }

  const cameraContext = commandBefore.match(/(?:^|[\s+])cam\.([A-Za-z0-9_-]*)$/);
  if (cameraContext) {
    return BUILTIN_STAGE_COMMANDS
      .filter((name) => name.startsWith('cam.'))
      .map((name) => item(name.slice(4), CompletionItemKind.Function, range));
  }

  if (context.commandSeparator >= 0) {
    const commands = new Set([
      ...BUILTIN_EFFECT_COMMANDS,
      ...BUILTIN_STYLE_COMMANDS,
      ...BUILTIN_STAGE_COMMANDS,
      ...BUILTIN_LAYOUT_COMMANDS,
    ]);
    const suggestions = [...commands]
      .map((name) => item(name, CompletionItemKind.Method, range));
    suggestions.push(item('f.', CompletionItemKind.Keyword, range));
    return suggestions;
  }

  return [];
}
