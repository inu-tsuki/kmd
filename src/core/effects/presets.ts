import gsap from "gsap";
import { Container, BlurFilter } from "pixi.js";
import { KineticChar } from "../KineticChar";
import { RGBSplitFilter } from "../filters/RGBSplitFilter";
import { WarpFilter } from "../filters/WarpFilter";
import type { EffectFunction, EffectMetadata } from "./types";

// Helper to define effects with types
function defineEffect(fn: EffectFunction, meta: EffectMetadata) {
  return { fn, meta };
}

// 1. 震动 (Continuous Shake)
const _shake: EffectFunction = (target, params = {}) => {
  const strength = params.strength || 3;
  if (target instanceof KineticChar) {
    target.addModifier("shake", 'behavior', () => ({
      x: (Math.random() - 0.5) * strength,
      y: (Math.random() - 0.5) * strength,
    }));
  } else if (target instanceof Container) {
    gsap.to(target.pivot, {
      x: () => (Math.random() - 0.5) * strength,
      y: () => (Math.random() - 0.5) * strength,
      duration: 0.05,
      repeat: -1,
      yoyo: true,
    });
  }
};
export const shake = defineEffect(_shake, {
  type: "behavior",
  track: "behavior",
  targetType: "both",
  mutexGroup: "position",
  stackable: true,
});

// 2. 波浪 (Wave)
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

// 3. 漂浮 (Float)
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

// 4. 脉冲 (Pulse)
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

// 5. 抖动 (Jitter)
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

// 6. 旋转 (Rotate)
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

// 7. 彩虹 (Rainbow)
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

// 8. 模糊进场 (Blur In)
const _blurIn: EffectFunction = (target: Container, params = {}) => {
  const duration = params.duration || 1;
  const blurFilter = new BlurFilter();
  blurFilter.strength = 20;
  target.filters = [...(target.filters || []), blurFilter];

  if (target instanceof KineticChar) {
    gsap.set(target.animOffset, { alpha: 0 });
    const tl = gsap.timeline();
    tl.to(target.animOffset, { alpha: 1, duration: duration })
      .to(blurFilter, {
        strength: 0, duration: duration, ease: "power2.out", onComplete: () => {
          target.filters = (target.filters || []).filter(f => f !== blurFilter);
          if (target.filters!.length === 0) target.filters = null;
        }
      }, "<");
    return tl;
  } else {
    target.alpha = 0;
    return gsap.to(target, { alpha: 1, duration: duration });
  }
};
export const blurIn = defineEffect(_blurIn, {
  type: "anim",
  track: "entrance",
  targetType: "both",
  mutexGroup: "enter",
});

// 9. 故障 (Glitch)
const _glitch: EffectFunction = (target: Container, params = {}) => {
  void params;
  const tl = gsap.timeline({ repeat: -1, repeatDelay: 2 });
  const startX = target.x;

  tl.to(target, {
    x: () => startX + (Math.random() - 0.5) * 20,
    alpha: () => Math.random(),
    duration: 0.05,
    repeat: 5,
    yoyo: true,
  });

  tl.to(target, {
    x: startX,
    alpha: 1,
    duration: 0.05,
  });

  return tl;
};
export const glitch = defineEffect(_glitch, {
  type: "behavior",
  track: "behavior",
  targetType: "both",
  mutexGroup: "position",
  stackable: true,
});

