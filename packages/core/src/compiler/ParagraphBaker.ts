import { ContentLowerer } from '../parser/content/ContentLowerer';
import type {
  BakedContentNode,
  TextRunAst,
} from '../parser/content/types';
import { evaluateParagraphPresence } from '../parser/control/ControlFlowLowerer';
import type {
  ParagraphPresenceEvaluationResult,
} from '../parser/control/types';
import type { FenceObjectBinding } from '../parser/document/types';
import { ArgumentValueEvaluator } from '../parser/expression/ArgumentResolver';
import type {
  ResolvedSubject,
  SpatialSelector,
} from '../parser/scope/types';
import { ChainTimingLowerer } from '../parser/semantic/ChainTimingLowerer';
import type {
  RevealUnit,
  SemanticCommandMember,
  SemanticSentence,
  UnitRevealPlan,
} from '../parser/semantic/types';
import type { DiagnosticEvent, SourceRange } from '../types/diagnostics';
import type { PlannedWaitGate } from '../execution/waitGateTypes';
import type { CompiledKmdLine, CompiledKmdParagraph } from './types';
import type {
  BakedParagraphLine,
  BakedParagraphPlan,
  BakedSentencePlan,
  ParagraphBakeContext,
  ParagraphSentenceTarget,
  ParagraphTextUnit,
} from './paragraphBakeTypes';

const DEFAULT_REVEAL_SPEED_MS = 50;
const PUNCTUATION_DELAY_FACTOR = 5;

interface FlattenState {
  cursorSeconds: number;
  baseSpeedSeconds: number;
  speedSeconds: number;
  units: ParagraphTextUnit[];
  waitGates: PlannedWaitGate[];
}

interface BakedLineResult {
  line: BakedParagraphLine;
  diagnostics: DiagnosticEvent[];
}

/**
 * Scene-entry baker. It evaluates already-bound state expressions and produces
 * stable text/unit/timing data without creating Pixi, GSAP or legacy parser IR.
 */
export class ParagraphBaker {
  private readonly content = new ContentLowerer();
  private readonly timing = new ChainTimingLowerer();
  private readonly arguments = new ArgumentValueEvaluator();

  public bake(
    paragraph: CompiledKmdParagraph,
    context: ParagraphBakeContext,
  ): BakedParagraphPlan {
    const diagnostics: DiagnosticEvent[] = [];
    const presence = this.evaluatePresence(paragraph, context, diagnostics);
    if (presence.present !== true) {
      return {
        paragraphId: paragraph.id,
        sceneIndex: paragraph.sceneIndex,
        paragraphIndex: paragraph.paragraphIndex,
        sourceRange: { ...paragraph.range },
        options: paragraph.options,
        present: presence.present,
        lines: [],
        units: [],
        sentences: [],
        waitGates: [],
        diagnostics,
        complete: presence.complete && paragraph.complete,
      };
    }

    const speedSeconds = revealSpeedSeconds(paragraph.options.speed);
    const flatten: FlattenState = {
      cursorSeconds: 0,
      baseSpeedSeconds: speedSeconds,
      speedSeconds,
      units: [],
      waitGates: [],
    };
    const lines = paragraph.lines.map((line, index) => {
      const baked = this.bakeLine(paragraph, line, context, flatten);
      diagnostics.push(...baked.diagnostics);
      if (index < paragraph.lines.length - 1) {
        flatten.cursorSeconds += flatten.baseSpeedSeconds * 10;
        flatten.speedSeconds = flatten.baseSpeedSeconds;
      }
      return baked.line;
    });
    const sentences = this.bakeSentences(
      paragraph,
      lines,
      flatten.units,
      context,
      diagnostics,
    );

    return {
      paragraphId: paragraph.id,
      sceneIndex: paragraph.sceneIndex,
      paragraphIndex: paragraph.paragraphIndex,
      sourceRange: { ...paragraph.range },
      options: paragraph.options,
      present: true,
      lines,
      units: flatten.units,
      sentences,
      waitGates: flatten.waitGates,
      diagnostics,
      complete: paragraph.complete
        && lines.every((line) => line.complete)
        && diagnostics.every((entry) => entry.severity !== 'error'),
    };
  }

