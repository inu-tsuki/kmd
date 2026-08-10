import { describe, expect, it } from 'vitest';
import { toLspDiagnostics } from '../diagnostics';
import { validateKmdText } from '../languageService';

describe('toLspDiagnostics', () => {
  it('deduplicates repeated parser validation issues', () => {
    const diagnostics = toLspDiagnostics('text @ f.nope()', [
      { message: 'Unknown command: "nope"', line: 1 },
      { message: 'Unknown command: "nope"', line: 1 },
    ]);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.range).toEqual({
      start: { line: 0, character: 9 },
      end: { line: 0, character: 13 },
    });
  });

  it('locates the command name instead of identical body text', () => {
    const diagnostics = toLspDiagnostics('nope @ f.nope()', [
      { message: 'Unknown command: "nope"', line: 1 },
    ]);

    expect(diagnostics[0]?.range).toEqual({
      start: { line: 0, character: 9 },
      end: { line: 0, character: 13 },
    });
  });

  it('corrects the compatibility validator line for block options', () => {
    const diagnostics = validateKmdText('[.missing]\r\nhello');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.range).toEqual({
      start: { line: 0, character: 2 },
      end: { line: 0, character: 9 },
    });
  });

  it('falls back to the non-whitespace span for general validation errors', () => {
    const diagnostics = toLspDiagnostics('  broken input', [
      { message: 'Parser failure', line: 1 },
    ]);

    expect(diagnostics[0]?.range).toEqual({
      start: { line: 0, character: 2 },
      end: { line: 0, character: 14 },
    });
  });
});

describe('validateKmdText', () => {
  it('reuses the core parser validator for unknown commands', () => {
    const diagnostics = validateKmdText('hello @ f.notInstalled()');

    expect(diagnostics).toMatchObject([
      {
        code: 'unknown-command',
        message: 'Unknown command: "notInstalled"',
        source: 'kmd',
      },
    ]);
    expect(diagnostics[0]?.range).toEqual({
      start: { line: 0, character: 10 },
      end: { line: 0, character: 22 },
    });
  });
});
