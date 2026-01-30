import gsap from "gsap";
import { Container, BlurFilter } from "pixi.js";
import { TokenWrapper } from "../TokenWrapper";
import { KineticChar } from "../KineticChar";
import { RGBSplitFilter } from "../filters/RGBSplitFilter";
import { WarpFilter } from "../filters/WarpFilter";
import type { EffectFunction, EffectMetadata } from "./types";

// Helper to define effects with types
function defineEffect(fn: EffectFunction, meta: EffectMetadata) {
  return { fn, meta };
}

// 1. 震动 (Continuous Shake)
// 适合表达恐惧、寒冷、愤怒
const _shake: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const strength = params.strength || 3;
    target.addModifier("shake", () => {
      return {
        x: (Math.random() - 0.5) * strength,
        y: (Math.random() - 0.5) * strength,
      };
    });
  }
};
export const shake = defineEffect(_shake, {
  type: "behavior",
  mutexGroup: "position",
  stackable: true,
});

// 2. 波浪 (Wave)
// 适合表达晕眩、漂浮、醉酒
const _wave: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const height = params.height || 10;
    const freq = params.freq || 0.005;
    const offset = params.delay || 0;
    target.addModifier("wave", (time) => {
      return {
        y: Math.sin(time * freq + offset) * height,
      };
    });
  }
};
export const wave = defineEffect(_wave, {
  type: "behavior",
  mutexGroup: "position",
  stackable: true,
});

// 3. 漂浮 (Float)
// 适合表达轻盈、幽灵
const _float: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const height = params.height || 5;
    const freq = params.freq || 0.002;
    const offset = params.delay || 0;
    target.addModifier("float", (time) => {
      return {
        y: Math.sin(time * freq + offset) * height,
      };
    });
  }
};
export const float = defineEffect(_float, {
  type: "behavior",
  mutexGroup: "position",
  stackable: true,
});

// 4. 脉冲 (Pulse)
// 适合表达心跳、强调
const _pulse: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const scale = params.scale || 0.2;
    const freq = params.freq || 0.005;
    const offset = params.delay || 0;
    target.addModifier("pulse", (time) => {
      const s = 1 + Math.sin(time * freq + offset) * scale;
      return {
        scaleX: s,
        scaleY: s,
      };
    });
  }
};
export const pulse = defineEffect(_pulse, {
  type: "behavior",
  mutexGroup: "scale",
  stackable: true,
});

// 5. 抖动 (Jitter)
// 像打印机卡顿或机械故障
const _jitter: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const strength = params.strength || 2;
    target.addModifier("jitter", () => {
      return {
        x: Math.floor((Math.random() - 0.5) * strength * 2),
        y: Math.floor((Math.random() - 0.5) * strength * 2),
      };
    });
  }
};
export const jitter = defineEffect(_jitter, {
  type: "behavior",
  mutexGroup: "position",
  stackable: true,
});

// 6. 旋转 (Rotate)
const _rotate: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const speed = params.speed || 0.002;
    const range = params.range || 0.1;
    target.addModifier("rotate", (time) => {
      return {
        rotation: Math.sin(time * speed) * range,
      };
    });
  }
};
export const rotate = defineEffect(_rotate, {
  type: "behavior",
  mutexGroup: "rotation",
  stackable: true,
});

// 7. 彩虹 (Rainbow)
const _rainbow: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const speed = params.speed || 0.002;
    const offset = params.delay || 0;
    target.addModifier("rainbow", (time) => {
      const t = time * speed + offset;
      const r = Math.sin(t) * 127 + 128;
      const g = Math.sin(t + 2.09) * 127 + 128;
      const b = Math.sin(t + 4.18) * 127 + 128;
      const color =
        (Math.floor(r) << 16) + (Math.floor(g) << 8) + Math.floor(b);
      return { tint: color };
    });
  }
};
export const rainbow = defineEffect(_rainbow, {
  type: "behavior",
  mutexGroup: "color",
});

