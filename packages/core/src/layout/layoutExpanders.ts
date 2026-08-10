import type {
  LayoutCommandMetadataMap,
  LayoutExpander,
  TokenContext,
} from "./types";

/**
 * 通用单位与变量解析工具 (不解析 Marker，留给 Operator 运行时处理)
 */
const resolveValue = (val: any, ctx: TokenContext, axis: 'x' | 'y'): any => {
  if (typeof val !== 'string' || !val) return val;

  // 1. 变量引用解析 (保持 literal 属性以便 moveCursor 加 960)
  const varMatch = val.match(/^var\.([\w-]+)$/);
  if (varMatch) {
    const v = ctx.markers.get(`var.${varMatch[1]}`);
    if (v) return v.x; 
  }

  // 2. 解析几何单位 (self, char, line)
  const unitMatch = val.match(/^([\d\.\-]+)(self|char|line)$/);
  if (unitMatch) {
    const num = parseFloat(unitMatch[1]!);
    const unit = unitMatch[2];
    switch (unit) {
      case 'self': {
        const tracking = ctx.fontSize * 0.02;
        const advanceWidth = ctx.width + ctx.charWidths.length * tracking + ctx.letterSpacing;
        return axis === 'x' ? num * advanceWidth : num * ctx.fontSize;
      }
      case 'char': return num * ctx.fontSize;
      case 'line': return num * ctx.lineHeight;
    }
  }
  
  // 3. 预留标记名、三段式坐标名等，原样返回字符串
  return val;
};

/**
 * 快捷标记扩展器
 */
export const markStart: LayoutExpander = (p) => {
  const name = p.name || p.label || p.val || p[0];
  return { pre: [{ type: "mark", params: { 0: 0, 1: 0, 2: name }, isCommand: true }] };
};

export const markEnd: LayoutExpander = (p, _ctx) => {
  const name = p.name || p.label || p.val || p[0];
  // 标记在文字结束处 — 使用 post 使其在 cursor 推进后执行，与 prev.end 一致（advance width）
  return { post: [{ type: "mark", params: { 0: 0, 1: 0, 2: name }, isCommand: true }] };
};

export const markMiddle: LayoutExpander = (p, ctx) => {
  const name = p.name || p.label || p.val || p[0];
  return { pre: [{ type: "mark", params: { 0: ctx.width / 2, 1: 0, 2: name }, isCommand: true }] };
};

export const markChar: LayoutExpander = (p, ctx) => {
  const charIdx = Number(p.index || p[0] || 0);
  const label = p.label || p[1] || p.val;
  let dx = 0;
  for (let i = 0; i < Math.min(charIdx, ctx.charWidths.length); i++) {
    dx += ctx.charWidths[i]! + ctx.letterSpacing;
  }
  return { pre: [{ type: "mark", params: { 0: dx, 1: 0, 2: label }, isCommand: true }] };
};

/**
 * 视觉偏移扩展器 — per-token 作用域，push/pop 自动回收
 * Block-level 路径（[.up(50)]）跳过 expander 直接走 operator，语义为永久 cursor 修改
 */
export const left: LayoutExpander = (p, ctx) => ({
  pre: [{ type: "pushDisplayOffset", params: { 0: -(resolveValue(p.val || p[0], ctx, 'x') as number), 1: 0 }, isCommand: true }],
  post: [{ type: "popDisplayOffset", params: {}, isCommand: true }]
});

export const right: LayoutExpander = (p, ctx) => ({
  pre: [{ type: "pushDisplayOffset", params: { 0: resolveValue(p.val || p[0], ctx, 'x'), 1: 0 }, isCommand: true }],
  post: [{ type: "popDisplayOffset", params: {}, isCommand: true }]
});

export const up: LayoutExpander = (p, ctx) => ({
  pre: [{ type: "pushDisplayOffset", params: { 0: 0, 1: -(resolveValue(p.val || p[0], ctx, 'y') as number) }, isCommand: true }],
  post: [{ type: "popDisplayOffset", params: {}, isCommand: true }]
});

