import { KineticChar } from "../../KineticChar";
import { Container } from "pixi.js";
import type { EffectFunction, EffectMetadata } from "../types";

function defineEffect(fn: EffectFunction, meta: EffectMetadata) {
  return { fn, meta };
}

// 边框 (Border)
const _border: EffectFunction = (target, params = {}) => {
  const t = target as any;
  if (!t.getContentBounds || !t.getGraphicsLayer) {
    console.warn(
      "[Effect] border effect requires object with geometry methods",
    );
    return;
  }
  const color = params.color || 0xff0000;
  const width = params.width || 2;
  const padding = params.padding || 5;
  const bounds = t.getContentBounds();
  const g = t.getGraphicsLayer("border");
  g.clear();
  // 补 bounds 原点：getContentBounds() 对 align:center/right 或 indent>0 返回非零 x/y（基于段落 layout
  // 坐标，addChars 死代码后不再 token-local 归零），原画在 (-pad,-pad) 会偏在内容左侧。以 bounds.x/y 起画。
  g.rect(
    bounds.x - padding,
    bounds.y - padding,
    bounds.width + padding * 2,
    bounds.height + padding * 2,
  );
  g.stroke({ width, color });
};
export const border = defineEffect(_border, {
  type: "style",
  track: "instant",
  targetType: "group",
  mutexGroup: "border",
});

// 底框 (Box) — 元素级圆角矩形背景（Graphics 画法，非 DIP filter / 非 stage bg 命令）。
// 原名 `bg` 与 stage 命令 `bg`（setBackgroundColor / bg(src) 背景图）撞车——EffectProcessor
// classifyCommand 的 `isStage = stageManager.has(name) && !effectManager.has(name)` 因同名
// effectManager.has("bg") 恒真，stage bg 永远不被路由。改名 `box` 消除碰撞。
const _box: EffectFunction = (target, params = {}) => {
  const t = target as any;
  if (!t.getContentBounds || !t.getGraphicsLayer) {
    console.warn("[Effect] box effect requires object with geometry methods");
    return;
  }
  const color = params.color || 0x333333;
  const alpha = params.alpha || 1.0;
  const padding = params.padding || 5;
  const radius = params.radius || 4;
  const bounds = t.getContentBounds();
  const g = t.getGraphicsLayer("box");
  g.clear();
  // 补 bounds 原点（见 _border 同理注释）：align:center/right 或 indent>0 时 bounds.x/y 非零。
  g.roundRect(
    bounds.x - padding,
    bounds.y - padding,
    bounds.width + padding * 2,
    bounds.height + padding * 2,
    radius,
  );
  g.fill({ color, alpha });
};
export const box = defineEffect(_box, {
  type: "style",
  track: "instant",
  targetType: "group",
  mutexGroup: "box",
});

// 变暗 (Dim) — 通过 addModifier/属性恢复设置 alpha
// char 级：addModifier 返回 { alpha }，syncProperties 每帧 finalAlpha *= alpha，removeModifier 后归零。
// 容器级：一次性写 target.alpha = alpha，返回 { restoreProps } 让 cleanup 记录原始 alpha、
//   seek 回退时 clearBehaviors 恢复。**不用 ContainerBehaviorOffset ticker 叠加 alpha**——
//   ticker 每帧覆盖 target.alpha 会与 timeline alpha 动画（如 blurIn 0→1）冲突。
//   restoreProps 是一次性属性写入 + 一次性恢复，不持续驱动，不与 timeline 冲突。
const _dim: EffectFunction = (target, params = {}) => {
  const alpha = params.alpha ?? params[0] ?? 0.5;
  if (target instanceof KineticChar) {
    target.addModifier("dim", 'behavior', () => ({ alpha }));
  } else if (target instanceof Container) {
    const baseAlpha = target.alpha;
    target.alpha = alpha;
    return { restoreProps: { target, props: { alpha: baseAlpha } } };
  }
};
export const dim = defineEffect(_dim, {
  type: "style",
  track: "behavior",  // 修复：使用 behavior track 确保特效被正确收集和应用
  targetType: "both",
  mutexGroup: "alpha",
});

// 视觉位移 (Shift) — 修复 meta：track 改为 behavior（实现用了 addModifier）
const _shift: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const x = Number(params.x || params.val || 0);
    const y = Number(params.y || 0);
    target.addModifier("shift", 'behavior', () => {
      return { x, y };
    });
  }
};
export const shift = defineEffect(_shift, {
  type: "style",
  track: "behavior",
  targetType: "char",
  mutexGroup: "position_shift",
  stackable: true,
});

// 故障 (Glitch) — 修复：改用 addModifier，避免直接改 target.x/alpha 被 layout 覆盖
const _glitch: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const strength = params.strength || 10;
    let glitchActive = false;
    let timer = 0;
    target.addModifier("glitch", 'behavior', () => {
      timer++;
      if (!glitchActive && timer % 120 < 5) glitchActive = true;
      if (glitchActive && timer % 120 >= 10) glitchActive = false;
      if (glitchActive) {
        return {
          x: (Math.random() - 0.5) * strength,
          alpha: Math.random() * 0.5 + 0.5,
        };
      }
      return { x: 0, alpha: 1 };
    });
  }
};
export const glitch = defineEffect(_glitch, {
  type: "behavior",
  track: "behavior",
  targetType: "char",
  mutexGroup: "position",
  stackable: true,
});
