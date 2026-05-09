import type { AnchorRef, LifecycleAnchor } from "./anchor";
import type { SourceOrigin } from "./diagnostics";

export type CueFamily = "layout" | "playback" | "effect" | "stage" | "state" | "lifecycle";
export type CueOrigin = "authored" | "lowered" | "generated";
export type BlockingPolicy = boolean;
export type ConcurrencyPolicy = "serial" | "parallel";

export type TargetRef =
  | { kind: "char"; index?: number; tokenIndex?: number }
  | { kind: "token"; tokenIndex: number }
  | { kind: "group"; groupId: number }
  | { kind: "paragraph" }
  | { kind: "container"; name?: string };

export interface BaseCue {
  id?: string;
  family: CueFamily;
  kind: string;
  origin: CueOrigin;
  anchor: LifecycleAnchor | AnchorRef;
  target?: TargetRef;
  blocking?: BlockingPolicy;
  concurrency?: ConcurrencyPolicy;
  sourceOrigin?: SourceOrigin;
  payload?: Record<string, unknown>;
}