  private evaluatePresence(
    paragraph: CompiledKmdParagraph,
    context: ParagraphBakeContext,
    diagnostics: DiagnosticEvent[],
  ): ParagraphPresenceEvaluationResult {
    if (paragraph.presenceSeedIds.length === 0) {
      return { present: true, diagnostics: [], complete: true };
    }
    const byId = new Map(context.presenceSeeds.map((seed) => [seed.id, seed]));
    let result: ParagraphPresenceEvaluationResult = {
      present: true,
      diagnostics: [],
      complete: true,
    };
    for (const seedId of paragraph.presenceSeedIds) {
      const seed = byId.get(seedId);
      if (seed === undefined) {
        diagnostics.push({
          severity: 'error',
          code: 'paragraph-bake-missing-presence-seed',
          subsystem: 'paragraph-bake',
          message: `Paragraph presence seed "${seedId}" is missing.`,
          range: { ...paragraph.range },
          origin: { range: { ...paragraph.range }, paragraphIndex: paragraph.paragraphIndex },
        });
        return { present: null, diagnostics: [], complete: false };
      }
      result = evaluateParagraphPresence(seed, {
        state: context.state,
        spatial: context.spatial,
      });
      diagnostics.push(...result.diagnostics.map((entry) => diagnosticEvent(
        entry,
        'paragraph-presence',
        paragraph,
      )));
      if (result.present !== true) return result;
    }
    return result;
  }

  private bakeLine(
    paragraph: CompiledKmdParagraph,
    line: CompiledKmdLine,
    context: ParagraphBakeContext,
    flatten: FlattenState,
  ): BakedLineResult {
    const baked = this.content.bake(line.content, {
      state: context.state,
      spatial: context.spatial,
    });
    const before = flatten.units.length;
    this.flattenNodes(line, baked.nodes, flatten, null);
    const lineUnits = flatten.units.slice(before);
    return {
      line: {
        id: line.id,
        sourceLine: line.sourceLine,
        range: { ...line.range },
        bodyRange: { ...line.bodyRange },
        activeFenceIds: [...line.activeFenceIds],
        content: baked.nodes,
        text: baked.text,
        unitIds: lineUnits.map((unit) => unit.id),
        complete: line.complete && baked.complete,
      },
      diagnostics: baked.diagnostics.map((entry) => diagnosticEvent(
        entry,
        'content-bake',
        paragraph,
        line.sourceLine,
      )),
    };
  }

  private flattenNodes(
    line: CompiledKmdLine,
    nodes: readonly BakedContentNode[],
    state: FlattenState,
    braceGroupId: string | null,
  ): void {
    for (const node of nodes) {
      if (node.type === 'baked-brace-group') {
        this.flattenNodes(line, node.children, state, braceId(node.range));
        continue;
      }
      if (node.type === 'text-run') {
        this.flattenTextRun(line, node, state, braceGroupId);
        continue;
      }
      if (node.type === 'pause-cue') {
        const wait = parsePauseWait(node.parameter);
        if (wait !== null) {
          state.waitGates.push({
            id: `wait:body:${node.range.start}`,
            sourceRange: { ...node.range },
            sourceLine: line.sourceLine,
            atSeconds: state.cursorSeconds,
            wait,
          });
          continue;
        }
        const duration = parsePauseSeconds(node.parameter);
        if (duration !== null) state.cursorSeconds += duration;
        continue;
      }
      if (node.sugar === 'slow') state.speedSeconds = state.baseSpeedSeconds * 2;
      else if (node.sugar === 'fast') state.speedSeconds = state.baseSpeedSeconds * 0.5;
    }
  }

