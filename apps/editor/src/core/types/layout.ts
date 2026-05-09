import type { DiagnosticEvent } from "./diagnostics";

export interface BoundsEstimate {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface LinePlan {
  index: number;
  baselineY: number;
  hasInFlow: boolean;
  bounds: (BoundsEstimate & { midX: number; midY: number }) | null;
}

export interface AnchorState<TMarker = unknown> {
  markers: Map<string, TMarker>;
  writtenKeys: Set<string>;
}

export interface LayoutPreflightResult<TMarker = unknown> {
  lines: LinePlan[];
  anchors: AnchorState<TMarker>;
  diagnostics: DiagnosticEvent[];
  estimatedBounds: BoundsEstimate;
}
