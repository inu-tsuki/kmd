import gsap from "gsap";
import { Container } from "pixi.js";
import { KineticChar } from "../../KineticChar";
import { addContainerOffset } from "../../ContainerBehaviorOffset";
import type { EffectFunction, EffectMetadata } from "../types";

function defineEffect(fn: EffectFunction, meta: EffectMetadata) {
  return { fn, meta };
}

// 震动 (Shake)
const _shake: EffectFunction = (target, params = {}) => {
  const strength = params.strength || 3;
  if (target instanceof KineticChar) {
    target.addModifier("shake", 'behavior', () => ({
      x: (Math.random() - 0.5) * strength,
      y: (Math.random() - 0.5) * strength,
    }));
  } else if (target instanceof Container) {
    // 容器级用 ContainerBehaviorOffset 叠加 offset 到 position（与 char 级 addModifier
    // 返回 {x,y} 叠加到 layoutX/Y 同构），不 tween pivot——pivot 是布局中心值，tween 污染
    // 后 kill 不恢复会导致永久错位。返回 { tickerFn } 纳入 BehaviorFilterResult ticker
    // cleanup 路径（gsap.ticker.remove）；per-EffectId 清理由 removeContainerOffset 负责
    // （modifier id = effectName = "shake"），clearBehaviors 的 removeModifier 守卫对容器
    // 跳过，故需在 cleanup 时显式 removeContainerOffset（见 BehaviorCleanup.offsetTarget）。
    const tickerFn = addContainerOffset(target, "shake", () => ({
      x: (Math.random() - 0.5) * strength,
      y: (Math.random() - 0.5) * strength,
    }));
    return { tickerFn };
  }
};
export const shake = defineEffect(_shake, {
  type: "behavior",
  track: "behavior",
  targetType: "both",
  mutexGroup: "position",
  stackable: true,
});

// 波浪 (Wave)
const _wave: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const height = params.height || 10;
    const freq = params.freq || 0.005;
    const offset = params.delay !== undefined ? params.delay : (params.charIndex || 0) * 0.5;
    target.addModifier("wave", 'behavior', (time) => ({
      y: Math.sin(time * freq + offset) * height,
    }));
  }
};
export const wave = defineEffect(_wave, {
  type: "behavior",
  track: "behavior",
  targetType: "char",
  mutexGroup: "position",
  stackable: true,
});

// 漂浮 (Float)
const _float: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const height = params.height || 5;
    const freq = params.freq || 0.002;
    const offset = params.delay !== undefined ? params.delay : (params.charIndex || 0) * 0.5;
    target.addModifier("float", 'behavior', (time) => ({
      y: Math.sin(time * freq + offset) * height,
    }));
  }
};
export const float = defineEffect(_float, {
  type: "behavior",
  track: "behavior",
  targetType: "char",
  mutexGroup: "position",
  stackable: true,
});

// 脉冲 (Pulse)
const _pulse: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const scale = params.scale || 0.2;
    const freq = params.freq || 0.005;
    const offset = params.delay !== undefined ? params.delay : (params.charIndex || 0) * 0.5;
    target.addModifier("pulse", 'behavior', (time) => {
      const s = 1 + Math.sin(time * freq + offset) * scale;
      return { scaleX: s, scaleY: s };
    });
  }
};
export const pulse = defineEffect(_pulse, {
  type: "behavior",
  track: "behavior",
  targetType: "char",
  mutexGroup: "scale",
  stackable: true,
});

// 抖动 (Jitter)
const _jitter: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const strength = params.strength || 2;
    target.addModifier("jitter", 'behavior', () => ({
      x: Math.floor((Math.random() - 0.5) * strength * 2),
      y: Math.floor((Math.random() - 0.5) * strength * 2),
    }));
  }
};
export const jitter = defineEffect(_jitter, {
  type: "behavior",
  track: "behavior",
  targetType: "char",
  mutexGroup: "position",
  stackable: true,
});

