import type { AnchorRef, LifecycleAnchor } from "./anchor";
import type { BaseCue, BlockingPolicy, TargetRef } from "./cue";
import type { DiagnosticEvent, SourceOrigin } from "./diagnostics";

export type ChainExecutionMode =
  | "group_sync"
  | "char_stagger"
  | "char_tween"
  | "container_only"
  | "graph_gate";

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
