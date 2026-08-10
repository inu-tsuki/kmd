import gsap from "gsap";
import { BlurFilter } from "pixi.js";
import { KineticChar } from "../../KineticChar";
import type { EffectFunction, EffectMetadata } from "../types";

function defineEffect(fn: EffectFunction, meta: EffectMetadata) {
  return { fn, meta };
}

// 渐入 (FadeIn)
const _fadeIn: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const duration = params.duration || 0.5;
    const delay = params.delay || 0;
    gsap.set(target.animOffset, { alpha: 0 });
    return gsap.to(target.animOffset, {
      alpha: 1, duration: duration, delay: delay,
      ease: "power1.out",
    });
  }
};
export const fadeIn = defineEffect(_fadeIn, {
  type: "anim",
  track: "entrance",
  targetType: "char",
  mutexGroup: "enter",
});

// 弹性弹出 (PopIn)
const _popIn: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const duration = params.duration || 0.6;
    const delay = params.delay || 0;
    gsap.set(target.animOffset, { scaleX: 0, scaleY: 0, alpha: 0 });
    return gsap.to(target.animOffset, {
      scaleX: 1, scaleY: 1, alpha: 1,
      duration: duration, delay: delay,
      ease: "back.out(1.7)",
    });
  }
};
export const popIn = defineEffect(_popIn, {
  type: "anim",
  track: "entrance",
  targetType: "char",
  mutexGroup: "enter",
});

// 脉冲入场 (PulseIn)
const _pulseIn: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const duration = params.duration || 0.8;
    const delay = params.delay || 0;
    const scale = params.scale || 1.3;
    const pulses = params.pulses || 2;

    gsap.set(target.animOffset, { scaleX: 0, scaleY: 0, alpha: 0 });

    const tl = gsap.timeline({ delay });

    tl.to(target.animOffset, {
      scaleX: scale,
      scaleY: scale,
      alpha: 1,
      duration: duration * 0.4,
      ease: "power2.out",
    });

    for (let i = 0; i < pulses; i++) {
      const pulseDur = (duration * 0.6) / (pulses * 2);
      tl.to(target.animOffset, {
        scaleX: 0.9,
        scaleY: 0.9,
        duration: pulseDur,
        ease: "power1.inOut",
      });
      tl.to(target.animOffset, {
        scaleX: scale,
        scaleY: scale,
        duration: pulseDur,
        ease: "power1.inOut",
      });
    }

    tl.to(target.animOffset, {
      scaleX: 1,
      scaleY: 1,
      duration: duration * 0.1,
      ease: "power2.out",
    });

    return tl;
  }
};
export const pulseIn = defineEffect(_pulseIn, {
  type: "anim",
  track: "entrance",
  targetType: "char",
  mutexGroup: "enter",
});

// 跳入 (JumpIn)
const _jumpIn: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const height = params.height || 50;
    const duration = params.duration || 0.6;
    const delay = params.delay || 0;
    gsap.set(target.animOffset, { y: -height, alpha: 0 });
    return gsap.to(target.animOffset, {
      y: 0, alpha: 1,
      duration: duration, delay: delay,
      ease: "bounce.out",
    });
  }
};
export const jumpIn = defineEffect(_jumpIn, {
  type: "anim",
  track: "entrance",
  targetType: "char",
  mutexGroup: "enter",
});

// 模糊进场 (BlurIn)
// filter 生命周期交 clearEntranceFilters（stop/clearScreen 时移除 + destroyFilterDeep），
// 不再用 tween onComplete 移除——stop kill 时间线时 onComplete 不触发会泄漏 GPU。
// fn 返回 { tween, filter }（EntranceFilterResult），captureEntrance 解包：
// tween 入时间线（captureTween），filter 进 entranceFilters（EntranceFilterRecord）。
// **不进 instantEffects**——instantEffects seek 时重 apply fn（registerInstantEffects），
// blurIn 重 apply 会 gsap.set(alpha=0) 重置 + rogue tween + destroy({tween,filter}) 崩溃。
const _blurIn: EffectFunction = (target, params = {}) => {
  const duration = params.duration || 1;
  const blurFilter = new BlurFilter();
  blurFilter.strength = 20;
  target.filters = [...(target.filters || []), blurFilter];

  if (target instanceof KineticChar) {
    gsap.set(target.animOffset, { alpha: 0 });
    const tl = gsap.timeline();
    tl.to(target.animOffset, { alpha: 1, duration: duration })
      .to(blurFilter, { strength: 0, duration: duration, ease: "power2.out" }, "<");
    return { tween: tl, filter: blurFilter };
  } else {
    target.alpha = 0;
    // 容器级：alpha + strength 动画并入同一 timeline，避免 timeline 外 tween
    // （原 gsap.to(blurFilter) 不入 segment timeline → seek 无法插值、kill 杀不到 → orphan）。
    const tl = gsap.timeline();
    tl.to(target, { alpha: 1, duration: duration })
      .to(blurFilter, { strength: 0, duration: duration, ease: "power2.out" }, "<");
    return { tween: tl, filter: blurFilter };
  }
};
export const blurIn = defineEffect(_blurIn, {
  type: "anim",
  track: "entrance",
  targetType: "both",
  mutexGroup: "enter",
});

// 重击 (Punch)
const _punch: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const scale = params.scale || 1.5;
    const delay = params.delay || 0;
    gsap.set(target.animOffset, { scaleX: 1, scaleY: 1 });
    return gsap.to(target.animOffset, {
      scaleX: scale, scaleY: scale,
      duration: 0.1, yoyo: true, repeat: 1, delay: delay,
      ease: "power1.out"
    });
  }
};
export const punch = defineEffect(_punch, {
  type: "anim",
  track: "entrance",
  targetType: "char",
  mutexGroup: "action",
});

// 跳跃 (Jump) — 一次性动画
const _jump: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const height = params.height || 30;
    const duration = params.duration || 0.5;
    const delay = params.delay || 0;
    return gsap.to(target.animOffset, {
      y: -height,
      duration: duration,
      delay: delay,
      yoyo: true,
      repeat: 1,
      ease: "power1.out",
    });
  }
};
export const jump = defineEffect(_jump, {
  type: "anim",
  track: "entrance",
  targetType: "char",
  mutexGroup: "position",
});
