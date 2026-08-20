import type {
  CompiledParagraphPlan,
  LayoutTextUnit,
  PlannedCommandArguments,
  PlannedCommandTarget,
  PlannedEffectCue,
  PlannedLayoutCommand,
  PlannedParagraphCue,
  PlannedStageCue,
  PlannedStyleCue,
  RuntimeCommandValue,
} from '../execution/compiledParagraphTypes';
import { ArgumentValueEvaluator } from '../parser/expression/ArgumentResolver';
import type { SpatialValueProvider } from '../parser/expression/types';
import type {
  SemanticBoundArgument,
  SemanticBoundValue,
  SemanticCommandMember,
  SemanticExecutableMember,
  TimedMemberInstance,
  TimedSentence,
} from '../parser/semantic/types';
import { ChainTimingLowerer } from '../parser/semantic/ChainTimingLowerer';
import type { StateReadView } from '../state/StateStore';
import type { DiagnosticEvent, SourceRange } from '../types/diagnostics';
import type { PlannedWaitGate } from '../execution/waitGateTypes';
import {
  createParagraphUnitRevealPlan,
  materializeParagraphSentenceTarget,
} from './ParagraphBaker';
import type {
  BakedParagraphPlan,
  BakedSentencePlan,
  ParagraphSentenceTarget,
  ParagraphTextUnit,
} from './paragraphBakeTypes';

export interface ParagraphLanePlanningContext {
  state: StateReadView;
  spatial?: SpatialValueProvider;
}

interface PlannerState {
  baked: BakedParagraphPlan;
  context: ParagraphLanePlanningContext;
  diagnostics: DiagnosticEvent[];
  cues: PlannedParagraphCue[];
}

interface InstanceContext {
  prefix: string;
  sourceLine: number;
  target: ParagraphSentenceTarget;
  baseStartSeconds: number;
  inheritedDependencies: string[];
}

/**
 * Converts semantic/timing IR into the four backend-neutral lane contracts.
 * Parameter expressions are evaluated exactly once here so natural play and
 * seek materializers can consume the same recorded values.
 */
export class ParagraphLanePlanner {
  private readonly timing = new ChainTimingLowerer();
  private readonly arguments = new ArgumentValueEvaluator();

  public plan(
    baked: BakedParagraphPlan,
    context: ParagraphLanePlanningContext,
  ): CompiledParagraphPlan {
    const state: PlannerState = {
      baked,
      context,
      diagnostics: [...baked.diagnostics],
      cues: [],
    };
    for (const sentence of baked.sentences) this.planSentence(sentence, state);

    const layoutCommands = state.cues.filter(isLayoutCue);
    const effects = state.cues.filter(isEffectCue);
    const styles = state.cues.filter(isStyleCue);
    const stageCues = state.cues.filter(isStageCue);
    const waitGates = [
      ...baked.waitGates,
      ...stageCues.flatMap((cue) => plannedPauseGate(cue)),
    ];
    return {
      paragraphId: baked.paragraphId,
      sourceRange: { ...baked.sourceRange },
      options: baked.options,
      present: baked.present,
      layout: {
        units: baked.units.map(toLayoutUnit),
        commands: layoutCommands,
      },
      execution: {
        cues: state.cues,
        effects,
        styles,
        stageCues,
        diagnostics: state.diagnostics,
      },
      waitGates,
      diagnostics: state.diagnostics,
      complete: baked.complete && state.diagnostics.every((entry) => entry.severity !== 'error'),
    };
  }

  private planSentence(sentence: BakedSentencePlan, state: PlannerState): void {
    this.planTimedSentence(sentence.timing, state, {
      prefix: sentence.id,
      sourceLine: sentence.sourceLine,
      target: sentence.target,
      baseStartSeconds: 0,
      inheritedDependencies: [],
    });
  }