  private flattenTextRun(
    line: CompiledKmdLine,
    node: TextRunAst,
    state: FlattenState,
    braceGroupId: string | null,
  ): void {
    const characters = visibleCharacters(node);
    const groupId = braceGroupId ?? `line-group:${line.id}`;
    characters.forEach((character, index) => {
      const unit: ParagraphTextUnit = {
        id: `char:${line.id}:${character.range.start}:${index}`,
        text: character.text,
        sourceRange: character.range,
        sourceLine: line.sourceLine,
        lineId: line.id,
        marks: [...node.marks],
        braceGroupId,
        groupId,
        revealAtSeconds: state.cursorSeconds,
      };
      state.units.push(unit);
      state.cursorSeconds += state.speedSeconds * (
        /[，。！？]/u.test(character.text) ? PUNCTUATION_DELAY_FACTOR : 1
      );
    });
  }

  private bakeSentences(
    paragraph: CompiledKmdParagraph,
    lines: readonly BakedParagraphLine[],
    units: ParagraphTextUnit[],
    context: ParagraphBakeContext,
    diagnostics: DiagnosticEvent[],
  ): BakedSentencePlan[] {
    const result: BakedSentencePlan[] = [];
    for (const group of paragraph.openingSentenceGroups) {
      group.sentences.forEach((sentence, sentenceIndex) => {
        result.push(this.bakeSentence(
          paragraph,
          group.host,
          group.sourceLine,
          sentence,
          sentenceIndex,
          units,
          lines,
          context,
          diagnostics,
        ));
      });
    }
    for (const line of paragraph.lines) {
      const group = line.sentenceGroup;
      if (group === null) continue;
      group.sentences.forEach((sentence, sentenceIndex) => {
        result.push(this.bakeSentence(
          paragraph,
          group.host,
          group.sourceLine,
          sentence,
          sentenceIndex,
          units,
          lines,
          context,
          diagnostics,
        ));
      });
    }
    return result;
  }

  private bakeSentence(
    paragraph: CompiledKmdParagraph,
    host: 'line' | 'paragraph',
    sourceLine: number,
    sentence: SemanticSentence,
    sentenceIndex: number,
    units: ParagraphTextUnit[],
    lines: readonly BakedParagraphLine[],
    context: ParagraphBakeContext,
    diagnostics: DiagnosticEvent[],
  ): BakedSentencePlan {
    const target = materializeParagraphSentenceTarget(
      sentence.subject,
      host,
      sourceLine,
      units,
      lines,
    );
    this.applySentenceRevealTiming(sentence, target, units, context);
    if (target.kind === 'unresolved') {
      diagnostics.push({
        severity: 'error',
        code: 'paragraph-bake-unresolved-selector',
        subsystem: 'paragraph-bake',
        message: 'Sentence selector cannot be materialized into paragraph units.',
        line: sourceLine,
        range: { ...sentence.source.range },
        origin: {
          line: sourceLine,
          range: { ...sentence.source.range },
          paragraphIndex: paragraph.paragraphIndex,
        },
      });
    }
    const revealPlan = createParagraphUnitRevealPlan(target, sentence, units);
    const timing = this.timing.lower(sentence, revealPlan);
    diagnostics.push(...timing.diagnostics.map((entry) => diagnosticEvent(
      entry,
      'chain-timing',
      paragraph,
      sourceLine,
    )));
    return {
      id: `sentence:${paragraph.id}:${sourceLine}:${sentence.source.range.start}:${sentenceIndex}`,
      host,
      sourceLine,
      range: { ...sentence.source.range },
      sentence,
      target,
      revealPlan,
      timing,
    };
  }

