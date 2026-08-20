import { SourceTextIndex } from '../analysis/SourceTextIndex';
import type {
  KmdCommandInspectionEntry,
  KmdDefaultPathMarker,
  KmdDocumentAnalysis,
  KmdFoldingRange,
  KmdSegmentBoundary,
} from '../analysis/types';
import { SegmentGraphBuilder } from '../graph/SegmentGraphBuilder';
import type { SegmentGraphNode } from '../graph/types';
import type { ChainExpressionAst } from '../parser/chainSyntax/types';
import { ContentLowerer } from '../parser/content/ContentLowerer';
import type { ContentBindingResult } from '../parser/content/types';
import type { BoundContentNode } from '../parser/content/types';
import { ControlFlowLowerer } from '../parser/control/ControlFlowLowerer';
import type { ControlFlowLoweringResult } from '../parser/control/types';
import { FenceDefinitionLowerer } from '../parser/document/FenceDefinitionLowerer';
import { parseDocumentStructure } from '../parser/document/DocumentParser';
import type {
  DocumentAst,
  DocumentRenderableLine,
  ParagraphAst,
  SceneAst,
} from '../parser/document/types';
import { InteractiveSegmentLowerer } from '../parser/interactive/InteractiveSegmentLowerer';
import { ArgumentResolver } from '../parser/expression/ArgumentResolver';
import { ExpressionBinder } from '../parser/expression/ExpressionBinder';
import { extractFrontMatterBlock } from '../parser/frontmatter';
import { MacroDefinitionLowerer } from '../parser/macro/MacroDefinitionLowerer';
import { MacroExpander } from '../parser/macro/MacroExpander';
import type { MacroExpansionResult } from '../parser/macro/types';
import { ObjectMutationLowerer } from '../parser/object/ObjectMutationLowerer';
import { OptionTable } from '../parser/options/OptionTable';
import type {
  OptionDiagnostic,
  OptionPatchEntry,
  OptionValue,
} from '../parser/options/types';
import { DefinitionIndex } from '../parser/scope/DefinitionIndex';
import { runtimeScopeCommandRegistryView } from '../parser/scope/RuntimeScopeRegistryView';
import { BUILTIN_SUBJECTS, ScopeResolver } from '../parser/scope/ScopeResolver';
import { SubjectResolver } from '../parser/scope/SubjectResolver';
import type {
  BraceGroupInput,
  ResolvedExpression,
  ResolvedMember,
  ScopeCommandRegistryView,
} from '../parser/scope/types';
import { SemanticLowerer } from '../parser/semantic/SemanticLowerer';
import type {
  SemanticBoundValue,
  SemanticMember,
  SemanticLoweringResult,
  SemanticSentence,
} from '../parser/semantic/types';
import { AssignmentFolder } from '../parser/state/AssignmentFolder';
import { StateLowerer } from '../parser/state/StateLowerer';
import type {
  AssignmentSeed,
  FrontmatterVariableInput,
  StateLoweringResult,
  StateSentenceInput,
} from '../parser/state/types';
import { StateStore } from '../state/StateStore';
import type {
  DiagnosticEvent,
  DiagnosticSuggestion,
  SourceRange,
} from '../types/diagnostics';
import type {
  CompiledKmdDocument,
  CompiledKmdLine,
  CompiledKmdParagraph,
  CompiledKmdScene,
  CompiledSentenceGroup,
} from './types';

const DEFAULT_ENGINE_OPTIONS: Readonly<Record<string, OptionValue>> = Object.freeze({
  mode: 'stage',
  designWidth: 1920,
  designHeight: 1080,
  speed: 50,
  maxWidth: 1536,
  fontSize: 36,
  lineHeight: 60,
  indent: 0,
  letterSpacing: 0,
  align: 'left',
});

interface CompilerDiagnosticLike {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  range: SourceRange;
}

interface ChainEntry {
  id: string;
  host: 'line' | 'paragraph';
  sceneIndex: number;
  paragraphId: string;
  sourceLine: number;
  range: SourceRange;
  sceneRange: SourceRange;
  expression: ChainExpressionAst;
  braceGroups: BraceGroupInput[];
}