  private planTimedSentence(
    timed: TimedSentence,
    state: PlannerState,
    context: InstanceContext,
  ): void {
    for (const beat of timed.beats) {
      for (const instance of beat.instances) {
        const cueId = cueIdFor(context.prefix, instance);
        const dependencies = [
          ...context.inheritedDependencies,
          ...instance.dependsOnInstanceIds.map((id) => `${context.prefix}:${id}`),
        ];
        if (instance.member.type === 'semantic-command-member') {
          const cue = this.planCommand(
            instance.member,
            instance,
            cueId,
            dependencies,
            context,
            state,
          );
          if (cue !== null) state.cues.push(cue);
          continue;
        }
        this.planClause(instance.member, instance, cueId, dependencies, context, state);
      }
    }
  }

  private planClause(
    member: Extract<SemanticExecutableMember, { type: 'semantic-clause-member' }>,
    instance: TimedMemberInstance,
    cueId: string,
    dependencies: string[],
    context: InstanceContext,
    state: PlannerState,
  ): void {
    const target = materializeParagraphSentenceTarget(
      member.sentence.subject,
      'line',
      context.sourceLine,
      state.baked.units,
      state.baked.lines,
    );
    const reveal = createParagraphUnitRevealPlan(
      target,
      member.sentence,
      state.baked.units,
    );
    const timed = this.timing.lower(member.sentence, reveal);
    state.diagnostics.push(...timed.diagnostics.map((entry) => diagnosticEvent(
      entry,
      'chain-timing',
      context.sourceLine,
    )));
    this.planTimedSentence(timed, state, {
      prefix: cueId,
      sourceLine: context.sourceLine,
      target,
      baseStartSeconds: context.baseStartSeconds + instance.nominalStartSeconds,
      inheritedDependencies: dependencies,
    });
  }

  private planCommand(
    member: SemanticCommandMember,
    instance: TimedMemberInstance,
    cueId: string,
    dependencies: string[],
    context: InstanceContext,
    state: PlannerState,
  ): PlannedParagraphCue | null {
    const args = planArguments(
      member.args,
      state.context,
      state.diagnostics,
      context.sourceLine,
      this.arguments,
    );
    const target = narrowTarget(context.target, instance, state.baked.units);
    const base = {
      id: cueId,
      name: member.name,
      sourceRange: commandRange(member),
      sourceLine: context.sourceLine,
      target,
      arguments: args,
      unitKind: instance.unitKind,
      unitId: instance.unitId,
      nominalStartSeconds: context.baseStartSeconds + instance.nominalStartSeconds,
      dependencyMode: instance.dependencyMode,
      dependsOnCueIds: dependencies,
      blocking: member.blocking,
    };
    const metadata = metadataRecord(member.metadata);

    if (member.family === 'effect') {
      return {
        ...base,
        family: 'effect',
        track: effectTrack(metadata.track),
        effectType: effectType(metadata.type),
        targetType: effectTargetType(metadata.targetType),
        mutexGroup: stringOrNull(metadata.mutexGroup),
        stackable: metadata.stackable === true,
        replayStyle: stringOrNull(metadata.replayStyle),
      };
    }
    if (member.family === 'style') {
      return {
        ...base,
        family: 'style',
        mutexGroup: stringOrNull(metadata.mutexGroup),
        stackable: metadata.stackable === true,
      };
    }
    if (member.family === 'layout') {
      return {
        ...base,
        family: 'layout',
        phase: layoutPhase(metadata.phase),
        role: layoutRole(metadata.role),
      };
    }
    if (member.family === 'stage') {
      return {
        ...base,
        family: 'stage',
        stageKind: stageKind(metadata.kind),
        propertyKey: stringOrNull(metadata.propertyKey),
        modifierBased: metadata.modifierBased === true,
        capturesTween: metadata.capturesTween === true,
      };
    }
    state.diagnostics.push({
      severity: 'error',
      code: 'paragraph-lane-unknown-family',
      subsystem: 'paragraph-lane',
      message: `Command "${member.name}" has no supported lane family.`,
      line: context.sourceLine,
      range: commandRange(member),
      origin: { line: context.sourceLine, range: commandRange(member) },
    });
    return null;
  }
}

