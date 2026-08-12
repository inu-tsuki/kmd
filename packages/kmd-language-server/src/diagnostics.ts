import {
  DiagnosticSeverity,
  type Diagnostic,
  type Range,
} from 'vscode-languageserver/node';

export interface KmdValidationIssue {
  message: string;
  /** `KMDParser.validate()` reports 1-based lines. */
  line: number;
}

interface CommandOccurrence {
  name: string;
  line: number;
  start: number;
  end: number;
}

const UNKNOWN_COMMAND_PATTERN = /^Unknown command:?\s+"([^"]+)"$/;

/**
 * Pure adapter from the parser validation surface to LSP diagnostics.
 *
 * The parser's compatibility validator intentionally exposes only a 1-based line.
 * For unknown commands, the adapter therefore relocates the command in source-level
 * command regions so block options and command names receive an exact LSP range.
 */
export function toLspDiagnostics(
  source: string,
  issues: readonly KmdValidationIssue[],
): Diagnostic[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const unknownNames = new Set<string>();

  for (const issue of issues) {
    const unknownName = getUnknownCommandName(issue.message);
    if (unknownName) unknownNames.add(unknownName);
  }

  const occurrences = collectCommandOccurrences(lines, unknownNames);
  const usedOccurrences = new Set<string>();
  const seenIssues = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  for (const issue of issues) {
    const issueKey = `${issue.line}\u0000${issue.message}`;
    if (seenIssues.has(issueKey)) continue;
    seenIssues.add(issueKey);

    const requestedLine = clampLine(issue.line - 1, lines.length);
    const unknownName = getUnknownCommandName(issue.message);
    const range = unknownName
      ? locateUnknownCommand(unknownName, requestedLine, occurrences, usedOccurrences)
        ?? fallbackRange(lines, requestedLine)
      : fallbackRange(lines, requestedLine);

    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      message: issue.message,
      range,
      source: 'kmd',
      code: unknownName ? 'unknown-command' : 'parser-validation',
    });
  }

  return diagnostics;
}

function getUnknownCommandName(message: string): string | undefined {
  return UNKNOWN_COMMAND_PATTERN.exec(message)?.[1];
}

function clampLine(line: number, lineCount: number): number {
  return Math.max(0, Math.min(Number.isFinite(line) ? line : 0, Math.max(0, lineCount - 1)));
}

function fallbackRange(lines: readonly string[], line: number): Range {
  const text = lines[line] ?? '';
  const firstContent = text.search(/\S/);
  const start = firstContent === -1 ? 0 : firstContent;
  return {
    start: { line, character: start },
    end: { line, character: Math.max(start, text.length) },
  };
}

function locateUnknownCommand(
  name: string,
  requestedLine: number,
  occurrences: readonly CommandOccurrence[],
  usedOccurrences: Set<string>,
): Range | undefined {
  const candidates = occurrences.filter((occurrence) => occurrence.name === name);
  const available = candidates.filter((occurrence) => !usedOccurrences.has(occurrenceKey(occurrence)));
  const occurrence = available.find((candidate) => candidate.line === requestedLine)
    ?? [...available].sort((left, right) => {
      const leftDistance = Math.abs(left.line - requestedLine);
      const rightDistance = Math.abs(right.line - requestedLine);
      return leftDistance - rightDistance || left.line - right.line || left.start - right.start;
    })[0];

  if (!occurrence) return undefined;
  usedOccurrences.add(occurrenceKey(occurrence));
  return {
    start: { line: occurrence.line, character: occurrence.start },
    end: { line: occurrence.line, character: occurrence.end },
  };
}

function occurrenceKey(occurrence: CommandOccurrence): string {
  return `${occurrence.line}:${occurrence.start}:${occurrence.end}`;
}

function collectCommandOccurrences(
  lines: readonly string[],
  names: ReadonlySet<string>,
): CommandOccurrence[] {
  if (names.size === 0) return [];

  const occurrences: CommandOccurrence[] = [];
  for (let line = 0; line < lines.length; line++) {
    const sourceLine = stripComment(lines[line] ?? '');
    for (const zone of commandZones(sourceLine)) {
      for (const name of names) {
        collectNameInZone(sourceLine, line, zone.start, zone.end, name, occurrences);
      }
    }
  }
  return occurrences;
}

function stripComment(line: string): string {
  const commentIndex = line.indexOf('//');
  if (commentIndex !== -1 && (commentIndex === 0 || line[commentIndex - 1] === ' ')) {
    return line.slice(0, commentIndex).trimEnd();
  }
  return line;
}

function commandZones(line: string): Array<{ start: number; end: number }> {
  const zones: Array<{ start: number; end: number }> = [];
  const firstContent = line.search(/\S/);

  if (firstContent !== -1 && line[firstContent] === '[') {
    const end = line.indexOf(']', firstContent + 1);
    if (end !== -1) zones.push({ start: firstContent + 1, end });
  }

  const at = findTopLevelAt(line);
  if (at !== -1) zones.push({ start: at + 1, end: line.length });
  return zones;
}

function findTopLevelAt(line: string): number {
  let braceDepth = 0;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '\\') {
      index++;
      continue;
    }
    if (character === '{') braceDepth++;
    else if (character === '}') braceDepth = Math.max(0, braceDepth - 1);
    else if (character === '@' && braceDepth === 0) return index;
  }
  return -1;
}

function collectNameInZone(
  lineText: string,
  line: number,
  zoneStart: number,
  zoneEnd: number,
  name: string,
  target: CommandOccurrence[],
): void {
  let parenthesisDepth = 0;
  for (let index = zoneStart; index < zoneEnd; index++) {
    const character = lineText[index];
    if (character === '(') {
      parenthesisDepth++;
      continue;
    }
    if (character === ')') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      continue;
    }
    if (parenthesisDepth !== 0 || !lineText.startsWith(name, index)) continue;

    const before = index === zoneStart ? '' : lineText[index - 1] ?? '';
    const after = lineText[index + name.length] ?? '';
    if (!isCommandBoundaryBefore(before) || !isCommandBoundaryAfter(after)) continue;

    target.push({ name, line, start: index, end: index + name.length });
    index += name.length - 1;
  }
}

function isCommandBoundaryBefore(character: string): boolean {
  return character === '' || character === '.' || character === '[' || character === '@' || /\s/.test(character);
}

function isCommandBoundaryAfter(character: string): boolean {
  return character === '' || character === '.' || character === '(' || character === ':'
    || character === '!' || character === ']' || /\s/.test(character);
}
