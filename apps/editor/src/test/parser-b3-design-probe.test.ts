import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSegmentGraphHarness } from './segment-graph-test-harness';

const PROBE = join(import.meta.dirname, '__fixtures__', 'b3', 'b3-design-probe.kmd');

describe('parser B3 design probe', () => {
  it('builds a deterministic graph plan without connecting production playback', () => {
    const source = readFileSync(PROBE, 'utf-8').replace(/\r\n/gu, '\n');
    const { document, control, result } = buildSegmentGraphHarness(source, {
      route: true,
      count: 0,
    });

    expect(document.diagnostics).toEqual([]);
    expect(control.complete).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.graph.anchorTargets.map((target) => target.name)).toEqual([
      'start',
      'truth',
      'lie',
      'repeat',
      'end',
    ]);
    expect(result.graph.edges.some((edge) => edge.kind === 'conditional')).toBe(true);
    expect(result.graph.edges.some((edge) => edge.kind === 'jump')).toBe(true);
    expect(result.graph.edges.some((edge) => edge.isBackEdge)).toBe(true);
    expect(result.graph.defaultPath.length).toBeGreaterThan(1);

    const serialized = JSON.stringify(result.graph);
    expect(serialized).not.toContain('timeline');
    expect(serialized).not.toContain('KineticText');
    // pause(click) 仍在确定性段载荷对应的段落中；wait-gate 的提取接缝由 execution/B4 接入。
    expect(result.graph.edges.some((edge) => edge.kind === 'wait-gate')).toBe(false);
  });
});
