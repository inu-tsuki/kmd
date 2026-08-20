import { describe, expect, it } from 'vitest';
import { bakeParagraph } from '@kmd/core/compiler/ParagraphBaker';
import { compileKmdDocument } from '@kmd/core/compiler/KmdDocumentCompiler';
import type { CompiledKmdDocument, CompiledKmdParagraph } from '@kmd/core/compiler/types';
import { StateStore } from '@kmd/core/state/StateStore';

function firstParagraph(compiled: CompiledKmdDocument): CompiledKmdParagraph {
  const paragraph = compiled.scenes.flatMap((scene) => scene.paragraphs)[0];
  expect(paragraph).toBeDefined();
  return paragraph!;
}

function bake(compiled: CompiledKmdDocument, paragraph = firstParagraph(compiled)) {
  return bakeParagraph(paragraph, {
    state: new StateStore(compiled.scope.storeInitials),
    presenceSeeds: compiled.control.presenceSeeds,
  });
}

function targetText(
  plan: ReturnType<typeof bake>,
  unitIds: readonly string[],
): string {
  const selected = new Set(unitIds);
  return plan.units
    .filter((unit) => selected.has(unit.id))
    .map((unit) => unit.text)
    .join('');
}

describe('ParagraphBaker: content and presence', () => {
  it('evaluates paragraph presence and inline content before creating ranged text units', () => {
    const source = [
      '---',
      'speed: 100',
      'var:',
      '  show: true',
      '  name: 月',
      '---',
      '[if var.show]',
      '**甲**{=var.name}。',
    ].join('\n');
    const compiled = compileKmdDocument(source);
    const result = bake(compiled);

    expect(compiled.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(result.present).toBe(true);
    expect(result.lines.map((line) => line.text)).toEqual(['甲月。']);
    expect(result.units.map((unit) => ({
      text: unit.text,
      marks: unit.marks,
      reveal: unit.revealAtSeconds,
      absolute: unit.sourceRange.start >= source.indexOf('**甲**'),
    }))).toEqual([
      { text: '甲', marks: ['bold'], reveal: 0, absolute: true },
      { text: '月', marks: [], reveal: 0.1, absolute: true },
      { text: '。', marks: [], reveal: 0.2, absolute: true },
    ]);
    expect(result.complete).toBe(true);

    const hidden = compileKmdDocument(source.replace('show: true', 'show: false'));
    expect(bake(hidden)).toMatchObject({
      present: false,
      lines: [],
      units: [],
      sentences: [],
      complete: true,
    });
  });
});

describe('ParagraphBaker: selectors and reveal timing', () => {
  it('materializes sequential and content brace selectors into stable unit ids', () => {
    const compiled = compileKmdDocument(
      '{甲}{乙} @ {}.red:char {}.wave:group {乙}.wave:group',
    );
    const result = bake(compiled);

    expect(compiled.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(result.sentences).toHaveLength(3);
    expect(targetText(result, result.sentences[0]!.target.unitIds)).toBe('甲');
    expect(targetText(result, result.sentences[1]!.target.unitIds)).toBe('乙');
    expect(targetText(result, result.sentences[2]!.target.unitIds)).toBe('乙');
    expect(result.sentences[0]!.timing.beats[0]!.instances).toMatchObject([
      { unitKind: 'char', unitId: result.sentences[0]!.target.unitIds[0] },
    ]);
    expect(result.sentences[2]!.timing.beats[0]!.instances).toMatchObject([
      { unitKind: 'group', unitId: expect.stringMatching(/^group:brace:/u) },
    ]);
    expect(result.complete).toBe(true);
  });

  it('uses fence definition coverage to materialize object subjects', () => {
    const compiled = compileKmdDocument([
      ':::hero',
      '甲乙 @ hero.wave:char',
      ':::',
    ].join('\n'));
    const result = bake(compiled);

    expect(compiled.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(result.sentences).toHaveLength(1);
    expect(result.sentences[0]!.target.kind).toBe('text-domain');
    expect(targetText(result, result.sentences[0]!.target.unitIds)).toBe('甲乙');
    expect(result.sentences[0]!.timing.beats[0]!.instances).toHaveLength(2);
  });

  it('creates block reveal units for cam and bg subjects without text targets', () => {
    const compiled = compileKmdDocument(
      '甲 @ cam.zoom:block(1) + bg.grayscale:block',
    );
    const result = bake(compiled);

    expect(compiled.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(result.sentences.map((sentence) => sentence.target.kind)).toEqual([
      'stage',
      'background',
    ]);
    for (const sentence of result.sentences) {
      expect(sentence.target.unitIds).toEqual([]);
      expect(sentence.revealPlan).toMatchObject({ char: [], group: [] });
      expect(sentence.revealPlan.block).toHaveLength(1);
      expect(sentence.timing.beats[0]!.instances).toMatchObject([
        { unitKind: 'block', nominalStartSeconds: 0 },
      ]);
    }
    expect(result.complete).toBe(true);
  });
});
