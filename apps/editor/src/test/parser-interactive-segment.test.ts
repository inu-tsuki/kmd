import { describe, expect, it } from 'vitest';
import { compileKmdDocument } from '@kmd/core/compiler/KmdDocumentCompiler';
import { parseDocumentStructure } from '@kmd/core/parser/document/DocumentParser';

function codes(entries: readonly { code: string }[]): string[] {
  return entries.map((entry) => entry.code);
}

const validSource = [
  '开场',
  '[game("pong") win -> #win | lose -> #lose | else -> #aborted]',
  '# win',
  '胜利',
  '# lose',
  '失败',
  '# aborted',
  '中止',
].join('\n');

describe('parser-interactive-segment: C2 source compiler', () => {
  it('recognizes game lines before generic routing and preserves exact source ranges', () => {
    const document = parseDocumentStructure(validSource);
    const line = document.lines.find((entry) => entry.type === 'interactive-line');

    expect(document.diagnostics).toEqual([]);
    expect(line).toBeDefined();
    if (line?.type !== 'interactive-line') throw new TypeError('Expected interactive line.');
    expect(line.moduleId).toBe('pong');
    expect(validSource.slice(line.moduleIdRange.start, line.moduleIdRange.end)).toBe('"pong"');
    expect(line.outcomes).toMatchObject([
      { kind: 'outcome', outcome: 'win', target: 'win' },
      { kind: 'outcome', outcome: 'lose', target: 'lose' },
      { kind: 'else', outcome: null, target: 'aborted' },
    ]);
    for (const outcome of line.outcomes) {
      expect(validSource.slice(outcome.range.start, outcome.range.end)).toBe(outcome.raw);
      expect(validSource.slice(outcome.targetRange.start, outcome.targetRange.end)).toBe(outcome.target);
      if (outcome.outcome !== null && outcome.outcomeRange !== null) {
        expect(validSource.slice(outcome.outcomeRange.start, outcome.outcomeRange.end))
          .toBe(outcome.outcome);
      }
    }
    expect(document.lines.some((entry) => (
      entry.type === 'bracket-line' && entry.routing !== null
    ))).toBe(false);
  });

  it('builds one interactive node with explicit outcome edges and truncates the default path', () => {
    const compiled = compileKmdDocument(validSource);
    const node = compiled.graph.nodes.find((entry) => entry.kind === 'interactive');

    expect(compiled.complete).toBe(true);
    expect(compiled.diagnostics).toEqual([]);
    expect(node).toBeDefined();
    expect(node?.segment).toMatchObject({
      type: 'interactive-segment-plan',
      moduleId: 'pong',
      outcomes: ['win', 'lose'],
      hasFallback: true,
    });

    const outcomes = compiled.graph.edges.filter((edge) => edge.kind === 'outcome');
    expect(outcomes).toMatchObject([
      { outcome: 'win', sourceKind: 'outcome', jumpTarget: { name: 'win' } },
      { outcome: 'lose', sourceKind: 'outcome', jumpTarget: { name: 'lose' } },
      { outcome: null, sourceKind: 'outcome', jumpTarget: { name: 'aborted' } },
    ]);
    expect(compiled.graph.edges.some((edge) => (
      edge.from === node?.id && edge.kind === 'default'
    ))).toBe(false);
    expect(compiled.graph.defaultPath.at(-1)).toBe(node?.id);
    expect(compiled.analysis.defaultPathMarkers.at(-1)?.nodeId).toBe(node?.id);
    expect(compiled.analysis.segmentBoundaries.find((entry) => entry.nodeId === node?.id))
      .toMatchObject({ defaultPathIndex: compiled.graph.defaultPath.length - 1 });
  });

  it('reports malformed module IDs, duplicate outcomes and invalid fallback order', () => {
    const malformed = parseDocumentStructure('[game(pong) win -> #win]');
    expect(codes(malformed.diagnostics)).toContain('document-invalid-interactive-line');
    expect(malformed.lines[0]).toMatchObject({
      type: 'structure-error-line',
      family: 'interactive',
    });

    const duplicate = parseDocumentStructure(
      '[game("pong") win -> #win | win -> #again | else -> #fallback | else -> #other]',
    );
    expect(codes(duplicate.diagnostics)).toEqual(expect.arrayContaining([
      'interactive-duplicate-outcome',
      'interactive-duplicate-fallback',
      'document-invalid-interactive-branch',
    ]));
  });

  it('keeps manifest-free source validation separate from anchor and mode diagnostics', () => {
    const source = [
      '---',
      'mode: scroll',
      '---',
      '[game("missing-from-manifest") win -> #missing]',
    ].join('\n');
    const compiled = compileKmdDocument(source);

    expect(codes(compiled.diagnostics)).toEqual(expect.arrayContaining([
      'interactive-mode-unsupported',
      'interactive-undefined-anchor',
      'segment-graph-unresolved-target',
    ]));
    expect(codes(compiled.diagnostics)).not.toContain('interactive-module-unresolved');
    expect(compiled.complete).toBe(false);
  });

  it('rejects C2 v1 game lines nested inside selection fences', () => {
    const document = parseDocumentStructure([
      '::: selected',
      '[game("pong") win -> #win]',
      ':::',
      '# win',
      '完成',
    ].join('\n'));

    expect(codes(document.diagnostics)).toContain('interactive-mixed-structure');
    expect(document.lines.find((entry) => entry.type === 'interactive-line'))
      .toMatchObject({ activeFenceIds: [expect.any(String)] });
  });

  it.each([
    '[game("pong") if var.route -> #win]',
    '[game("pong") win -> #win size=1]',
    '[game("pong") bold win -> #win]',
  ])('reports mixed routing/options/opener structure: %s', (source) => {
    const document = parseDocumentStructure(source);
    expect(codes(document.diagnostics)).toEqual(expect.arrayContaining([
      'interactive-mixed-structure',
      'document-invalid-interactive-branch',
    ]));
  });
});