interface CompiledChainEntry extends ChainEntry {
  resolved: ResolvedExpression;
  expanded: MacroExpansionResult;
  semantic: SemanticLoweringResult;
  group: CompiledSentenceGroup;
}

export interface KmdDocumentCompilerOptions {
  registry?: ScopeCommandRegistryView;
  engineDefaults?: Readonly<Record<string, OptionValue>>;
}

/**
 * Phase B production compiler. This is the only layer allowed to compose syntax,
 * scope, state, macro, semantic, content, control-flow and graph lowering.
 */
export class KmdDocumentCompiler {
  private readonly registry: ScopeCommandRegistryView;
  private readonly engineDefaults: Readonly<Record<string, OptionValue>>;

  public constructor(options: KmdDocumentCompilerOptions = {}) {
    this.registry = options.registry ?? runtimeScopeCommandRegistryView;
    this.engineDefaults = Object.freeze({
      ...DEFAULT_ENGINE_OPTIONS,
      ...(options.engineDefaults ?? {}),
    });
  }

  public compile(source: string): CompiledKmdDocument {
    const textIndex = new SourceTextIndex(source);
    const syntax = parseDocumentStructure(source);
    const definitions = new DefinitionIndex();
    const fences = new FenceDefinitionLowerer(definitions).lower(syntax);
    const scopes = new ScopeResolver(definitions, this.registry);
    const subjects = new SubjectResolver(scopes);
    const chainEntries = collectChainEntries(syntax);
    const state = new StateLowerer(definitions, scopes).lower({
      documentVisibleUntil: { offset: source.length + 1 },
      frontmatterVariables: collectFrontmatterVariables(source),
      sentences: chainEntries.flatMap((entry) => entry.expression.sentences.map((sentence) => ({
        sentence,
        sceneVisibleUntil: { offset: entry.sceneRange.end },
      } satisfies StateSentenceInput))),
    });
    const macros = new MacroDefinitionLowerer(definitions).lower(state.deferredDefinitions);
    const expander = new MacroExpander(definitions, scopes, subjects);
    const argumentResolver = new ArgumentResolver(scopes);
    const semanticLowerer = new SemanticLowerer();
    const assignmentFolder = new AssignmentFolder();
    const expansionFoldDiagnostics: CompilerDiagnosticLike[] = [];

    const compiledEntries = chainEntries.map((entry) => {
      const resolved = subjects.resolveExpression(entry.expression, {
        at: { offset: entry.expression.range.start },
        braceGroups: entry.braceGroups,
      });
      const expansionState = stateAtOffset(
        state,
        entry.sceneRange,
        entry.expression.range.start,
        assignmentFolder,
      );
      expansionFoldDiagnostics.push(...expansionState.diagnostics);
      const expanded = expander.expand({
        expression: resolved,
        state: expansionState.store,
        context: {
          at: { offset: entry.expression.range.start },
          braceGroups: entry.braceGroups,
        },
      });
      const executable = predicateExpression(expanded.expression);
      const semantic = argumentResolver.resolve(
        semanticLowerer.lowerExpression(executable),
      );
      const sentences = semantic.semantic.sentences;
      const group: CompiledSentenceGroup = {
        host: entry.host,
        sourceLine: entry.sourceLine,
        range: { ...entry.range },
        sentences,
        complete: semantic.complete,
      };
      return {
        ...entry,
        resolved,
        expanded,
        semantic: semantic.semantic,
        group,
      } satisfies CompiledChainEntry;
    });

    const objectMutations = new ObjectMutationLowerer().lower(
      compiledEntries.flatMap((entry) => entry.expanded.expression.sentences),
    );
    const contentLowerer = new ContentLowerer(new ExpressionBinder(scopes));
    const contentBindings = bindContentLines(syntax, contentLowerer);
    const optionTable = new OptionTable(
      this.engineDefaults,
      collectFrontmatterOptions(source),
    );
    const documentOptions = optionTable.document();
    const paragraphOptionDiagnostics: OptionDiagnostic[] = [];
    const control = new ControlFlowLowerer(scopes).lower(syntax);
    const interactive = new InteractiveSegmentLowerer().lower(
      syntax,
      control.anchors,
      documentOptions.values.mode,
    );
    const graphResult = new SegmentGraphBuilder().build(syntax, control, interactive);
    const scenes = compileScenes(
      syntax,
      compiledEntries,
      contentBindings,
      control,
      optionTable,
      paragraphOptionDiagnostics,
    );
    const signalNames = collectSignalNames(scenes);
    const finalStateStore = new StateStore(state.storeInitials);
    const finalFold = assignmentFolder.foldThroughOffset(
      state.assignments,
      source.length,
      finalStateStore,
    );

    const extraDiagnosticGroups: Array<{
      subsystem: string;
      values: readonly CompilerDiagnosticLike[];
    }> = [
      { subsystem: 'document', values: syntax.diagnostics },
      { subsystem: 'content', values: syntax.contentDiagnostics },
      { subsystem: 'expression', values: syntax.expressionDiagnostics },
      { subsystem: 'chain', values: syntax.chainDiagnostics },
      { subsystem: 'document', values: fences.diagnostics },
      { subsystem: 'scope', values: fences.scopeDiagnostics },
      { subsystem: 'state', values: state.diagnostics },
      { subsystem: 'expression', values: state.expressionDiagnostics },
      { subsystem: 'scope', values: state.scopeDiagnostics },
      { subsystem: 'macro', values: macros.diagnostics },
      { subsystem: 'chain', values: macros.syntaxDiagnostics },
      { subsystem: 'scope', values: macros.scopeDiagnostics },
      { subsystem: 'state', values: expansionFoldDiagnostics },
      { subsystem: 'state', values: finalFold.diagnostics },
      ...compiledEntries.flatMap((entry) => ([
        { subsystem: 'scope', values: entry.resolved.diagnostics },
        { subsystem: 'macro', values: entry.expanded.diagnostics },
        { subsystem: 'chain', values: entry.expanded.syntaxDiagnostics },
        { subsystem: 'expression', values: entry.expanded.expressionDiagnostics },
        { subsystem: 'scope', values: entry.expanded.scopeDiagnostics },
        { subsystem: 'semantic', values: entry.semantic.diagnostics },
      ])),
      ...[...contentBindings.values()].map((binding) => ({
        subsystem: 'expression',
        values: binding.diagnostics,
      })),
      { subsystem: 'option', values: documentOptions.diagnostics },
      { subsystem: 'option', values: paragraphOptionDiagnostics },
      { subsystem: 'object', values: objectMutations.diagnostics },
      { subsystem: 'semantic', values: objectMutations.semanticDiagnostics },
      { subsystem: 'scope', values: objectMutations.scopeDiagnostics },
      { subsystem: 'scope', values: scopes.audit() },
      { subsystem: 'control', values: control.diagnostics },
      { subsystem: 'expression', values: control.expressionDiagnostics },
      { subsystem: 'interactive', values: interactive.diagnostics },
      { subsystem: 'graph', values: graphResult.diagnostics },
    ];

    const diagnostics = normalizeDiagnostics(
      extraDiagnosticGroups,
      textIndex,
      collectSuggestionCandidates(definitions, this.registry),
    );
    const complete = diagnostics.every((entry) => entry.severity !== 'error')
      && scenes.every((scene) => scene.paragraphs.every((paragraph) => paragraph.complete));
    const analysis: KmdDocumentAnalysis = {
      schemaVersion: 1,
      sourceLength: source.length,
      document: syntax,
      graph: graphResult.graph,
      diagnostics,
      foldingRanges: buildFoldingRanges(syntax, textIndex),
      segmentBoundaries: buildSegmentBoundaries(
        graphResult.graph.nodes,
        graphResult.graph.defaultPath,
        textIndex,
      ),
      defaultPathMarkers: buildDefaultPathMarkers(
        graphResult.graph.nodes,
        graphResult.graph.defaultPath,
        textIndex,
      ),
      inspector: {
        commands: collectCommandInspection(compiledEntries.map((entry) => entry.resolved)),
        state: {
          document: finalStateStore.entries('document'),
          scene: finalStateStore.entries('scene'),
          appliedAssignmentIds: finalFold.appliedAssignmentIds,
          diagnostics: diagnostics.filter((entry) => (
            entry.subsystem === 'state' || entry.subsystem === 'expression'
          )),
        },
        graph: {
          entryNodeId: graphResult.graph.entryNodeId,
          defaultPath: [...graphResult.graph.defaultPath],
          edges: graphResult.graph.edges.map((edge) => ({
            ...edge,
            sourceRange: { ...edge.sourceRange },
          })),
          diagnostics: diagnostics.filter((entry) => entry.subsystem === 'graph'),
        },
      },
      complete,
    };

    return {
      schemaVersion: 1,
      source,
      sourceLength: source.length,
      syntax,
      options: Object.freeze({ ...documentOptions.values }),
      scope: {
        definitions: definitions.all(),
        storeInitials: state.storeInitials.map(cloneStateEntry),
        assignments: state.assignments.map(cloneAssignmentSeed),
        objectMutations: objectMutations.mutations,
      },
      scenes,
      control,
      graph: graphResult.graph,
      signalNames,
      analysis,
      diagnostics,
      complete,
    };
  }
}

