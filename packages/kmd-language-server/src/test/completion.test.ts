import { describe, expect, it } from 'vitest';
import { CompletionItemKind, type Position } from 'vscode-languageserver/node';
import { effectManager } from '@kmd/core/effects/EffectManager';
import { styleManager } from '@kmd/core/effects/StyleManager';
import { layoutManager } from '@kmd/core/layout/LayoutManager';
import { stageManager } from '@kmd/core/stage/StageManager';
import {
  BUILTIN_EFFECT_COMMANDS,
  BUILTIN_LAYOUT_COMMANDS,
  BUILTIN_STAGE_COMMANDS,
  BUILTIN_STYLE_COMMANDS,
} from '../completionCatalog';
import { completeKmdText } from '../languageService';

function atEnd(source: string): Position {
  const lines = source.split('\n');
  return {
    line: lines.length - 1,
    character: lines.at(-1)?.length ?? 0,
  };
}

function labels(source: string): string[] {
  return completeKmdText(source, atEnd(source)).map((entry) => entry.label);
}

describe('KMD completion adapter', () => {
  it('completes effect and style names after f. through the production data-only adapter', () => {
    const result = completeKmdText('title @ f.ne', atEnd('title @ f.ne'));
    const neon = result.find((entry) => entry.label === 'neonGlow');
    const red = result.find((entry) => entry.label === 'red');

    expect(neon?.kind).toBe(CompletionItemKind.Function);
    expect(red?.kind).toBe(CompletionItemKind.Function);
    expect(neon?.textEdit).toEqual({
      range: {
        start: { line: 0, character: 10 },
        end: { line: 0, character: 12 },
      },
      newText: 'neonGlow',
    });
  });

  it('uses zero-based UTF-16 ranges on a CRLF document', () => {
    const source = '标题\r\nemoji 😀 @ f.ne';
    const result = completeKmdText(source, { line: 1, character: 15 });
    const neon = result.find((entry) => entry.label === 'neonGlow');

    expect(neon?.textEdit).toEqual({
      range: {
        start: { line: 1, character: 13 },
        end: { line: 1, character: 15 },
      },
      newText: 'neonGlow',
    });
  });

  it('completes short camera names after cam.', () => {
    expect(labels('title @ cam.')).toEqual([
      'move', 'zoom', 'rotate', 'focus', 'offset', 'reset', 'shake', 'drift',
    ]);
  });

  it('completes command levels after a colon', () => {
    expect(labels('title @ f.wave:')).toEqual(['char', 'group', 'block']);
    expect(labels('title @ .wave:')).toEqual(['char', 'group', 'block']);
    expect(labels('[.wave:')).toEqual(['char', 'group', 'block']);
    expect(labels('[pixelate:')).toEqual(['char', 'group', 'block']);
    expect(labels('title @ cam.move:')).toEqual(['char', 'group', 'block']);
    expect(labels('title @ f.red.wave:')).toEqual(['char', 'group', 'block']);
  });

  it('does not complete command levels for body, frontmatter, parameter, or quoted colons', () => {
    expect(labels('说明:')).toEqual([]);
    expect(labels('gold:')).toEqual([]);
    expect(labels('title @ f.wave(label=kind:')).not.toEqual(['char', 'group', 'block']);
    expect(labels('title @ f.wave(label="kind:')).toEqual([]);
    expect(labels('title @ f.notACommand:')).toEqual([]);
    expect(labels('[notACommand:')).toEqual([]);
    expect(labels('title @ cam.wave:')).toEqual([]);
    expect(labels('[cam.wave:')).toEqual([]);
  });

  it('collects document marker and variable references inside parameters', () => {
    const source = [
      '---',
      'title: Sample',
      'mode: stage',
      'var:',
      '  gold: 5',
      '---',
      'anchor @ markStart(hero)',
      'middle @ markMiddle("center")',
      'fifth @ markChar(5, FifthChar)',
      'offset @ mark(10, 20, OffsetAnchor)',
      'title @ goto(',
    ].join('\n');
    expect(labels(source)).toEqual([
      'hero', 'center', 'FifthChar', 'OffsetAnchor', 'var.gold',
    ]);
    expect(labels(source)).not.toEqual(expect.arrayContaining([
      'var.title', 'var.mode', 'var.var',
    ]));

    const sceneClearIsNotFrontmatter = [
      'plain body',
      '---',
      'var:',
      '  phantom: 1',
      'title @ goto(',
    ].join('\n');
    expect(labels(sceneClearIsNotFrontmatter)).not.toContain('var.phantom');
  });

  it('reuses production frontmatter rules for document variables', () => {
    const source = [
      '---',
      'var:',
      '  主题色: cyan',
      '  // comments and blank lines keep the variable block open',
      '',
      '  speed: 2',
      ' oneSpace: not-a-variable',
      '  afterExit: not-a-variable',
      '---',
      'title @ goto(',
    ].join('\n');

    expect(labels(source)).toEqual(['var.主题色', 'var.speed']);
  });

  it('keeps parameter completion active through nested calls and quoted parentheses', () => {
    const nested = [
      'anchor @ markStart(hero)',
      'title @ f.wave(calc(inner(',
    ].join('\n');
    const quoted = [
      'anchor @ markStart(hero)',
      'title @ f.wave(label="ignored \\" ( text", target=',
    ].join('\n');

    expect(labels(nested)).toContain('hero');
    expect(labels(quoted)).toContain('hero');
    expect(labels('title @ f.wave(label="still ( inside')).toEqual([]);
  });

  it('does not collect marker-like text outside executable command members', () => {
    const suffix = '\ntitle @ goto(';
    expect(labels(`// markStart(fake)${suffix}`)).not.toContain('fake');
    expect(labels(`prose markStart(fake)${suffix}`)).not.toContain('fake');
    expect(labels(`title @ f.wave(label="markStart(fake)")${suffix}`)).not.toContain('fake');
    expect(labels(`title @ f.wave(label="x // markStart(fake)")${suffix}`)).not.toContain('fake');
    expect(labels(`title @ "markStart(fake)"${suffix}`)).not.toContain('fake');
    expect(labels(`title @ f.wave(markStart(fake))${suffix}`)).not.toContain('fake');
    expect(labels(`title @ cam.markStart(fake)${suffix}`)).not.toContain('fake');
  });

  it('does not treat a body scene clear followed by var-like text as frontmatter', () => {
    const source = [
      'body',
      '---',
      'var:',
      '  ghost: 1',
      'title @ goto(',
    ].join('\n');
    expect(labels(source)).not.toContain('var.ghost');
  });

  it('offers every built-in command and the f. namespace in an @ command zone', () => {
    const result = labels('title @ ');
    expect(result).toContain('wave');
    expect(result).toContain('cam.move');
    expect(result).toContain('markStart');
    expect(result).toContain('f.');
    expect(result.filter((label) => label === 'gray')).toHaveLength(1);
  });

  it('returns no completion outside a recognized command context', () => {
    expect(labels('plain body text')).toEqual([]);
    expect(labels('plain body (text')).toEqual([]);
    expect(labels('literal \\@ f.')).toEqual([]);
    expect(labels('{literal@inside} f.')).toEqual([]);
  });

  it('rejects invalid LSP positions instead of emitting out-of-range text edits', () => {
    const source = 'title @ f.ne';
    expect(completeKmdText(source, { line: -1, character: 0 })).toEqual([]);
    expect(completeKmdText(source, { line: 1, character: 0 })).toEqual([]);
    expect(completeKmdText(source, { line: 0, character: -1 })).toEqual([]);
    expect(completeKmdText(source, { line: 0, character: source.length + 1 })).toEqual([]);
    expect(completeKmdText(source, { line: 0.5, character: 0 })).toEqual([]);
  });
});

describe('completion catalog parity', () => {
  it('matches all live built-in registries', () => {
    expect([...BUILTIN_EFFECT_COMMANDS].sort()).toEqual(effectManager.getRegisteredNames()
      .filter((name) => effectManager.getMetadata(name)?.internal !== true)
      .sort());
    expect([...BUILTIN_STYLE_COMMANDS].sort()).toEqual(styleManager.getRegisteredNames().sort());
    expect([...BUILTIN_STAGE_COMMANDS].sort()).toEqual(stageManager.getRegisteredNames().sort());
    expect([...BUILTIN_LAYOUT_COMMANDS].sort()).toEqual(layoutManager.getRegisteredNames()
      .filter((name) => layoutManager.getMetadata(name)?.internal !== true)
      .sort());
  });

  it('does not expose internal registry entries to authors', () => {
    const result = labels('title @ ');
    expect(result).not.toContain('pushDisplayOffset');
    expect(result).not.toContain('popDisplayOffset');
  });
});