  /**
   * Timing commands change the reveal clock of the selected text domain before
   * D12 expands later cues against unit reveal times. This keeps explicit
   * slow/fast aligned with body sugars and keeps pause:char local to pause
   * instead of copying char granularity onto the following member.
   */
  private applySentenceRevealTiming(
    sentence: SemanticSentence,
    target: ParagraphSentenceTarget,
    units: ParagraphTextUnit[],
    context: ParagraphBakeContext,
  ): void {
    if (target.kind !== 'text-domain' || target.unitIds.length === 0) return;
    for (const beat of sentence.beats) {
      for (const member of beat.members) {
        if (member.type !== 'semantic-command-member') continue;
        if (member.name === 'slow' || member.name === 'fast') {
          const fallback = member.name === 'slow' ? 2 : 0.5;
          const factor = this.resolveTimingNumber(
            member,
            ['factor', 'f'],
            fallback,
            context,
          );
          if (factor !== null && factor >= 0) {
            scaleTargetRevealTimes(units, target.unitIds, factor);
          }
          continue;
        }
        if (member.name === 'pause' && member.granularity === 'char') {
          const duration = this.resolveTimingNumber(member, [], 1, context);
          if (duration !== null && duration >= 0) {
            spaceTargetRevealTimes(units, target.unitIds, duration);
          }
        }
      }
    }
  }

  private resolveTimingNumber(
    member: SemanticCommandMember,
    namedPriority: readonly string[],
    fallback: number,
    context: ParagraphBakeContext,
  ): number | null {
    const argument = namedPriority
      .map((name) => member.args.find((entry) => entry.name === name))
      .find((entry) => entry !== undefined)
      ?? member.args.find((entry) => entry.name === null && entry.sourceIndex === 0);
    if (argument === undefined) return fallback;
    const evaluated = this.arguments.evaluate(argument.value, context.state, context.spatial);
    if (!evaluated.complete || evaluated.value === null) return null;
    if (evaluated.value.type === 'number') return evaluated.value.value;
    if (evaluated.value.type === 'time') return evaluated.value.seconds;
    return null;
  }
}

export function bakeParagraph(
  paragraph: CompiledKmdParagraph,
  context: ParagraphBakeContext,
): BakedParagraphPlan {
  return new ParagraphBaker().bake(paragraph, context);
}

export function materializeParagraphSentenceTarget(
  subject: ResolvedSubject | null,
  host: 'line' | 'paragraph',
  sourceLine: number,
  units: readonly ParagraphTextUnit[],
  lines: readonly BakedParagraphLine[],
): ParagraphSentenceTarget {
  if (subject === null) {
    return textTarget(null, hostUnits(host, sourceLine, units));
  }
  if (subject.kind === 'builtin') {
    if (subject.name === 'bg') return nonTextTarget('background', subject);
    if (subject.name === 'cam') return nonTextTarget('stage', subject);
    if (subject.name === 'flow') return nonTextTarget('layout-flow', subject);
    return nonTextTarget('state', subject);
  }
  if (subject.kind === 'definition') {
    const covered = fenceCoveredRanges(subject.definition.payload);
    if (covered !== null) {
      return textTarget(null, units.filter((unit) => covered.some((range) => (
        rangesOverlap(unit.sourceRange, range)
      ))), subject);
    }
    return nonTextTarget('definition', subject);
  }

  return selectorTarget(subject, subject.selector, host, sourceLine, units, lines);
}

function selectorTarget(
  subject: ResolvedSubject,
  selector: SpatialSelector,
  host: 'line' | 'paragraph',
  sourceLine: number,
  units: readonly ParagraphTextUnit[],
  lines: readonly BakedParagraphLine[],
): ParagraphSentenceTarget {
  if (selector.kind === 'line') {
    return textTarget(selector, hostUnits(host, sourceLine, units), subject);
  }
  if (selector.kind === 'brace-group') {
    const range = selector.group?.range;
    if (range === undefined) return unresolvedTarget(subject, selector);
    return textTarget(selector, units.filter((unit) => rangeContains(range, unit.sourceRange)), subject);
  }
  if (selector.kind === 'relative-line') {
    const ordered = [...lines].sort((left, right) => left.sourceLine - right.sourceLine);
    const current = ordered.findIndex((line) => line.sourceLine === sourceLine);
    const offset = selector.direction === 'prev' ? -1 : 1;
    const targetLine = current < 0 ? undefined : ordered[current + offset];
    return targetLine === undefined
      ? unresolvedTarget(subject, selector)
      : textTarget(selector, units.filter((unit) => unit.lineId === targetLine.id), subject);
  }
  if (selector.kind === 'definition') {
    const covered = fenceCoveredRanges(selector.definition.payload);
    return covered === null
      ? unresolvedTarget(subject, selector)
      : textTarget(selector, units.filter((unit) => covered.some((range) => (
        rangesOverlap(unit.sourceRange, range)
      ))), subject);
  }
  if (selector.kind === 'access') {
    if (selector.valueType === 'point') {
      return {
        kind: 'text-point',
        subject,
        selector,
        unitIds: [],
      };
    }
    return selectorTarget(subject, selector.target, host, sourceLine, units, lines);
  }
  return unresolvedTarget(subject, selector);
}