// 旋转 (Rotate)
const _rotate: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const speed = params.speed || 0.002;
    const range = params.range || 0.1;
    target.addModifier("rotate", 'behavior', (time) => ({
      rotation: Math.sin(time * speed) * range,
    }));
  }
};
export const rotate = defineEffect(_rotate, {
  type: "behavior",
  track: "behavior",
  targetType: "char",
  mutexGroup: "rotation",
  stackable: true,
});

// 摇摆 (Swing)
const _swing: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const speed = params.speed || 0.003;
    const range = params.range || 0.2;
    target.addModifier("swing", 'behavior', (time: number) => {
      return {
        rotation: Math.cos(time * speed) * range,
      };
    });
  }
};
export const swing = defineEffect(_swing, {
  type: "behavior",
  track: "behavior",
  targetType: "char",
  mutexGroup: "rotation",
  stackable: true,
});

// 重力 (Gravity)
const _gravity: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    let velocityY = 0;
    const gravity = params.g || 0.5;
    const floorY = params.floor || 600;
    const bounce = params.bounce || 0.6;
    let currentY = 0;

    // modifier id 必须等于 effectName：PlaybackController.clearBehaviors 用
    // removeModifier(effectName) 精确删除。原 "physics" 命中失败 → modifier 残留。
    target.addModifier("gravity", 'behavior', () => {
      velocityY += gravity;
      currentY += velocityY;

      const absY = target.layoutY + currentY;
      if (absY > floorY) {
        currentY = floorY - target.layoutY;
        velocityY *= -bounce;
        if (Math.abs(velocityY) < 1) velocityY = 0;
      }

      return { y: currentY };
    });
  }
};
export const gravity = defineEffect(_gravity, {
  type: "behavior",
  track: "behavior",
  targetType: "char",
  mutexGroup: "position",
  stackable: true,
});

// 渐入震动 (FadeShake)
const _fadeShake: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const maxStrength = params.strength || 3;
    const fadeDuration = params.fadeIn || 1.0;
    const delay = params.delay || 0;
    const state = { strength: 0 };

    // modifier id 必须等于 effectName（见 gravity 注释）。原用 "shake" 与 shake
    // effect 共用 id → 同 char 共存时 Map.set 互相覆盖 + removeModifier("fadeShake")
    // 命中失败。改为 fadeShake 后两者独立 tick 叠加，不再互斥。
    target.addModifier("fadeShake", 'behavior', () => ({
      x: (Math.random() - 0.5) * state.strength,
      y: (Math.random() - 0.5) * state.strength,
    }));

    return gsap.to(state, {
      strength: maxStrength,
      duration: fadeDuration,
      delay: delay,
      ease: "power1.in",
    });
  }
};
export const fadeShake = defineEffect(_fadeShake, {
  type: "behavior",
  track: "behavior",
  targetType: "char",
  mutexGroup: "position",
});

// 闪烁 (Flash)
const _flash: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const speed = params.speed || 0.01;
    const minAlpha = params.min || 0.3;
    target.addModifier("flash", 'behavior', (time: number) => {
      const t = (Math.sin(time * speed) + 1) / 2;
      return {
        alpha: minAlpha + t * (1 - minAlpha),
      };
    });
  }
};
export const flash = defineEffect(_flash, {
  type: "behavior",
  track: "behavior",
  targetType: "char",
  mutexGroup: "alpha",
  stackable: true,
});

// 彩虹 (Rainbow)
const _rainbow: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    target.style.fill = "#ffffff";
    const speed = params.speed || 0.002;
    const offset = params.delay !== undefined ? params.delay : (params.charIndex || 0) * 0.5;
    target.addModifier("rainbow", 'behavior', (time) => {
      const t = time * speed + offset;
      const r = Math.sin(t) * 127 + 128;
      const g = Math.sin(t + 2.09) * 127 + 128;
      const b = Math.sin(t + 4.18) * 127 + 128;
      return { tint: (Math.floor(r) << 16) + (Math.floor(g) << 8) + Math.floor(b) };
    });
  }
};
export const rainbow = defineEffect(_rainbow, {
  type: "behavior",
  track: "behavior",
  targetType: "char",
  mutexGroup: "color",
});
