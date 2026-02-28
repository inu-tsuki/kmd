import { stageManager } from "./StageManager";
import gsap from "gsap";

/**
 * Modifier-based 指令列表（这些指令带有不可 Tween 化的副作用，
 * 在 Timeline build 模式下需要 tl.call() 兜底而非 captureTween）
 */
export const MODIFIER_BASED_COMMANDS = new Set(["cam.shake", "cam.drift"]);

export const stagePresets = {
  /**
   * 基础位移组件
   * 始终返回 Tween（duration=0 时返回 zero-duration Tween）。
   * 去掉 killTweensOf —— 依赖 overwrite:"auto" 和 Timeline 管理冲突。
   */
  "cam.move": (p: any) => {
    const duration = p.duration ?? p.d ?? p[2] ?? 0;
    return gsap.to(stageManager.camera, {
      x: p.x ?? p[0] ?? stageManager.camera.x,
      y: p.y ?? p[1] ?? stageManager.camera.y,
      duration,
      ease: duration > 0 ? "power2.inOut" : "none",
      overwrite: stageManager.buildMode ? false : "auto",
      immediateRender: stageManager.buildMode ? false : undefined,
    });
  },

  /**
   * 变焦组件
   */
  "cam.zoom": (p: any) => {
    const duration = p.duration ?? p.d ?? p[1] ?? 0;
    return gsap.to(stageManager.camera, {
      zoom: p.val ?? p[0] ?? stageManager.camera.zoom,
      duration,
      ease: duration > 0 ? "power2.inOut" : "none",
      overwrite: stageManager.buildMode ? false : "auto",
      immediateRender: stageManager.buildMode ? false : undefined,
    });
  },

  /**
   * 旋转组件
   */
  "cam.rotate": (p: any) => {
    const duration = p.duration ?? p.d ?? p[1] ?? 0;
    return gsap.to(stageManager.camera, {
      rotation: p.val ?? p[0] ?? stageManager.camera.rotation,
      duration,
      ease: duration > 0 ? "power2.inOut" : "none",
      overwrite: stageManager.buildMode ? false : "auto",
      immediateRender: stageManager.buildMode ? false : undefined,
    });
  },

  /**
   * 绝对聚焦组件 (桥接逻辑)
   */
  "cam.focus": (p: any) => {
    const absX = p.x ?? p[0];
    const absY = p.y ?? p[1];
    const duration = p.duration ?? p.d ?? p[2] ?? 0;

    // 换算为偏移量
    const offX = absX - stageManager.designWidth / 2;
    const offY = absY - stageManager.designHeight / 2;

    // 委托给 move 逻辑
    return stagePresets["cam.move"]({ x: offX, y: offY, duration });
  },

  /**
   * 叠加偏移组件（软性层，与 camera 独立，不产生属性冲突）
   * 目标对象是 stageManager.cameraOffset 而非 camera
   * x/y 为加法，zoom 为乘法（中性值=1），rotation 为加法（中性值=0）
   */
  "cam.offset": (p: any) => {
    const duration = p.duration ?? p.d ?? p[2] ?? 0;
    return gsap.to(stageManager.cameraOffset, {
      x: p.x ?? p[0] ?? stageManager.cameraOffset.x,
      y: p.y ?? p[1] ?? stageManager.cameraOffset.y,
      duration,
      ease: duration > 0 ? "power2.inOut" : "none",
      overwrite: stageManager.buildMode ? false : "auto",
      immediateRender: stageManager.buildMode ? false : undefined,
    });
  },

  /**
   * 状态重置组件
   * 返回 gsap.timeline() 而非 Promise.all()，使其可被 captureTween 挂载。
   * 同时重置 camera 和 cameraOffset。
   */
  "cam.reset": (p: any) => {
    const duration = p.duration ?? p.d ?? p[0] ?? 0;
    const resetTl = gsap.timeline();
    const tweenOpts = {
      ease: duration > 0 ? "power2.inOut" : "none",
      overwrite: stageManager.buildMode ? false : ("auto" as gsap.TweenVars["overwrite"]),
      immediateRender: stageManager.buildMode ? false : undefined,
    };
    // 重置 base camera
    resetTl.to(stageManager.camera, { x: 0, y: 0, duration, ...tweenOpts }, 0);
    resetTl.to(stageManager.camera, { zoom: 1, duration, ...tweenOpts }, 0);
    resetTl.to(stageManager.camera, { rotation: 0, duration, ...tweenOpts }, 0);
    // 重置 offset 层
    resetTl.to(stageManager.cameraOffset, { x: 0, y: 0, duration, ...tweenOpts }, 0);
    resetTl.to(stageManager.cameraOffset, { zoom: 1, duration, ...tweenOpts }, 0);
    resetTl.to(stageManager.cameraOffset, { rotation: 0, duration, ...tweenOpts }, 0);
    // Build 模式下延迟清除 modifier（等动画播放到这里时再清）
    if (stageManager.buildMode) {
      resetTl.call(() => stageManager.clearModifiers(), [], duration);
    } else {
      stageManager.clearModifiers();
    }
    return resetTl;
  },

  /**
   * 震动组件 (Modifier 模式)
   * 含 addModifier 副作用，Timeline build 时走 tl.call() 兜底
   */
  "cam.shake": (p: any) => {
    const strength = p.strength ?? p[0] ?? 5;
    const duration = p.duration ?? p.d ?? p[1] ?? 0.5;
    const state = { s: strength };

    stageManager.addModifier("shake", () => ({
      x: (Math.random() - 0.5) * state.s * 2,
      y: (Math.random() - 0.5) * state.s * 2,
    }));

    return gsap.to(state, {
      s: 0, duration, ease: "power2.out",
      onComplete: () => stageManager.removeModifier("shake")
    });
  },

  /**
   * 呼吸感组件 (Modifier 模式)
   * 纯 Modifier，无 Tween 返回，Timeline build 时走 tl.call()
   */
  "cam.drift": (p: any) => {
    const strength = p.strength ?? p[0] ?? 5;
    const speed = p.speed ?? p[1] ?? 0.001;

    if (strength === 0) {
      stageManager.removeModifier("drift");
      return;
    }

    stageManager.addModifier("drift", (time) => ({
      x: Math.sin(time * speed) * strength,
      y: Math.cos(time * speed * 0.8) * strength,
      rotation: Math.sin(time * speed * 0.5) * 0.01
    }));
  },

  /**
   * 流程阻断组件（Timeline 暂停语义）
   * buildTimeline 中通过 cursor += dur 处理，不经此函数。
   * 保留用于 legacy play() 模式。
   */
  "pause": (p: any) => {
    const duration = p.duration ?? p.d ?? p[0] ?? 1;
    return new Promise<void>(resolve => {
      gsap.delayedCall(duration, resolve);
    });
  },

  /** @deprecated 向后兼容别名，后续版本移除 */
  "wait": (p: any) => {
    const duration = p.duration ?? p.d ?? p[0] ?? 1;
    return new Promise<void>(resolve => { gsap.delayedCall(duration, resolve); });
  }
};

export function initStagePresets() {
  Object.entries(stagePresets).forEach(([name, fn]) => {
    stageManager.register(name, fn as any);
  });
}