// 10. 边框 (Border)
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
  g.rect(
    -padding,
    -padding,
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

// 11. 背景 (Background)
const _bg: EffectFunction = (target, params = {}) => {
  const t = target as any;
  if (!t.getContentBounds || !t.getGraphicsLayer) {
    console.warn("[Effect] bg effect requires object with geometry methods");
    return;
  }
  const color = params.color || 0x333333;
  const alpha = params.alpha || 1.0;
  const padding = params.padding || 5;
  const radius = params.radius || 4;
  const bounds = t.getContentBounds();
  const g = t.getGraphicsLayer("bg");
  g.clear();
  g.roundRect(
    -padding,
    -padding,
    bounds.width + padding * 2,
    bounds.height + padding * 2,
    radius,
  );
  g.fill({ color, alpha });
};
export const bg = defineEffect(_bg, {
  type: "style",
  track: "instant",
  targetType: "group",
  mutexGroup: "bg",
});

// 12. 弹性弹出 (PopIn)
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

// 13. 渐入震动 (FadeShake)
const _fadeShake: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const maxStrength = params.strength || 3;
    const fadeDuration = params.fadeIn || 1.0;
    const delay = params.delay || 0;
    const state = { strength: 0 };

    target.addModifier("shake", 'behavior', () => ({
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

// 14. 重击 (Punch)
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

// 15. 重力 (Gravity)
const _gravity: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    let velocityY = 0;
    const gravity = params.g || 0.5;
    const floorY = params.floor || 600;
    const bounce = params.bounce || 0.6;
    let currentY = 0;

    target.addModifier("physics", 'behavior', () => {
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

// 16. RGB偏移 (RGB Shift)
const _rgbShift: EffectFunction = (target, params = {}) => {
  const distance = params.dist || 5;
  const filter = new RGBSplitFilter();
  filter.offset = { x: distance, y: 0 };
  target.filters = [...(target.filters || []), filter];

  if (params.anim) {
    if (target instanceof KineticChar) {
      target.addModifier("rgbAnim", 'behavior', (t) => {
        filter.offset = { x: Math.sin(t * 0.05) * distance, y: Math.cos(t * 0.03) * distance };
        return {};
      });
    }
  }
};
export const rgbShift = defineEffect(_rgbShift, {
  type: "filter",
  track: "instant",
  targetType: "both",
  mutexGroup: "filter_rgb",
});

// 17. 扭曲 (Warp)
const _warp: EffectFunction = (target, params = {}) => {
  if (!(target instanceof KineticChar)) {
    console.warn("[Effect] warp effect requires KineticChar");
    return;
  }
  const freq = params.freq || 10;
  const amp = params.amp || 0.05;
  const speed = params.speed || 0.01;

  const filter = new WarpFilter();
  filter.frequency = freq;
  filter.amplitude = amp;
  filter.padding = 20;

  target.filters = [...(target.filters || []), filter];

  target.addModifier("warpAnim", 'behavior', (time: number) => {
    filter.time = time * speed;
    return {};
  });
};
export const warp = defineEffect(_warp, {
  type: "filter",
  track: "instant",
  targetType: "char",
  mutexGroup: "filter_warp",
});

// 18. 摇摆 (Swing)
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

// 19. 闪烁 (Flash)
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

// 22. 变暗 (Dim)
const _dim: EffectFunction = (target) => {
  target.alpha = 0.7;
};
export const dim = defineEffect(_dim, {
  type: "style",
  track: "instant",
  targetType: "both",
  mutexGroup: "alpha",
});

// 20. 模糊 (Blur)
const _blur: EffectFunction = (target, params = {}) => {
  const strength = params.strength || 4;
  const filter = new BlurFilter();
  filter.strength = strength;

  target.filters = [...(target.filters || []), filter];

  if (params.anim) {
    if (target instanceof KineticChar) {
      target.addModifier("blurAnim", 'behavior', (time: number) => {
        filter.strength = (Math.sin(time * 0.005) + 1) * strength;
        return {};
      });
    }
  }
};
export const blur = defineEffect(_blur, {
  type: "filter",
  track: "instant",
  targetType: "both",
  mutexGroup: "filter_blur",
  stackable: true,
});

// 21. 视觉位移 (Shift)
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
  track: "instant",
  targetType: "char",
  mutexGroup: "position_shift",
  stackable: true,
});

// 提前推进组件
export const go = defineEffect((_target, params = {}) => ({
  type: "delay", value: Number(params.duration ?? params.d ?? params[0] ?? 0)
}), {
  type: "action",
  track: "timing",
  targetType: "both",
});

export const slow = defineEffect((_target, params = {}) => ({
  type: "speedMultiplier", value: Number(params.factor ?? params.f ?? params[0] ?? 2.0)
}), {
  type: "action",
  track: "timing",
  targetType: "both",
});

export const fast = defineEffect((_target, params = {}) => ({
  type: "speedMultiplier", value: Number(params.factor ?? params.f ?? params[0] ?? 0.5)
}), {
  type: "action",
  track: "timing",
  targetType: "both",
});

export const hold = defineEffect((_target, params = {}) => new Promise<void>(resolve => {
  gsap.delayedCall(Number(params.duration ?? params.d ?? params[0] ?? 1), resolve);
}), {
  type: "action",
  track: "timing",
  targetType: "both",
});

/** @deprecated 向后兼容别名，后续版本移除 */
export const wait = hold;