export const down: LayoutExpander = (p, ctx) => ({
  pre: [{ type: "pushDisplayOffset", params: { 0: 0, 1: resolveValue(p.val || p[0], ctx, 'y') }, isCommand: true }],
  post: [{ type: "popDisplayOffset", params: {}, isCommand: true }]
});

export const offset: LayoutExpander = (p, ctx) => {
  const params: any = {};
  if (p[0] !== undefined) params[0] = resolveValue(p[0], ctx, 'x');
  if (p[1] !== undefined) params[1] = resolveValue(p[1], ctx, 'y');
  return {
    pre: [{ type: "pushDisplayOffset", params, isCommand: true }],
    post: [{ type: "popDisplayOffset", params: {}, isCommand: true }]
  };
};

/**
 * 视觉跳转 — goto（不改，保持 isFlowBroken 语义）
 */
export const goto: LayoutExpander = (p, ctx) => {
    const params: any = { ...p };
    if (p[0] !== undefined) params[0] = resolveValue(p[0], ctx, 'x');
    if (p[1] !== undefined) params[1] = resolveValue(p[1], ctx, 'y');
    return { pre: [{ type: "goto", params, isCommand: true }] };
};

/**
 * 排版流控制 — 永久改变排版基线，不设 isFlowBroken
 */
export const flow: LayoutExpander = (p, ctx) => {
  const params: any = { ...p };
  if (p[0] !== undefined) params[0] = resolveValue(p[0], ctx, 'x');
  if (p[1] !== undefined) params[1] = resolveValue(p[1], ctx, 'y');
  return { pre: [{ type: "flow", params, isCommand: true }] };
};

export const layoutExpanderMetadata = {
  markStart: {
    name: "markStart",
    subsystem: "layout",
    phase: "expander",
    role: "anchor",
    writesMarkers: true,
    affectsFlow: false,
    affectsDisplay: false,
    description: "Expands token-scoped markStart sugar into a marker write.",
  },
  markEnd: {
    name: "markEnd",
    subsystem: "layout",
    phase: "expander",
    role: "anchor",
    writesMarkers: true,
    affectsFlow: false,
    affectsDisplay: false,
  },
  markMiddle: {
    name: "markMiddle",
    subsystem: "layout",
    phase: "expander",
    role: "anchor",
    writesMarkers: true,
    affectsFlow: false,
    affectsDisplay: false,
  },
  markChar: {
    name: "markChar",
    subsystem: "layout",
    phase: "expander",
    role: "anchor",
    writesMarkers: true,
    affectsFlow: false,
    affectsDisplay: false,
  },
  left: {
    name: "left",
    subsystem: "layout",
    phase: "expander",
    role: "display-offset",
    readsMarkers: true,
    affectsFlow: false,
    affectsDisplay: true,
    description: "Token-scoped visual offset; expands to push/pop display offset.",
  },
  right: {
    name: "right",
    subsystem: "layout",
    phase: "expander",
    role: "display-offset",
    affectsFlow: false,
    affectsDisplay: true,
  },
  up: {
    name: "up",
    subsystem: "layout",
    phase: "expander",
    role: "display-offset",
    affectsFlow: false,
    affectsDisplay: true,
  },
  down: {
    name: "down",
    subsystem: "layout",
    phase: "expander",
    role: "display-offset",
    affectsFlow: false,
    affectsDisplay: true,
  },
  offset: {
    name: "offset",
    subsystem: "layout",
    phase: "expander",
    role: "display-offset",
    readsMarkers: true,
    affectsFlow: false,
    affectsDisplay: true,
  },
  goto: {
    name: "goto",
    subsystem: "layout",
    phase: "expander",
    role: "cursor",
    readsMarkers: true,
    affectsFlow: true,
    affectsDisplay: true,
  },
  flow: {
    name: "flow",
    subsystem: "layout",
    phase: "expander",
    role: "flow",
    readsMarkers: true,
    affectsFlow: true,
    affectsDisplay: true,
  },
} satisfies LayoutCommandMetadataMap;
