import gsap from "gsap";
import { Container, BlurFilter } from "pixi.js";
import type { EffectFunction } from "./types";

// 1. 震动 (Continuous Shake)
// 适合表达恐惧、寒冷、愤怒
export const shake: EffectFunction = (target, params = {}) => {
  const strength = params.strength || 5;
  const speed = params.speed || 0.05;

  // 这里的关键是使用 GSAP 的 random 功能，让震动更有机
  // 我们不改变 x/y，而是改变 pivot (锚点) 或者 skew，避免干扰排版位置
  // 但为了简单，这里演示改变 position (前提是相对定位)

  // 保存原始位置，防止震跑偏了
  const startX = target.x;
  const startY = target.y;

  return gsap.to(target, {
    x: () => startX + (Math.random() - 0.5) * strength,
    y: () => startY + (Math.random() - 0.5) * strength,
    duration: speed,
    repeat: -1, // 无限循环
    yoyo: true, // 往复
    ease: "none",
  });
};

// 2. 波浪 (Wave)
// 适合表达晕眩、漂浮、醉酒
export const wave: EffectFunction = (target, params = {}) => {
  const height = params.height || 10;
  const duration = params.duration || 1;

  // 获取当前Y值作为基准
  const startY = target.y;

  return gsap.to(target, {
    y: startY - height,
    duration: duration,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut", // 正弦曲线，最自然的波浪感
  });
};

// 3. 模糊进场 (Blur In)
// 适合回忆、梦境
export const blurIn: EffectFunction = (target: Container, params = {}) => {
  const duration = params.duration || 1;
  const blurFilter = new BlurFilter();
  blurFilter.strength = 20;

  // 1. 获取现有滤镜（如果为 null/undefined，则为空数组）
  // 注意：在 v8 中，如果没设置过滤镜，filters 可能是 null
  const currentFilters = target.filters || [];

  // 2. 创建一个新数组，包含旧滤镜 + 新滤镜
  // 重新赋值触发 Pixi 更新
  target.filters = [...currentFilters, blurFilter];

  target.alpha = 0;

  const tl = gsap.timeline();

  tl.to(target, { alpha: 1, duration: duration }).to(
    blurFilter,
    {
      strength: 0,
      duration: duration,
      ease: "power2.out",
      onComplete: () => {
        // 3. 移除滤镜时的安全操作
        // 同样，不要用 splice，而是 filter 出一个新数组重新赋值
        if (target.filters) {
          target.filters = (target.filters as any[]).filter(
            (f) => f !== blurFilter,
          );

          // 如果数组空了，最好设回 null，省一点性能
          if (target.filters.length === 0) {
            target.filters = null;
          }
        }
      },
    },
    "<",
  );

  return tl;
};
// 4. 故障 (Glitch)
// 赛博朋克必备。随机且剧烈的位移+透明度闪烁
export const glitch: EffectFunction = (target: Container, params = {}) => {
  void params;
  const tl = gsap.timeline({ repeat: -1, repeatDelay: 2 }); // 每隔2秒故障一次

  const startX = target.x;

  // 疯狂抽搐 0.2 秒
  tl.to(target, {
    x: () => startX + (Math.random() - 0.5) * 20, // 剧烈位移
    alpha: () => Math.random(), // 随机透明度
    duration: 0.05,
    repeat: 5,
    yoyo: true,
  });

  // 恢复正常
  tl.to(target, {
    x: startX,
    alpha: 1,
    duration: 0.05,
  });

  return tl;
};