function collectSignalNames(scenes: readonly CompiledKmdScene[]): readonly string[] {
  const names = new Set<string>();
  for (const scene of scenes) {
    for (const paragraph of scene.paragraphs) {
      for (const group of paragraph.openingSentenceGroups) {
        for (const sentence of group.sentences) collectSentenceSignals(sentence, names);
      }
      for (const line of paragraph.lines) {
        collectContentSignals(line.content, names);
        for (const sentence of line.sentenceGroup?.sentences ?? []) {
          collectSentenceSignals(sentence, names);
        }
      }
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

function collectSentenceSignals(sentence: SemanticSentence, target: Set<string>): void {
  for (const beat of sentence.beats) {
    for (const member of beat.members) collectMemberSignals(member, target);
  }
}

function collectMemberSignals(member: SemanticMember, target: Set<string>): void {
  if (member.type === 'semantic-clause-member') {
    collectSentenceSignals(member.sentence, target);
    return;
  }
  if (member.type !== 'semantic-command-member' || member.name !== 'pause') return;
  for (const argument of member.args) collectValueSignal(argument.value, target);
}

function collectValueSignal(value: SemanticBoundValue, target: Set<string>): void {
  if (value.type === 'event' && value.event === 'signal' && value.signal !== undefined) {
    target.add(value.signal);
  }
}

function collectContentSignals(nodes: readonly BoundContentNode[], target: Set<string>): void {
  for (const node of nodes) {
    if (node.type === 'bound-brace-group') {
      collectContentSignals(node.children, target);
      continue;
    }
    if (node.type !== 'pause-cue' || node.parameter === null) continue;
    const match = /^signal:([\p{L}_][\p{L}\p{N}_-]*)$/u.exec(node.parameter.trim());
    if (match?.[1] !== undefined) target.add(match[1]);
  }
}

export function compileKmdDocument(
  source: string,
  options: KmdDocumentCompilerOptions = {},
): CompiledKmdDocument {
  return new KmdDocumentCompiler(options).compile(source);
}

function collectChainEntries(document: DocumentAst): ChainEntry[] {
  const entries: ChainEntry[] = [];
  for (const scene of document.scenes) {
    for (const paragraph of scene.paragraphs) {
      for (const prefix of paragraph.prefixLines) {
        if (prefix.opener === null) continue;
        entries.push({
          id: `paragraph-opener:${paragraph.id}:${prefix.index}`,
          host: 'paragraph',
          sceneIndex: scene.index,
          paragraphId: paragraph.id,
          sourceLine: prefix.index,
          range: { ...prefix.opener.range },
          sceneRange: { ...scene.range },
          expression: prefix.opener.expression,
          braceGroups: paragraphBraceGroups(paragraph),
        });
      }
      for (const line of paragraph.bodyLines) {
        if (line.command === null) continue;
        entries.push({
          id: `line-command:${paragraph.id}:${line.index}`,
          host: 'line',
          sceneIndex: scene.index,
          paragraphId: paragraph.id,
          sourceLine: line.index,
          range: { ...line.command.range },
          sceneRange: { ...scene.range },
          expression: line.command.expression,
          braceGroups: collectBraceGroups(line.inline),
        });
      }
    }
  }
  return entries.sort((left, right) => (
    left.expression.range.start - right.expression.range.start
    || left.expression.range.end - right.expression.range.end
    || left.id.localeCompare(right.id)
  ));
}

function paragraphBraceGroups(paragraph: ParagraphAst): BraceGroupInput[] {
  return paragraph.bodyLines.flatMap((line) => collectBraceGroups(line.inline));
}

function collectBraceGroups(
  nodes: DocumentRenderableLine['inline'],
): BraceGroupInput[] {
  return nodes
    .filter((node) => node.type === 'brace-group')
    .map((node) => ({
      id: node.range.start,
      text: node.raw.slice(1, node.closed ? -1 : undefined),
      range: { ...node.range },
    }));
}

function stateAtOffset(
  state: StateLoweringResult,
  sceneRange: SourceRange,
  offset: number,
  folder: AssignmentFolder,
): { store: StateStore; diagnostics: CompilerDiagnosticLike[] } {
  const store = new StateStore(state.storeInitials);
  const relevant = state.assignments.filter((seed) => (
    seed.target.level === 'document'
    || (
      seed.scriptOffset >= sceneRange.start
      && seed.scriptOffset < sceneRange.end
    )
  ));
  const folded = folder.foldThroughOffset(relevant, offset, store);
  return { store, diagnostics: folded.diagnostics };
}

function predicateExpression(expression: ResolvedExpression): ResolvedExpression {
  const sentences = expression.sentences.filter((sentence) => sentence.source.kind === 'predicate');
  return {
    ...expression,
    sentences,
    diagnostics: sentences.flatMap((sentence) => sentence.diagnostics),
  };
}

function bindContentLines(
  document: DocumentAst,
  lowerer: ContentLowerer,
): Map<string, ContentBindingResult> {
  const result = new Map<string, ContentBindingResult>();
  for (const scene of document.scenes) {
    for (const paragraph of scene.paragraphs) {
      for (const line of paragraph.bodyLines) {
        result.set(lineKey(paragraph.id, line.index), lowerer.bind(line.inline, {
          offset: line.bodyRange.start,
        }));
      }
    }
  }
  return result;
}

function compileScenes(
  document: DocumentAst,
  entries: readonly CompiledChainEntry[],
  contentBindings: ReadonlyMap<string, ContentBindingResult>,
  control: ControlFlowLoweringResult,
  optionTable: OptionTable,
  optionDiagnostics: OptionDiagnostic[],
): CompiledKmdScene[] {
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const presenceByParagraph = new Map<string, string[]>();
  for (const seed of control.presenceSeeds) {
    const ids = presenceByParagraph.get(seed.paragraphId) ?? [];
    ids.push(seed.id);
    presenceByParagraph.set(seed.paragraphId, ids);
  }

  return document.scenes.map((scene) => ({
    id: scene.id,
    index: scene.index,
    range: { ...scene.range },
    paragraphs: scene.paragraphs.map((paragraph) => {
      const options = optionTable.resolveParagraph(paragraph.options);
      optionDiagnostics.push(...options.diagnostics);
      const openingSentenceGroups = paragraph.prefixLines.flatMap((prefix) => {
        const entry = entryById.get(`paragraph-opener:${paragraph.id}:${prefix.index}`);
        return entry === undefined ? [] : [cloneSentenceGroup(entry.group)];
      });
      const lines = paragraph.bodyLines.map((line) => compileLine(
        scene,
        paragraph,
        line,
        entryById,
        contentBindings,
      ));
      return {
        id: paragraph.id,
        sceneIndex: scene.index,
        paragraphIndex: paragraph.index,
        range: { ...paragraph.range },
        options: Object.freeze({ ...options.values }),
        presenceSeedIds: [...(presenceByParagraph.get(paragraph.id) ?? [])],
        openingSentenceGroups,
        lines,
        complete: options.diagnostics.every((entry) => entry.severity !== 'error')
          && openingSentenceGroups.every((group) => group.complete)
          && lines.every((line) => line.complete),
      } satisfies CompiledKmdParagraph;
    }),
  } satisfies CompiledKmdScene));
}

function compileLine(
  scene: SceneAst,
  paragraph: ParagraphAst,
  line: DocumentRenderableLine,
  entryById: ReadonlyMap<string, CompiledChainEntry>,
  contentBindings: ReadonlyMap<string, ContentBindingResult>,
): CompiledKmdLine {
  const binding = contentBindings.get(lineKey(paragraph.id, line.index));
  const entry = entryById.get(`line-command:${paragraph.id}:${line.index}`);
  const sentenceGroup = entry === undefined ? null : cloneSentenceGroup(entry.group);
  return {
    id: `compiled-line:${paragraph.id}:${line.index}`,
    sceneIndex: scene.index,
    paragraphId: paragraph.id,
    sourceLine: line.index,
    range: { ...line.range },
    bodyRange: { ...line.bodyRange },
    activeFenceIds: [...line.activeFenceIds],
    content: binding?.nodes ?? [],
    sentenceGroup,
    complete: (binding?.complete ?? true) && (sentenceGroup?.complete ?? true),
  };
}

function collectFrontmatterVariables(source: string): FrontmatterVariableInput[] {
  const block = extractFrontMatterBlock(source);
  if (block === null) return [];
  const starts = sourceLineStarts(source);
  return block.lines.flatMap((line, index) => {
    if (line.type !== 'var-entry' || line.key === undefined) return [];
    const sourceLine = index + 1;
    const lineStart = starts[sourceLine] ?? 0;
    const keyStart = lineStart + line.raw.indexOf(line.key);
    return [{
      name: line.key,
      value: line.parsedValue,
      range: { start: keyStart, end: keyStart + line.key.length },
    }];
  });
}

function collectFrontmatterOptions(source: string): OptionPatchEntry[] {
  const block = extractFrontMatterBlock(source);
  if (block === null) return [];
  const starts = sourceLineStarts(source);
  return block.lines.flatMap((line, index) => {
    if (line.type !== 'key' || line.key === undefined) return [];
    const sourceLine = index + 1;
    const lineStart = starts[sourceLine] ?? 0;
    const keyStart = lineStart + line.raw.indexOf(line.key);
    return [{
      key: line.key,
      value: line.parsedValue,
      range: { start: keyStart, end: keyStart + line.key.length },
    }];
  });
}

function sourceLineStarts(source: string): number[] {
  const starts = [0];
  for (let offset = 0; offset < source.length; offset += 1) {
    if (source.charCodeAt(offset) === 10) starts.push(offset + 1);
  }
  return starts;
}

function normalizeDiagnostics(
  groups: Array<{ subsystem: string; values: readonly CompilerDiagnosticLike[] }>,
  textIndex: SourceTextIndex,
  candidates: Readonly<Record<'name' | 'command', readonly string[]>>,
): DiagnosticEvent[] {
  const diagnostics: DiagnosticEvent[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const value of group.values) {
      const key = `${value.code}\u0000${value.range.start}\u0000${value.range.end}\u0000${value.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const position = textIndex.positionAt(value.range.start);
      const suggestions = suggestionsFor(value, candidates);
      diagnostics.push({
        severity: value.severity,
        code: value.code,
        subsystem: group.subsystem,
        message: appendSuggestionMessage(value.message, suggestions),
        line: position.line,
        range: { ...value.range },
        origin: { line: position.line, range: { ...value.range } },
        ...(suggestions.length === 0 ? {} : { suggestions }),
      });
    }
  }
  return diagnostics.sort((left, right) => (
    (left.range?.start ?? 0) - (right.range?.start ?? 0)
    || (left.range?.end ?? 0) - (right.range?.end ?? 0)
    || (left.code ?? '').localeCompare(right.code ?? '')
  ));
}

function collectSuggestionCandidates(
  definitions: DefinitionIndex,
  registry: ScopeCommandRegistryView,
): Readonly<Record<'name' | 'command', readonly string[]>> {
  const commands = [...new Set(registry.list().map((entry) => entry.name))].sort();
  const names = [...new Set([
    ...BUILTIN_SUBJECTS,
    ...commands,
    ...definitions.all().flatMap((entry) => [entry.name, entry.qualifiedName]),
  ])].sort();
  return { name: names, command: commands };
}

function suggestionsFor(
  diagnostic: CompilerDiagnosticLike,
  candidates: Readonly<Record<'name' | 'command', readonly string[]>>,
): DiagnosticSuggestion[] {
  const kind = diagnostic.code === 'scope-unknown-command'
    ? 'command'
    : diagnostic.code === 'scope-unknown-name'
      ? 'name'
      : null;
  if (kind === null) return [];
  const unknown = /"([^"]+)"/u.exec(diagnostic.message)?.[1];
  if (unknown === undefined) return [];
  const threshold = Math.max(2, Math.floor(unknown.length * 0.34));
  return candidates[kind]
    .map((candidate) => ({ candidate, distance: levenshtein(unknown, candidate) }))
    .filter((entry) => entry.distance <= threshold)
    .sort((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate))
    .slice(0, 3)
    .map((entry) => ({
      label: entry.candidate,
      replacement: entry.candidate,
      range: { ...diagnostic.range },
    }));
}

function appendSuggestionMessage(
  message: string,
  suggestions: readonly DiagnosticSuggestion[],
): string {
  if (suggestions.length === 0) return message;
  return `${message} Did you mean ${suggestions.map((entry) => `"${entry.label}"`).join(', ')}?`;
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1]!
        + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        substitution,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length]!;
}

function buildFoldingRanges(
  document: DocumentAst,
  textIndex: SourceTextIndex,
): KmdFoldingRange[] {
  const ranges: KmdFoldingRange[] = [];
  for (const scene of document.scenes) {
    for (const fence of scene.fences) {
      const span = textIndex.lineSpan({
        start: fence.openRange.start,
        end: fence.closeRange?.end ?? fence.contentRange.end,
      });
      if (span.endLine > span.startLine) {
        ranges.push({
          kind: 'fence',
          startLine: span.startLine,
          endLine: span.endLine,
          range: {
            start: fence.openRange.start,
            end: fence.closeRange?.end ?? fence.contentRange.end,
          },
          label: fence.name,
        });
      }
    }
    ranges.push(...anchorFoldingRanges(scene, textIndex));
  }
  return ranges.sort((left, right) => (
    left.startLine - right.startLine
    || left.endLine - right.endLine
    || left.kind.localeCompare(right.kind)
  ));
}

function anchorFoldingRanges(
  scene: SceneAst,
  textIndex: SourceTextIndex,
): KmdFoldingRange[] {
  const anchors = scene.lines.filter((line) => (
    line.type === 'anchor-line' || line.type === 'anchor-content-line'
  ));
  return anchors.flatMap((anchor, index) => {
    const endOffset = anchors[index + 1]?.range.start ?? scene.range.end;
    const startLine = textIndex.positionAt(anchor.range.start).line;
    const endLine = textIndex.positionAt(Math.max(anchor.range.start, endOffset - 1)).line;
    if (endLine <= startLine) return [];
    return [{
      kind: 'anchor' as const,
      startLine,
      endLine,
      range: { start: anchor.range.start, end: endOffset },
      label: anchor.name,
    }];
  });
}

function buildSegmentBoundaries(
  nodes: readonly SegmentGraphNode[],
  defaultPath: readonly string[],
  textIndex: SourceTextIndex,
): KmdSegmentBoundary[] {
  const pathIndexes = new Map(defaultPath.map((id, index) => [id, index]));
  return nodes.map((node) => ({
    nodeId: node.id,
    sceneIndex: node.sceneIndex,
    line: textIndex.positionAt(node.sourceRange.start).line,
    range: { ...node.sourceRange },
    defaultPathIndex: pathIndexes.get(node.id) ?? null,
  }));
}

function buildDefaultPathMarkers(
  nodes: readonly SegmentGraphNode[],
  defaultPath: readonly string[],
  textIndex: SourceTextIndex,
): KmdDefaultPathMarker[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return defaultPath.flatMap((nodeId, pathIndex) => {
    const node = byId.get(nodeId);
    if (node === undefined) return [];
    const anchor = node.entryAnchors[0]?.name;
    return [{
      nodeId,
      label: anchor === undefined ? `Segment ${node.order + 1}` : `#${anchor}`,
      sceneIndex: node.sceneIndex,
      line: textIndex.positionAt(node.sourceRange.start).line,
      range: { ...node.sourceRange },
      pathIndex,
      pathLength: defaultPath.length,
    }];
  });
}