function plannedPauseGate(cue: PlannedStageCue): PlannedWaitGate[] {
  if (cue.name !== 'pause') return [];
  const candidate = cue.arguments.named.duration
    ?? cue.arguments.named.d
    ?? cue.arguments.positional[0];
  if (candidate === undefined || typeof candidate !== 'object' || candidate.type !== 'event') {
    return [];
  }
  if (candidate.event === 'signal' && candidate.signal === undefined) return [];
  return [{
    id: `wait:command:${cue.id}`,
    sourceRange: { ...cue.sourceRange },
    sourceLine: cue.sourceLine,
    atSeconds: cue.nominalStartSeconds,
    wait: candidate.event === 'click'
      ? { event: 'click' }
      : { event: 'signal', signal: candidate.signal },
  }];
}

export function planParagraphLanes(
  baked: BakedParagraphPlan,
  context: ParagraphLanePlanningContext,
): CompiledParagraphPlan {
  return new ParagraphLanePlanner().plan(baked, context);
}

function planArguments(
  args: readonly SemanticBoundArgument[],
  context: ParagraphLanePlanningContext,
  diagnostics: DiagnosticEvent[],
  sourceLine: number,
  evaluator: ArgumentValueEvaluator,
): PlannedCommandArguments {
  const positional: RuntimeCommandValue[] = [];
  const named: Record<string, RuntimeCommandValue> = {};
  for (const argument of args) {
    const evaluated = evaluator.evaluate(argument.value, context.state, context.spatial);
    diagnostics.push(...evaluated.diagnostics.map((entry) => diagnosticEvent(
      entry,
      'command-argument',
      sourceLine,
    )));
    if (!evaluated.complete || evaluated.value === null) {
      if (evaluated.diagnostics.length === 0) {
        diagnostics.push({
          severity: 'error',
          code: argument.value.type === 'deferred-value'
            ? 'paragraph-lane-deferred-argument'
            : 'paragraph-lane-invalid-argument',
          subsystem: 'paragraph-lane',
          message: 'Command argument could not be materialized at trigger-record time.',
          line: sourceLine,
          range: { ...argument.source.range },
          origin: { line: sourceLine, range: { ...argument.source.range } },
        });
      }
      continue;
    }
    const value = serializeMaterializedValue(evaluated.value);
    if (value === null) {
      diagnostics.push({
        severity: 'error',
        code: 'paragraph-lane-invalid-argument',
        subsystem: 'paragraph-lane',
        message: 'Command argument remained unresolved after trigger-record evaluation.',
        line: sourceLine,
        range: { ...argument.source.range },
        origin: { line: sourceLine, range: { ...argument.source.range } },
      });
      continue;
    }
    if (argument.name === null) positional.push(value);
    else named[argument.name] = value;
  }
  return { positional, named };
}

function serializeMaterializedValue(
  value: SemanticBoundValue,
): RuntimeCommandValue | null {
  if (value.type === 'number') return value.value;
  if (value.type === 'time') return { type: 'time', seconds: value.seconds };
  if (value.type === 'space') return { type: 'space', value: value.value, unit: value.unit };
  if (value.type === 'angle') return { type: 'angle', degrees: value.value };
  if (value.type === 'rate') {
    return {
      type: 'rate',
      value: value.value,
      numeratorUnit: value.numeratorUnit,
      denominatorUnit: value.denominatorUnit,
    };
  }
  if (value.type === 'relative') {
    return {
      type: 'relative',
      operator: value.operator,
      value: value.value,
      unit: value.unit ?? undefined,
    };
  }
  if (value.type === 'string') return value.value;
  if (value.type === 'bool') return value.value;
  if (value.type === 'event') {
    return {
      type: 'event',
      event: value.event,
      ...(value.signal === undefined ? {} : { signal: value.signal }),
    };
  }
  if (value.type === 'spatial') {
    if (value.value.type === 'point') {
      return { type: 'point', x: value.value.x, y: value.value.y };
    }
    return {
      type: 'domain',
      start: { type: 'point', x: value.value.start.x, y: value.value.start.y },
      end: { type: 'point', x: value.value.end.x, y: value.value.end.y },
    };
  }
  if (value.type === 'range') {
    const from = serializeMaterializedValue(value.from);
    const to = serializeMaterializedValue(value.to);
    return from === null || to === null
      ? null
      : { type: 'range', from, to, durationSeconds: value.durationSeconds };
  }
  return null;
}

