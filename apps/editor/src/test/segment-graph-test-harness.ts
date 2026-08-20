import { SegmentGraphBuilder } from '@kmd/core/graph/SegmentGraphBuilder';
import { ControlFlowLowerer } from '@kmd/core/parser/control/ControlFlowLowerer';
import { parseDocumentStructure } from '@kmd/core/parser/document/DocumentParser';
import { InteractiveSegmentLowerer } from '@kmd/core/parser/interactive/InteractiveSegmentLowerer';
import { DefinitionIndex } from '@kmd/core/parser/scope/DefinitionIndex';
import { createStaticScopeCommandRegistryView } from '@kmd/core/parser/scope/RuntimeScopeRegistryView';
import { ScopeResolver } from '@kmd/core/parser/scope/ScopeResolver';
import type { StateValue } from '@kmd/core/state/StateStore';

export function buildSegmentGraphHarness(
  source: string,
  variables: Readonly<Record<string, StateValue>> = {},
) {
  const document = parseDocumentStructure(source);
  const definitions = new DefinitionIndex();
  for (const name of Object.keys(variables)) {
    definitions.add({
      name,
      kind: 'var',
      level: 'document',
      visibleFrom: { offset: 0 },
      visibleUntil: { offset: source.length + 1 },
      payload: null,
      declarationRange: { start: 0, end: name.length },
      source: 'frontmatter',
    });
  }
  const scopes = new ScopeResolver(
    definitions,
    createStaticScopeCommandRegistryView([
      { name: 'wave', family: 'effect' },
      { name: 'pause', family: 'effect' },
    ]),
  );
  const control = new ControlFlowLowerer(scopes).lower(document);
  const interactive = new InteractiveSegmentLowerer().lower(document, control.anchors, 'stage');
  const result = new SegmentGraphBuilder().build(document, control, interactive);
  return { document, control, interactive, result };
}