function collectCommandInspection(
  resolved: readonly ResolvedExpression[],
): KmdCommandInspectionEntry[] {
  const entries: KmdCommandInspectionEntry[] = [];
  for (const expression of resolved) {
    for (const sentence of expression.sentences) {
      if (sentence.commandHead !== null) {
        entries.push(commandInspectionEntry(sentence.commandHead, 'head'));
      }
      for (const beat of sentence.beats) {
        for (const member of beat.members) collectMemberCommands(member, entries);
      }
    }
  }
  const unique = new Map<string, KmdCommandInspectionEntry>();
  for (const entry of entries) {
    unique.set(`${entry.range.start}:${entry.range.end}:${entry.role}:${entry.name}`, entry);
  }
  return [...unique.values()].sort((left, right) => (
    left.range.start - right.range.start
    || left.range.end - right.range.end
    || left.name.localeCompare(right.name)
  ));
}

function collectMemberCommands(
  member: ResolvedMember,
  target: KmdCommandInspectionEntry[],
): void {
  if (member.type === 'resolved-command-member') {
    if (member.role === 'predicate' && member.command !== null) {
      target.push(commandInspectionEntry(member.command, 'predicate'));
    }
    return;
  }
  if (member.type !== 'resolved-clause-member') return;
  if (member.sentence.commandHead !== null) {
    target.push(commandInspectionEntry(member.sentence.commandHead, 'head'));
  }
  for (const beat of member.sentence.beats) {
    for (const nested of beat.members) collectMemberCommands(nested, target);
  }
}