function narrowTarget(
  source: ParagraphSentenceTarget,
  instance: TimedMemberInstance,
  units: readonly ParagraphTextUnit[],
): PlannedCommandTarget {
  let unitIds = [...source.unitIds];
  if (instance.unitKind === 'char' && instance.unitId !== null) {
    unitIds = source.unitIds.includes(instance.unitId) ? [instance.unitId] : [];
  } else if (instance.unitKind === 'group' && instance.unitId !== null) {
    const allowed = new Set(source.unitIds);
    unitIds = units
      .filter((unit) => allowed.has(unit.id) && `group:${unit.groupId}` === instance.unitId)
      .map((unit) => unit.id);
  }
  return { kind: source.kind, unitIds };
}

function toLayoutUnit(unit: ParagraphTextUnit): LayoutTextUnit {
  return {
    id: unit.id,
    text: unit.text,
    sourceRange: { ...unit.sourceRange },
    sourceLine: unit.sourceLine,
    lineId: unit.lineId,
    marks: [...unit.marks],
    braceGroupId: unit.braceGroupId,
    groupId: unit.groupId,
    revealAtSeconds: unit.revealAtSeconds,
  };
}

function cueIdFor(prefix: string, instance: TimedMemberInstance): string {
  return `${prefix}:${instance.id}`;
}

function commandRange(member: SemanticCommandMember): SourceRange {
  return { ...member.source.range };
}

function metadataRecord(value: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, unknown>> {
  return value ?? {};
}

function diagnosticEvent(
  entry: { severity: DiagnosticEvent['severity']; message: string; code?: string; range: SourceRange },
  subsystem: string,
  sourceLine: number,
): DiagnosticEvent {
  return {
    severity: entry.severity,
    code: entry.code,
    subsystem,
    message: entry.message,
    line: sourceLine,
    range: { ...entry.range },
    origin: { line: sourceLine, range: { ...entry.range } },
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function effectTrack(value: unknown): PlannedEffectCue['track'] {
  return value === 'entrance' || value === 'behavior' || value === 'instant' || value === 'timing'
    ? value
    : 'unknown';
}

function effectType(value: unknown): PlannedEffectCue['effectType'] {
  return value === 'behavior' || value === 'style' || value === 'filter' || value === 'action' || value === 'anim'
    ? value
    : 'unknown';
}

function effectTargetType(value: unknown): PlannedEffectCue['targetType'] {
  return value === 'char' || value === 'group' || value === 'both' ? value : 'unknown';
}

function layoutPhase(value: unknown): PlannedLayoutCommand['phase'] {
  return value === 'operator' || value === 'expander' ? value : 'unknown';
}

function layoutRole(value: unknown): PlannedLayoutCommand['role'] {
  return value === 'anchor'
    || value === 'cursor'
    || value === 'flow'
    || value === 'display-offset'
    || value === 'internal'
    ? value
    : 'unknown';
}

function stageKind(value: unknown): PlannedStageCue['stageKind'] {
  return value === 'scene'
    || value === 'camera'
    || value === 'offset'
    || value === 'modifier'
    || value === 'playback'
    || value === 'background'
    ? value
    : 'unknown';
}

function isEffectCue(cue: PlannedParagraphCue): cue is PlannedEffectCue {
  return cue.family === 'effect';
}

function isStyleCue(cue: PlannedParagraphCue): cue is PlannedStyleCue {
  return cue.family === 'style';
}

function isLayoutCue(cue: PlannedParagraphCue): cue is PlannedLayoutCommand {
  return cue.family === 'layout';
}

function isStageCue(cue: PlannedParagraphCue): cue is PlannedStageCue {
  return cue.family === 'stage';
}
