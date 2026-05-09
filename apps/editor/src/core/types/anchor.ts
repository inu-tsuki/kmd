export type ReservedAnchorScope = "line" | "prev" | "next";
export type AnchorPoint = "start" | "mid" | "end";

export type AnchorRef =
  | { type: "named"; name: string }
  | { type: "reserved"; scope: ReservedAnchorScope; point: AnchorPoint };

export type LifecycleAnchor =
  | "paragraph_start"
  | "paragraph_end"
  | "line_break"
  | "token_start"
  | "token_end"
  | "group_end"
  | "segment_entry"
  | "segment_exit";
