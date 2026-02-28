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

export interface LayoutCommand {
  isCommand: true;
  type: LayoutCommandType;
  params: any;
}

export interface LayoutItem {
  isCommand?: false; // 区分标志
  width: number;
  height: number;
  [key: string]: any;
}
export type LayoutStream = (LayoutItem | LayoutCommand)[];

export type MarkerMap = Map<string, { x: number; y: number }>;
// 排版光标的状态
export interface CursorState {
  x: number;
  y: number;
}

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
  options: {
    maxWidth: number;
    lineHeight: number;
    fontSize: number;
    letterSpacing: number;
    baseOffset: CursorState; // 相对布局根节点的绝对偏移
  };
}

// 排版指令算子：直接接收上下文并修改它
export type LayoutOperator = (context: LayoutContext, params: any) => void;