function hostUnits(
  host: 'line' | 'paragraph',
  sourceLine: number,
  units: readonly ParagraphTextUnit[],
): ParagraphTextUnit[] {
  return host === 'paragraph'
    ? [...units]
    : units.filter((unit) => unit.sourceLine === sourceLine);
}

function textTarget(
  selector: SpatialSelector | null,
  units: readonly ParagraphTextUnit[],
  subject: ResolvedSubject | null = selector === null ? null : { kind: 'selector', selector },
): ParagraphSentenceTarget {
  return {
    kind: 'text-domain',
    subject,
    selector,
    unitIds: units.map((unit) => unit.id),
  };
}

function nonTextTarget(
  kind: Exclude<ParagraphSentenceTarget['kind'], 'text-domain' | 'text-point' | 'unresolved'>,
  subject: ResolvedSubject,
): ParagraphSentenceTarget {
  return { kind, subject, selector: null, unitIds: [] };
}

function unresolvedTarget(
  subject: ResolvedSubject,
  selector: SpatialSelector,
): ParagraphSentenceTarget {
  return { kind: 'unresolved', subject, selector, unitIds: [] };
}

export function createParagraphUnitRevealPlan(
  target: ParagraphSentenceTarget,
  sentence: SemanticSentence,
  allUnits: readonly ParagraphTextUnit[],
): UnitRevealPlan {
  const targetIds = new Set(target.unitIds);
  const units = allUnits.filter((unit) => targetIds.has(unit.id));
  const groups = new Map<string, RevealUnit>();
  for (const unit of units) {
    if (!groups.has(unit.groupId)) {
      groups.set(unit.groupId, {
        id: `group:${unit.groupId}`,
        revealAtSeconds: unit.revealAtSeconds,
      });
    }
  }
  const firstReveal = units[0]?.revealAtSeconds ?? 0;
  return {
    char: units.map((unit) => ({
      id: unit.id,
      revealAtSeconds: unit.revealAtSeconds,
    })),
    group: [...groups.values()],
    // block is the sentence target domain, including non-text cam/bg targets.
    block: [{
      id: `block:${sentence.source.range.start}`,
      revealAtSeconds: firstReveal,
    }],
  };
}

function visibleCharacters(node: TextRunAst): Array<{ text: string; range: SourceRange }> {
  const content = [...node.content];
  if (content.length === 0) return [];
  if (node.raw.startsWith('{=')) {
    return content.map((text) => ({ text, range: { ...node.range } }));
  }

  const mapped: Array<{ text: string; range: SourceRange }> = [];
  for (let offset = 0; offset < node.raw.length;) {
    const start = offset;
    if (node.raw[offset] === '\\' && offset + 1 < node.raw.length) offset += 1;
    const point = node.raw.codePointAt(offset);
    if (point === undefined) break;
    const text = String.fromCodePoint(point);
    offset += text.length;
    mapped.push({
      text,
      range: {
        start: node.range.start + start,
        end: node.range.start + offset,
      },
    });
  }
  if (mapped.map((entry) => entry.text).join('') === node.content) return mapped;
  return content.map((text) => ({ text, range: { ...node.range } }));
}

