import type {
  AnchorState as SharedAnchorState,
  DiagnosticEvent,
  LayoutPreflightResult as SharedLayoutPreflightResult,
} from "../types";
export type { LinePlan } from "../types";

export type LayoutCommandType =
  | "mark"
  | "markStart"
  | "markMiddle"
  | "markEnd"
  | "markLineStart"
  | "markLineMiddle"
  | "markLineEnd"
  | "markChar"
  | "goto"
  | "resume"
  | "offset"
  | "offsetX"
  | "offsetY"
  | "set"
  | "group"
  | "right"
  | "left"
  | "down"
  | "up"
  | "lineStart"
  | "lineEnd"
  | "moveChar"
  | "pushDisplayOffset"
  | "popDisplayOffset"
  | "flow";

export type LayoutCommandPhase = "operator" | "expander";
export type LayoutCommandRole =
  | "anchor"
  | "cursor"
  | "flow"
  | "display-offset"
  | "internal";

export interface LayoutCommandMetadata {
  name: string;
  subsystem: "layout";
  phase: LayoutCommandPhase;
  role: LayoutCommandRole;
  affectsFlow?: boolean;
  affectsDisplay?: boolean;
  writesMarkers?: boolean;
  readsMarkers?: boolean;
  internal?: boolean;
  description?: string;
}

export type LayoutCommandMetadataMap = Record<string, LayoutCommandMetadata>;

// Token 的几何上下文，用于扩展器计算
export interface TokenContext {
  width: number;
  charWidths: number[];
  letterSpacing: number;
  fontSize: number;
  lineHeight: number;
  markers: MarkerMap; // 新增：支持变量查询
}

// 布局扩展器：在构建流时将高级指令展开为基础指令
export type LayoutExpander = (params: any, ctx: TokenContext) => {
  pre?: LayoutCommand[];
  post?: LayoutCommand[];
};

// 预设标记名称常量
export const ReservedMarkers = {
  PREV_START: "prev.start",
  PREV_MID: "prev.mid",
  PREV_END: "prev.end",
  NEXT_START: "next.start",
  NEXT_MID: "next.mid",
  NEXT_END: "next.end",
};

export type ReservedAnchorScope = "prev" | "line" | "next";
export type ReservedAnchorPoint = "start" | "mid" | "end";
export type ReservedAnchorName = `${ReservedAnchorScope}.${ReservedAnchorPoint}`;

export interface LayoutCommand {
  isCommand: true;
  type: LayoutCommandType;
  params: any;
}

export interface LayoutGlyphPayload {
  char?: {
    text?: string;
    style?: {
      fontSize?: unknown;
    };
  } | null;
  fontSize?: number;
  ascent?: number;
  descent?: number;
  [key: string]: any;
}

export interface LayoutItem<TGlyph extends LayoutGlyphPayload = LayoutGlyphPayload> {
  isCommand?: false; // 区分标志
  width: number;
  height: number;
  charData?: TGlyph;
}
export type LayoutStream = (LayoutItem | LayoutCommand)[];

export type MarkerMap = Map<string, { x: number; y: number }>;
// 排版光标的状态
export interface CursorState {
  x: number;
  y: number;
}

export interface LayoutEngineOptions {
  maxWidth: number;
  lineHeight: number;
  fontSize: number;
  indent: number;
  align: "left" | "center" | "right";
  letterSpacing: number;
  externalMarkers: MarkerMap;
  baseOffset: CursorState;
}

export type AnchorState = SharedAnchorState<CursorState>;
export type LayoutPreflightResult = SharedLayoutPreflightResult<CursorState>;
export type LayoutDiagnostics = DiagnosticEvent[];

// 排版结果项
export interface LayoutResult {
  item: LayoutItem;
  x: number;
  y: number;
  inFlow: boolean; // 是否在常规流中（影响高度计算）
  stepDistance?: number; // 【新增】该字符排版导致的光标步进值
  displayOffsetX?: number; // 视觉偏移 X（不影响排版流）
  displayOffsetY?: number; // 视觉偏移 Y（不影响排版流）
}

// 排版审计记录
export interface LayoutAuditRecord {
  text: string;
  local: CursorState;
  global: CursorState;
  inFlow: boolean;
  isFlowBroken: boolean;
  justMoved: boolean;
}

// 排版引擎的运行上下文
export interface LayoutContext {
  activeCursor: CursorState;
  isFlowBroken: boolean; // 是否已脱离常规排版流（高度不再计入）
  justMoved: boolean;    // 标记刚刚执行过定位指令，用于跳过一次自动换行
  markers: Map<string, CursorState>;
  touchedMarkers: string[]; // 当前行内设置过的标记名，用于对齐修正
  displayOffset: CursorState;         // 当前视觉偏移（不影响排版流），初始 {0,0}
  _displayOffsetStack: CursorState[]; // push/pop 嵌套栈
  baselineY: number;                  // 当前行基线 Y（从 TextLayoutEngine 局部变量提升）
  options: Pick<LayoutEngineOptions, "maxWidth" | "lineHeight" | "fontSize" | "letterSpacing" | "baseOffset">;
}

// 排版指令算子：直接接收上下文并修改它
export type LayoutOperator = (context: LayoutContext, params: any) => void;
