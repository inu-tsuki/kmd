import type {
  LayoutCommandMetadataMap,
  LayoutOperator,
  LayoutContext,
  CursorState,
} from "./types";

const toGlobal = (ctx: LayoutContext, local: CursorState): CursorState => ({
  x: local.x + ctx.options.baseOffset.x,
  y: local.y + ctx.options.baseOffset.y,
});

const toLocal = (ctx: LayoutContext, global: CursorState): CursorState => ({
  x: global.x - ctx.options.baseOffset.x,
  y: global.y - ctx.options.baseOffset.y,
});

const moveCursor = (ctx: LayoutContext, val: any, axis: 'x' | 'y', mode: 'abs' | 'rel') => {
  if (val === undefined || val === null || val === "") return;

  const target = ctx.markers.get(String(val));
  if (target) {
    const local = toLocal(ctx, target);
    ctx.activeCursor[axis] = local[axis];
    ctx.justMoved = true;
  } else {
    const num = Number(val);
    if (!isNaN(num) && isFinite(num)) {
      if (mode === 'abs') {
        // 核心修正：以屏幕中心为原点的设计坐标转换 (960, 540)
        const originOffset = axis === 'x' ? 960 : 540;
        const designCoord = num + originOffset;
        const localVal = designCoord - ctx.options.baseOffset[axis];
        ctx.activeCursor[axis] = localVal;
      } else {
        ctx.activeCursor[axis] += num;
      }
      ctx.justMoved = true;
    }
  }
};

export const mark: LayoutOperator = (ctx, p) => {
  let name = p.name || p.val || p[0] || p["0"];
  let dx = 0; let dy = 0;

  if (p[2] !== undefined || p["2"] !== undefined) {
    dx = Number(p[0] || p["0"] || 0);
    dy = Number(p[1] || p["1"] || 0);
    name = p[2] || p["2"];
  } else if (p[1] !== undefined) {
    dx = Number(p[0] || 0);
    name = p[1];
  }

  if (name) {
    const label = String(name);
    const globalPos = toGlobal(ctx, {
      x: ctx.activeCursor.x + ctx.displayOffset.x + dx,
      y: ctx.activeCursor.y + ctx.displayOffset.y + dy
    });
    ctx.markers.set(label, globalPos);
    ctx.touchedMarkers.push(label);
  }
};

export const markStart: LayoutOperator = (ctx, p) => {
    const name = p.name || p.val || p[0] || p["0"];
    if (name) {
        const globalPos = toGlobal(ctx, { x: 0, y: ctx.activeCursor.y });
        ctx.markers.set(String(name), globalPos);
        ctx.touchedMarkers.push(String(name));
    }
};

export const markEnd: LayoutOperator = (ctx, p) => {
    const name = p.name || p.val || p[0] || p["0"];
    if (name) {
        const globalPos = toGlobal(ctx, { x: ctx.options.maxWidth, y: ctx.activeCursor.y });
        ctx.markers.set(String(name), globalPos);
        ctx.touchedMarkers.push(String(name));
    }
};

export const goto: LayoutOperator = (ctx, p) => {
  ctx.isFlowBroken = true;
  ctx.justMoved = true;
  
  if (p[0] !== undefined && p[1] !== undefined) {
    moveCursor(ctx, p[0], 'x', 'abs');
    moveCursor(ctx, p[1], 'y', 'abs');
  } else {
    const val = p.val !== undefined ? p.val : p[0];
    const target = ctx.markers.get(String(val));
    if (target) {
        const local = toLocal(ctx, target);
        ctx.activeCursor.x = local.x;
        ctx.activeCursor.y = local.y;
    } else {
        moveCursor(ctx, val, 'x', 'abs');
    }
  }
};

export const offset: LayoutOperator = (ctx, p) => {
  if (p[0] !== undefined && p[1] !== undefined) {
    moveCursor(ctx, p[0], 'x', 'rel');
    moveCursor(ctx, p[1], 'y', 'rel');
  } else {
    const val = p.val !== undefined ? p.val : p[0];
    const target = ctx.markers.get(String(val));
    if (target) {
      const local = toLocal(ctx, target);
      ctx.activeCursor = local;
      ctx.justMoved = true;
    } else {
      moveCursor(ctx, val, 'x', 'rel');
    }
  }
};

export const left: LayoutOperator = (ctx, p) => {
  const val = p.val !== undefined ? p.val : (p[0] !== undefined ? p[0] : 10);
  const target = ctx.markers.get(String(val));
  if (target) {
    const local = toLocal(ctx, target);
    ctx.activeCursor.x = local.x;
    ctx.justMoved = true;
  } else {
    moveCursor(ctx, -Number(val), 'x', 'rel');
  }
};

export const up: LayoutOperator = (ctx, p) => {
  const val = p.val !== undefined ? p.val : (p[0] !== undefined ? p[0] : 10);
  const target = ctx.markers.get(String(val));
  if (target) {
    const local = toLocal(ctx, target);
    ctx.activeCursor.y = local.y;
    ctx.justMoved = true;
  } else {
    moveCursor(ctx, -Number(val), 'y', 'rel');
  }
};

export const right: LayoutOperator = (ctx, p) => moveCursor(ctx, p.val !== undefined ? p.val : (p[0] !== undefined ? p[0] : 10), 'x', 'rel');
export const down: LayoutOperator = (ctx, p) => moveCursor(ctx, p.val !== undefined ? p.val : (p[0] !== undefined ? p[0] : 10), 'y', 'rel');