function revealSpeedSeconds(value: unknown): number {
  return (typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_REVEAL_SPEED_MS) / 1000;
}

function parsePauseSeconds(parameter: string | null): number | null {
  if (parameter === null || parameter.trim().length === 0) return 1;
  const match = /^([+]?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)?$/u.exec(parameter.trim());
  if (match === null) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return match[2] === 'ms' ? value / 1000 : value;
}

function parsePauseWait(parameter: string | null): PlannedWaitGate['wait'] | null {
  const source = parameter?.trim();
  if (source === 'click') return { event: 'click' };
  const signal = source === undefined
    ? null
    : /^signal:([\p{L}_][\p{L}\p{N}_-]*)$/u.exec(source)?.[1] ?? null;
  return signal === null ? null : { event: 'signal', signal };
}

function braceId(range: SourceRange): string {
  return `brace:${range.start}`;
}

function fenceCoveredRanges(payload: unknown): SourceRange[] | null {
  if (payload === null || typeof payload !== 'object') return null;
  const candidate = payload as Partial<FenceObjectBinding>;
  if (candidate.type !== 'fence-object-binding' || !Array.isArray(candidate.coveredLineRanges)) {
    return null;
  }
  return candidate.coveredLineRanges.map((range) => ({ ...range }));
}

function rangeContains(outer: SourceRange, inner: SourceRange): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

function rangesOverlap(left: SourceRange, right: SourceRange): boolean {
  return left.start < right.end && right.start < left.end;
}

function scaleTargetRevealTimes(
  units: ParagraphTextUnit[],
  targetUnitIds: readonly string[],
  factor: number,
): void {
  transformTargetRevealTimes(
    units,
    targetUnitIds,
    (firstReveal, originalReveal) => firstReveal + (originalReveal - firstReveal) * factor,
  );
}

function spaceTargetRevealTimes(
  units: ParagraphTextUnit[],
  targetUnitIds: readonly string[],
  intervalSeconds: number,
): void {
  let targetIndex = 0;
  transformTargetRevealTimes(
    units,
    targetUnitIds,
    (firstReveal) => firstReveal + targetIndex++ * intervalSeconds,
  );
}

function transformTargetRevealTimes(
  units: ParagraphTextUnit[],
  targetUnitIds: readonly string[],
  transform: (firstReveal: number, originalReveal: number) => number,
): void {
  const selected = new Set(targetUnitIds);
  const indexes = units.flatMap((unit, index) => selected.has(unit.id) ? [index] : []);
  const firstIndex = indexes[0];
  const lastIndex = indexes.at(-1);
  if (firstIndex === undefined || lastIndex === undefined) return;

  const firstReveal = units[firstIndex]!.revealAtSeconds;
  const originalLastReveal = units[lastIndex]!.revealAtSeconds;
  for (const index of indexes) {
    const unit = units[index]!;
    unit.revealAtSeconds = transform(firstReveal, unit.revealAtSeconds);
  }

  // Keep later source units after the adjusted target instead of allowing a
  // slower selection to overlap text that originally followed it.
  const delta = units[lastIndex]!.revealAtSeconds - originalLastReveal;
  if (delta === 0) return;
  for (let index = lastIndex + 1; index < units.length; index += 1) {
    units[index]!.revealAtSeconds = Math.max(0, units[index]!.revealAtSeconds + delta);
  }
}

function diagnosticEvent(
  entry: { severity: DiagnosticEvent['severity']; message: string; code?: string; range: SourceRange },
  subsystem: string,
  paragraph: CompiledKmdParagraph | null,
  line?: number,
): DiagnosticEvent {
  return {
    severity: entry.severity,
    code: entry.code,
    subsystem,
    message: entry.message,
    line,
    range: { ...entry.range },
    origin: {
      line,
      range: { ...entry.range },
      paragraphIndex: paragraph?.paragraphIndex,
    },
  };
}
