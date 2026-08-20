import { describe, expect, it } from 'vitest';
import { buildSegmentGraphHarness } from './segment-graph-test-harness';

describe('segment-graph-builder: B3 graph planning', () => {
  it('represents linear scenes using paragraph groups and default edges only', () => {
    const { result } = buildSegmentGraphHarness('第一段\n\n第二段\n---\n第三段');

    expect(result.complete).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.nodes.map((node) => (
      node.segment.type === 'deterministic-segment-plan' ? node.segment.paragraphIds.length : -1
    ))).toEqual([2, 1]);
    expect(result.graph.edges).toMatchObject([{
      kind: 'default',
      sourceKind: 'sequential',
      isBackEdge: false,
      requiresCheckpointRestore: true,
    }]);
    expect(result.graph.defaultPath).toEqual(result.graph.nodes.map((node) => node.id));
  });

  it('cuts at anchors and control points, preserves fallback, and marks back edges', () => {
    const source = [
      'intro',
      '[if var.route -> #truth | else -> #lie]',
      '# truth',
      'truth',
      '-> #end',
      '# lie',
      'lie',
      '# loop',
      'again',
      '[if var.more -> #loop]',
      '# end',
      'end',
    ].join('\n');
    const { result } = buildSegmentGraphHarness(source, { route: true, more: true });

    expect(result.complete).toBe(true);
    expect(result.graph.nodes.map((node) => node.kind)).toEqual([
      'paragraph-group',
      'control-point',
      'paragraph-group',
      'control-point',
      'paragraph-group',
      'paragraph-group',
      'control-point',
      'paragraph-group',
    ]);
    expect(result.graph.edges.filter((edge) => edge.kind === 'conditional')).toHaveLength(2);
    expect(result.graph.edges.filter((edge) => edge.kind === 'jump')).toHaveLength(1);
    const backEdge = result.graph.edges.find((edge) => edge.isBackEdge);
    expect(backEdge).toMatchObject({ kind: 'conditional', jumpTarget: { name: 'loop' } });

    const loopTarget = result.graph.anchorTargets.find((target) => target.name === 'loop');
    expect(loopTarget).toBeDefined();
    const loopNode = result.graph.nodes.find((node) => node.id === loopTarget?.nodeId);
    expect(loopNode?.entryCheckpoint).toEqual({
      required: true,
      reasons: ['anchor-target', 'branch-target', 'back-edge-target'],
    });

    const defaultNames = result.graph.defaultPath.map((nodeId) => (
      result.graph.nodes.find((node) => node.id === nodeId)?.entryAnchors[0]?.name ?? null
    ));
    expect(defaultNames).toEqual([null, null, 'lie', 'loop', null, 'end']);
  });

  it('maps an anchor-content paragraph with prefixes to one target node', () => {
    const source = ['intro', '[if var.show]', '# visible @ .wave', 'body'].join('\n');
    const { result } = buildSegmentGraphHarness(source, { show: true });

    expect(result.complete).toBe(true);
    expect(result.graph.nodes).toHaveLength(2);
    const target = result.graph.anchorTargets[0]!;
    const node = result.graph.nodes.find((entry) => entry.id === target.nodeId)!;
    if (node.segment.type !== 'deterministic-segment-plan') {
      throw new TypeError('Expected a deterministic paragraph node.');
    }
    expect(target).toMatchObject({ name: 'visible', rendered: true });
    expect(node.segment.paragraphs).toHaveLength(1);
    expect(node.segment.range.start).toBe(source.indexOf('[if var.show]'));
    expect(node.entryAnchors).toMatchObject([{ name: 'visible', rendered: true }]);
  });

  it('reports unreachable nodes and routing branches after an unconditional jump', () => {
    const source = [
      'start',
      '-> #end',
      'dead',
      '[if true -> #branch]',
      '# branch',
      'branch',
      '# end',
      'end',
    ].join('\n');
    const { result } = buildSegmentGraphHarness(source);

    expect(result.complete).toBe(true);
    expect(result.diagnostics.filter((entry) => entry.code === 'segment-graph-unreachable-node'))
      .toHaveLength(3);
    expect(result.diagnostics.filter((entry) => entry.code === 'segment-graph-unreachable-branch'))
      .toHaveLength(1);
  });

  it('keeps unresolved target evidence and marks the graph incomplete', () => {
    const { control, result } = buildSegmentGraphHarness('start\n-> #missing');

    expect(control.complete).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.diagnostics).toMatchObject([{
      code: 'segment-graph-unresolved-target',
      severity: 'error',
    }]);
    expect(result.graph.edges.every((edge) => edge.kind === 'default')).toBe(true);
  });
});
