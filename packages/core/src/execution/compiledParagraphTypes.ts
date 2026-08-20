import type { DiagnosticEvent, SourceRange } from '../types/diagnostics';
import type { PlannedWaitGate } from './waitGateTypes';

export type RenderOptionValue = number | string | boolean;
export type TextUnitMark = 'bold' | 'italic';
export type RuntimeGranularity = 'char' | 'group' | 'block';

export interface LayoutTextUnit {
  id: string;
  text: string;
  sourceRange: SourceRange;
  sourceLine: number;
  lineId: string;
  marks: TextUnitMark[];
  braceGroupId: string | null;
  groupId: string;
  revealAtSeconds: number;
}

export interface RuntimeTimeValue {
  type: 'time';
  seconds: number;
}

export interface RuntimeSpaceValue {
  type: 'space';
  value: number;
  unit: 'char' | 'line' | 'self' | 'px';
}

export interface RuntimeAngleValue {
  type: 'angle';
  degrees: number;
}

export interface RuntimeRateValue {
  type: 'rate';
  value: number;
  numeratorUnit?: 'deg';
  denominatorUnit: 'char' | 'line' | 'self' | 'px';
}

export interface RuntimeRelativeValue {
  type: 'relative';
  operator: '+=' | '-=';
  value: number;
  unit?: 'number' | 's' | 'ms' | 'char' | 'line' | 'self' | 'px' | 'deg';
}

export interface RuntimeEventValue {
  type: 'event';
  event: 'click' | 'signal';
  signal?: string;
}

export interface RuntimePointValue {
  type: 'point';
  x: number;
  y: number;
}

export interface RuntimeDomainValue {
  type: 'domain';
  start: RuntimePointValue;
  end: RuntimePointValue;
}

export interface RuntimeRangeValue {
  type: 'range';
  from: RuntimeCommandValue;
  to: RuntimeCommandValue;
  durationSeconds: number | null;
}

export type RuntimeCommandValue =
  | number
  | string
  | boolean
  | RuntimeTimeValue
  | RuntimeSpaceValue
  | RuntimeAngleValue
  | RuntimeRateValue
  | RuntimeRelativeValue
  | RuntimeEventValue
  | RuntimePointValue
  | RuntimeDomainValue
  | RuntimeRangeValue;

export interface PlannedCommandArguments {
  positional: RuntimeCommandValue[];
  named: Record<string, RuntimeCommandValue>;
}

export interface PlannedCommandTarget {
  kind:
    | 'text-domain'
    | 'text-point'
    | 'background'
    | 'stage'
    | 'layout-flow'
    | 'state'
    | 'definition'
    | 'unresolved';
  unitIds: string[];
}

interface PlannedCommandCueBase {
  id: string;
  name: string;
  sourceRange: SourceRange;
  sourceLine: number;
  target: PlannedCommandTarget;
  arguments: PlannedCommandArguments;
  unitKind: RuntimeGranularity | null;
  unitId: string | null;
  nominalStartSeconds: number;
  dependencyMode: 'none' | 'unit' | 'beat';
  dependsOnCueIds: string[];
  blocking: boolean;
}

export interface PlannedEffectCue extends PlannedCommandCueBase {
  family: 'effect';
  track: 'entrance' | 'behavior' | 'instant' | 'timing' | 'unknown';
  effectType: 'behavior' | 'style' | 'filter' | 'action' | 'anim' | 'unknown';
  targetType: 'char' | 'group' | 'both' | 'unknown';
  mutexGroup: string | null;
  stackable: boolean;
  replayStyle: string | null;
}

export interface PlannedStyleCue extends PlannedCommandCueBase {
  family: 'style';
  mutexGroup: string | null;
  stackable: boolean;
}

export interface PlannedLayoutCommand extends PlannedCommandCueBase {
  family: 'layout';
  phase: 'operator' | 'expander' | 'unknown';
  role: 'anchor' | 'cursor' | 'flow' | 'display-offset' | 'internal' | 'unknown';
}

export interface PlannedStageCue extends PlannedCommandCueBase {
  family: 'stage';
  stageKind: 'scene' | 'camera' | 'offset' | 'modifier' | 'playback' | 'background' | 'unknown';
  propertyKey: string | null;
  modifierBased: boolean;
  capturesTween: boolean;
}

export type PlannedParagraphCue =
  | PlannedEffectCue
  | PlannedStyleCue
  | PlannedLayoutCommand
  | PlannedStageCue;

export interface ParagraphLayoutPlan {
  units: LayoutTextUnit[];
  commands: PlannedLayoutCommand[];
}

export interface CompiledParagraphExecutionPlan {
  cues: PlannedParagraphCue[];
  effects: PlannedEffectCue[];
  styles: PlannedStyleCue[];
  stageCues: PlannedStageCue[];
  diagnostics: DiagnosticEvent[];
}

export interface CompiledParagraphPlan {
  paragraphId: string;
  sourceRange: SourceRange;
  options: Readonly<Record<string, RenderOptionValue>>;
  present: boolean | null;
  layout: ParagraphLayoutPlan;
  execution: CompiledParagraphExecutionPlan;
  waitGates: readonly PlannedWaitGate[];
  diagnostics: DiagnosticEvent[];
  complete: boolean;
}