function commandInspectionEntry(
  command: {
    name: string;
    family: KmdCommandInspectionEntry['family'];
    source: { range: SourceRange };
    metadata?: Readonly<Record<string, unknown>>;
  },
  role: KmdCommandInspectionEntry['role'],
): KmdCommandInspectionEntry {
  return {
    name: command.name,
    family: command.family,
    role,
    range: { ...command.source.range },
    metadata: command.metadata ?? null,
  };
}

function cloneSentenceGroup(group: CompiledSentenceGroup): CompiledSentenceGroup {
  return {
    ...group,
    range: { ...group.range },
    sentences: [...group.sentences],
  };
}

function cloneStateEntry<T extends StateLoweringResult['storeInitials'][number]>(entry: T): T {
  return {
    ...entry,
    key: { ...entry.key, declarationRange: { ...entry.key.declarationRange } },
    value: typeof entry.value === 'object'
      ? entry.value.type === 'point'
        ? { ...entry.value }
        : { type: 'domain', start: { ...entry.value.start }, end: { ...entry.value.end } }
      : entry.value,
  } as T;
}

function cloneAssignmentSeed(seed: AssignmentSeed): AssignmentSeed {
  return {
    ...seed,
    target: { ...seed.target, declarationRange: { ...seed.target.declarationRange } },
    range: { ...seed.range },
  };
}

function lineKey(paragraphId: string, lineIndex: number): string {
  return `${paragraphId}:${lineIndex}`;
}