// ─── 三层布局指令体系：视觉偏移 + 排版流控制 ───

/** 压栈当前 displayOffset 并叠加新偏移（per-token 视觉偏移） */
export const pushDisplayOffset: LayoutOperator = (ctx, p) => {
  ctx._displayOffsetStack.push({ ...ctx.displayOffset });
  if (p[0] !== undefined) {
    const target = ctx.markers.get(String(p[0]));
    if (target) {
      const local = toLocal(ctx, target);
      ctx.displayOffset = { ...ctx.displayOffset, x: ctx.displayOffset.x + (local.x - ctx.activeCursor.x) };
    } else {
      const num = Number(p[0]);
      if (!isNaN(num) && isFinite(num)) ctx.displayOffset = { ...ctx.displayOffset, x: ctx.displayOffset.x + num };
    }
  }
  if (p[1] !== undefined) {
    const target = ctx.markers.get(String(p[1]));
    if (target) {
      const local = toLocal(ctx, target);
      ctx.displayOffset = { ...ctx.displayOffset, y: ctx.displayOffset.y + (local.y - ctx.activeCursor.y) };
    } else {
      const num = Number(p[1]);
      if (!isNaN(num) && isFinite(num)) ctx.displayOffset = { ...ctx.displayOffset, y: ctx.displayOffset.y + num };
    }
  }
};

/** 弹栈恢复上一层 displayOffset */
export const popDisplayOffset: LayoutOperator = (ctx, _p) => {
  if (ctx._displayOffsetStack.length > 0) {
    ctx.displayOffset = ctx._displayOffsetStack.pop()!;
  } else {
    ctx.displayOffset = { x: 0, y: 0 };
  }
};

/** 永久排版流控制 — 修改 cursor + baselineY，不设 isFlowBroken */
export const flow: LayoutOperator = (ctx, p) => {
  ctx.justMoved = true;
  if (p[0] !== undefined && p[1] !== undefined) {
    moveCursor(ctx, p[0], 'x', 'abs');
    moveCursor(ctx, p[1], 'y', 'abs');
    ctx.baselineY = ctx.activeCursor.y;
  } else {
    const val = p.val !== undefined ? p.val : p[0];
    const target = ctx.markers.get(String(val));
    if (target) {
      const local = toLocal(ctx, target);
      ctx.activeCursor.x = local.x;
      ctx.activeCursor.y = local.y;
      ctx.baselineY = local.y;
      ctx.justMoved = true;
    } else {
      moveCursor(ctx, val, 'x', 'abs');
    }
  }
};

export const layoutPresetMetadata = {
  mark: {
    name: "mark",
    subsystem: "layout",
    phase: "operator",
    role: "anchor",
    writesMarkers: true,
    affectsFlow: false,
    affectsDisplay: false,
    description: "Writes a marker at the current cursor plus optional offset.",
  },
  markStart: {
    name: "markStart",
    subsystem: "layout",
    phase: "operator",
    role: "anchor",
    writesMarkers: true,
    affectsFlow: false,
    affectsDisplay: false,
  },
  markEnd: {
    name: "markEnd",
    subsystem: "layout",
    phase: "operator",
    role: "anchor",
    writesMarkers: true,
    affectsFlow: false,
    affectsDisplay: false,
  },
  goto: {
    name: "goto",
    subsystem: "layout",
    phase: "operator",
    role: "cursor",
    readsMarkers: true,
    affectsFlow: true,
    affectsDisplay: true,
    description: "Moves the cursor and breaks normal flow.",
  },
  offset: {
    name: "offset",
    subsystem: "layout",
    phase: "operator",
    role: "cursor",
    readsMarkers: true,
    affectsFlow: true,
    affectsDisplay: true,
    description: "Moves the cursor relatively in block/operator scope.",
  },
  left: {
    name: "left",
    subsystem: "layout",
    phase: "operator",
    role: "cursor",
    readsMarkers: true,
    affectsFlow: true,
    affectsDisplay: true,
  },
  up: {
    name: "up",
    subsystem: "layout",
    phase: "operator",
    role: "cursor",
    readsMarkers: true,
    affectsFlow: true,
    affectsDisplay: true,
  },
  right: {
    name: "right",
    subsystem: "layout",
    phase: "operator",
    role: "cursor",
    affectsFlow: true,
    affectsDisplay: true,
  },
  down: {
    name: "down",
    subsystem: "layout",
    phase: "operator",
    role: "cursor",
    affectsFlow: true,
    affectsDisplay: true,
  },
  pushDisplayOffset: {
    name: "pushDisplayOffset",
    subsystem: "layout",
    phase: "operator",
    role: "display-offset",
    readsMarkers: true,
    affectsFlow: false,
    affectsDisplay: true,
    internal: true,
  },
  popDisplayOffset: {
    name: "popDisplayOffset",
    subsystem: "layout",
    phase: "operator",
    role: "display-offset",
    affectsFlow: false,
    affectsDisplay: true,
    internal: true,
  },
  flow: {
    name: "flow",
    subsystem: "layout",
    phase: "operator",
    role: "flow",
    readsMarkers: true,
    affectsFlow: true,
    affectsDisplay: true,
    description: "Moves the cursor and keeps subsequent layout in the new flow.",
  },
} satisfies LayoutCommandMetadataMap;
