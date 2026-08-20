import { describe, expect, it } from 'vitest';
import { bakeParagraph } from '@kmd/core/compiler/ParagraphBaker';
import { compileKmdDocument } from '@kmd/core/compiler/KmdDocumentCompiler';
import { planParagraphLanes } from '@kmd/core/compiler/ParagraphLanePlanner';
import { StateStore } from '@kmd/core/state/StateStore';

function compileAndPlan(source: string) {
  const compiled = compileKmdDocument(source);
  const paragraph = compiled.scenes.flatMap((scene) => scene.paragraphs)[0];
  expect(paragraph).toBeDefined();
  const state = new StateStore(compiled.scope.storeInitials);
  const baked = bakeParagraph(paragraph!, {
    state,
    presenceSeeds: compiled.control.presenceSeeds,
  });
  return {
    compiled,
    state,
    baked,
    plan: planParagraphLanes(baked, { state }),
  };
}

describe('ParagraphLanePlanner: semantic families', () => {
  it('routes effect, style, layout and stage commands without EffectConfig', () => {
    const { compiled, plan } = compileAndPlan([
      '---',
      'var:',
      '  strength: 7',
      '---',
      '{甲} @ {甲}.wave:char(strength=var.strength) {甲}.red {甲}.left(1px) cam.zoom(1, 1s) bg.grayscale',
    ].join('\n'));

    expect(compiled.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(plan.execution.effects.map((cue) => ({
      name: cue.name,
      target: cue.target.kind,
      units: cue.target.unitIds.length,
      track: cue.track,
    }))).toEqual([
      { name: 'wave', target: 'text-domain', units: 1, track: 'behavior' },
      { name: 'grayscale', target: 'background', units: 0, track: 'instant' },
    ]);
    expect(plan.execution.effects[0]!.arguments.named).toEqual({ strength: 7 });
    expect(plan.execution.styles).toMatchObject([
      { name: 'red', family: 'style', target: { kind: 'text-domain', unitIds: [expect.any(String)] } },
    ]);
    expect(plan.layout.commands).toMatchObject([
      {
        name: 'left',
        family: 'layout',
        arguments: { positional: [{ type: 'space', value: 1, unit: 'px' }] },
      },
    ]);
    expect(plan.execution.stageCues).toMatchObject([
      {
        name: 'cam.zoom',
        family: 'stage',
        target: { kind: 'stage', unitIds: [] },
        arguments: {
          positional: [1, { type: 'time', seconds: 1 }],
        },
      },
    ]);
    expect(plan.complete).toBe(true);
  });

  it('expands a granular clause into independent stage cues at unit reveal times', () => {
    const { compiled, plan } = compileAndPlan('甲乙 @ .(cam.zoom(+=0.01)):char');

    expect(compiled.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(plan.execution.stageCues).toHaveLength(2);
    expect(plan.execution.stageCues.map((cue) => ({
      name: cue.name,
      start: cue.nominalStartSeconds,
      value: cue.arguments.positional[0],
    }))).toEqual([
      {
        name: 'cam.zoom',
        start: 0,
        value: { type: 'relative', operator: '+=', value: 0.01, unit: 'number' },
      },
      {
        name: 'cam.zoom',
        start: 0.05,
        value: { type: 'relative', operator: '+=', value: 0.01, unit: 'number' },
      },
    ]);
    expect(plan.complete).toBe(true);
  });
});