// 8. 模糊进场 (Blur In)
const _blurIn: EffectFunction = (target: Container, params = {}) => {
  const duration = params.duration || 1;
  const blurFilter = new BlurFilter();
  blurFilter.strength = 20;

  const currentFilters = target.filters || [];
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
        if (target.filters) {
          target.filters = (target.filters as any[]).filter(
            (f) => f !== blurFilter,
          );
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
export const blurIn = defineEffect(_blurIn, {
  type: "behavior",
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
  mutexGroup: "position",
  stackable: true,
});

// 10. 边框 (Border)
const _border: EffectFunction = (target, params = {}) => {
  if (!(target instanceof TokenWrapper)) {
    console.warn("[Effect] border effect requires TokenWrapper");
    return;
  }
  const color = params.color || 0xff0000;
  const width = params.width || 2;
  const padding = params.padding || 5;
  const bounds = target.getContentBounds();
  const g = target.getGraphicsLayer("border");
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
  mutexGroup: "border",
});

// 11. 背景 (Background)
const _bg: EffectFunction = (target, params = {}) => {
  if (!(target instanceof TokenWrapper)) {
    console.warn("[Effect] bg effect requires TokenWrapper");
    return;
  }
  const color = params.color || 0x333333;
  const alpha = params.alpha || 1.0;
  const padding = params.padding || 5;
  const radius = params.radius || 4;
  const bounds = target.getContentBounds();
  const g = target.getGraphicsLayer("bg");
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
export const bg = defineEffect(_bg, { type: "style", mutexGroup: "bg" });

// 12. 弹性弹出 (PopIn)
const _popIn: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const duration = params.duration || 0.6;
    const delay = params.delay || 0;
    const state = { scale: 0, alpha: 0 };

    target.addModifier("popIn", () => ({
      scaleX: state.scale,
      scaleY: state.scale,
      alpha: state.alpha,
    }));

    const tl = gsap.timeline();
    tl.to(state, {
      scale: 1,
      alpha: 1,
      duration: duration,
      delay: delay,
      ease: "back.out(1.7)",
    });
    return tl;
  }
};
export const popIn = defineEffect(_popIn, {
  type: "behavior",
  mutexGroup: "enter",
});

// 13. 渐入震动 (FadeShake)
const _fadeShake: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const maxStrength = params.strength || 3;
    const fadeDuration = params.fadeIn || 1.0;
    const delay = params.delay || 0;
    const state = { strength: 0 };

    target.addModifier("shake", () => ({
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
  mutexGroup: "position",
});

// 14. 重击 (Punch)
const _punch: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const scale = params.scale || 1.5;
    const delay = params.delay || 0;
    const state = { s: 1 };

    target.addModifier("punch", () => ({
      scaleX: state.s,
      scaleY: state.s,
    }));

    return gsap.to(state, {
      s: scale,
      duration: 0.1,
      yoyo: true,
      repeat: 1,
      delay: delay,
      ease: "power1.out",
      onComplete: () => {
        target.removeModifier("punch");
      },
    });
  }
};
export const punch = defineEffect(_punch, {
  type: "behavior",
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

    target.addModifier("physics", () => {
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
  mutexGroup: "position",
  stackable: true,
});

// 16. RGB偏移 (RGB Shift)
const _rgbShift: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const distance = params.dist || 5;
    const filter = new RGBSplitFilter();
    filter.offset = { x: distance, y: 0 };

    target.filters = [...(target.filters || []), filter];

    if (params.anim) {
      target.addModifier("rgbAnim", (t) => {
        filter.offset = {
          x: Math.sin(t * 0.05) * distance,
          y: Math.cos(t * 0.03) * distance,
        };
        return {};
      });
    }
  }
};
export const rgbShift = defineEffect(_rgbShift, {
  type: "filter",
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

  target.addModifier("warpAnim", (time) => {
    filter.time = time * speed;
    return {};
  });
};
export const warp = defineEffect(_warp, {
  type: "filter",
  mutexGroup: "filter_warp",
});

// 18. 摇摆 (Swing) - New
// 钟摆式旋转
const _swing: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const speed = params.speed || 0.003;
    const range = params.range || 0.2; // 弧度
    target.addModifier("swing", (time) => {
      return {
        rotation: Math.cos(time * speed) * range,
      };
    });
  }
};
export const swing = defineEffect(_swing, {
  type: "behavior",
  mutexGroup: "rotation",
  stackable: true,
});

// 19. 闪烁 (Flash) - New
// 透明度周期性变化
const _flash: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {
    const speed = params.speed || 0.01;
    const minAlpha = params.min || 0.3;
    target.addModifier("flash", (time) => {
      // 0 ~ 1 sine wave mapped to minAlpha ~ 1
      const t = (Math.sin(time * speed) + 1) / 2; // 0~1
      return {
        alpha: minAlpha + t * (1 - minAlpha),
      };
    });
  }
};
export const flash = defineEffect(_flash, {
  type: "behavior",
  mutexGroup: "alpha",
  stackable: true,
});

// 20. 模糊 (Blur) - New
// 静态或动态模糊
const _blur: EffectFunction = (target, params = {}) => {
  const strength = params.strength || 4;
  const filter = new BlurFilter();
  filter.strength = strength;

  target.filters = [...(target.filters || []), filter];

  if (params.anim) {
    // 呼吸模糊
    if (target instanceof KineticChar) {
      target.addModifier("blurAnim", (time) => {
        filter.strength = (Math.sin(time * 0.005) + 1) * strength;
        return {};
      });
    }
  }
};
export const blur = defineEffect(_blur, {
  type: "filter",
  mutexGroup: "filter_blur",
  stackable: true,
});