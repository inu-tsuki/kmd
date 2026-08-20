import type { SegmentGraphWaitGate } from '../graph/types';
import type { SourceRange } from '../types/diagnostics';

/** Event pause captured before GSAP/Pixi resources are created. */
export interface PlannedWaitGate {
  readonly id: string;
  readonly sourceRange: SourceRange;
  readonly sourceLine: number;
  readonly atSeconds: number;
  readonly wait: SegmentGraphWaitGate;
}

export interface MaterializedWaitGate extends Omit<PlannedWaitGate, 'atSeconds'> {
  readonly timePosition: number;
}
