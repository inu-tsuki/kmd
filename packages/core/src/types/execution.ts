import type { AnchorRef, LifecycleAnchor } from "./anchor";
import type { BaseCue, BlockingPolicy, TargetRef } from "./cue";
import type { DiagnosticEvent, SourceOrigin } from "./diagnostics";

export type ChainExecutionMode =
  | "group_sync"
  | "char_stagger"
  | "char_tween"
  | "container_only"
  | "graph_gate";

/** execution plan 已归一化的 cursor 时序输入。 */
export interface ExecutionTiming {
  speedMultiplier?: number;
  delayOverride?: number;
  advanceLevel?: string;
}

export interface ChainExecutionPlan {
  id: string;
  mode: ChainExecutionMode;
  anchor: LifecycleAnchor | AnchorRef;
  target: TargetRef;
  blocking?: BlockingPolicy;
  steps: BaseCue[];
  sourceOrigin?: SourceOrigin;
}

export interface ParagraphExecutionPlan<TItem = unknown, TToken = unknown> {
  items: TItem[];
  tokens: TToken[];
  chainPlans: ChainExecutionPlan[];
  diagnostics?: DiagnosticEvent[];
}
