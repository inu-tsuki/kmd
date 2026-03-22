import { stageManager, type StageEffectFunction } from "./StageManager";
import gsap from "gsap";

/**
 * Modifier-based 指令列表（这些指令带有不可 Tween 化的副作用，
 * 在 Timeline build 模式下需要 tl.call() 兜底而非 captureTween）
 */
export const MODIFIER_BASED_COMMANDS = new Set(["cam.shake", "cam.drift"]);

export const stagePresets: Record<string, StageEffectFunction> = {
  /**
   * 基础位移组件
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

    const offX = absX - stageManager.designWidth / 2;
    const offY = absY - stageManager.designHeight / 2;

    return stagePresets["cam.move"]!({ x: offX, y: offY, duration });
  },

  /**
   * 叠加偏移组件（软性层，与 camera 独立，不产生属性冲突）
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
   */
  "cam.reset": (p: any) => {
    const duration = p.duration ?? p.d ?? p[0] ?? 0;
    const resetTl = gsap.timeline();
    const tweenOpts = {
      ease: duration > 0 ? "power2.inOut" : "none",
      overwrite: stageManager.buildMode ? false : ("auto" as gsap.TweenVars["overwrite"]),
      immediateRender: stageManager.buildMode ? false : undefined,
    };
    resetTl.to(stageManager.camera, { x: 0, y: 0, duration, ...tweenOpts }, 0);
    resetTl.to(stageManager.camera, { zoom: 1, duration, ...tweenOpts }, 0);
    resetTl.to(stageManager.camera, { rotation: 0, duration, ...tweenOpts }, 0);
    resetTl.to(stageManager.cameraOffset, { x: 0, y: 0, duration, ...tweenOpts }, 0);
    resetTl.to(stageManager.cameraOffset, { zoom: 1, duration, ...tweenOpts }, 0);
    resetTl.to(stageManager.cameraOffset, { rotation: 0, duration, ...tweenOpts }, 0);
    if (stageManager.buildMode) {
      resetTl.call(() => stageManager.clearModifiers(), [], duration);
    } else {
      stageManager.clearModifiers();
    }
    return resetTl;
  },

  /**
   * 震动组件 (Modifier 模式)
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
   */
  "pause": (p: any) => {
    const duration = p.duration ?? p.d ?? p[0] ?? 1;
    return new Promise<void>(resolve => {
      gsap.delayedCall(duration, resolve);
    });
  },
};
