import { stageRuntime } from "./StageRuntimeInstance";
import type { StageEffectFunction } from "./StageRuntime";
import type { StageCommandMetadataMap } from "./types";
import gsap from "gsap";

export const stageCommandMetadata: StageCommandMetadataMap = {
  "scene.clear": {
    name: "scene.clear",
    kind: "scene",
    propertyKey: "scene.lifecycle",
    sceneLifecycle: true,
    capturesTween: false,
    description: "Clears active paragraph display through the runtime scene-clear hook.",
  },
  "cam.move": {
    name: "cam.move",
    kind: "camera",
    propertyKey: "camera.xy",
    capturesTween: true,
  },
  "cam.zoom": {
    name: "cam.zoom",
    kind: "camera",
    propertyKey: "camera.zoom",
    capturesTween: true,
  },
  "cam.rotate": {
    name: "cam.rotate",
    kind: "camera",
    propertyKey: "camera.rotation",
    capturesTween: true,
  },
  "cam.focus": {
    name: "cam.focus",
    kind: "camera",
    propertyKey: "camera.xy",
    capturesTween: true,
  },
  "cam.offset": {
    name: "cam.offset",
    kind: "offset",
    propertyKey: "offset.xy",
    capturesTween: true,
  },
  "cam.reset": {
    name: "cam.reset",
    kind: "camera",
    propertyKey: "camera.reset",
    capturesTween: true,
    description: "Resets camera, camera offset, and active camera modifiers.",
  },
  "cam.shake": {
    name: "cam.shake",
    kind: "modifier",
    modifierBased: true,
    capturesTween: true,
  },
  "cam.drift": {
    name: "cam.drift",
    kind: "modifier",
    modifierBased: true,
    capturesTween: false,
  },
  pause: {
    name: "pause",
    kind: "playback",
    propertyKey: "playback.pause",
    blockingDefault: true,
    capturesTween: false,
  },
};

/**
 * Modifier-based 指令列表（这些指令带有不可 Tween 化的副作用，
 * 在 Timeline build 模式下需要 tl.call() 兜底而非 captureTween）
 */
export const MODIFIER_BASED_COMMANDS = new Set(
  Object.entries(stageCommandMetadata)
    .filter(([, metadata]) => metadata.modifierBased)
    .map(([name]) => name)
);

export const stagePresets: Record<string, StageEffectFunction> = {
  /**
   * 段落清屏统一走 runtime hook。
   * parser 仍可保留 `isSceneClear` 作为 discriminant/marker 信息，
   * 但运行时显隐行为不再依赖 legacy 分支。
   */
  "scene.clear": () => {
    return stageRuntime.runSceneClear();
  },

  /**
   * 基础位移组件
   */
  "cam.move": (p: any) => {
    const duration = p.duration ?? p.d ?? p[2] ?? 0;
    return gsap.to(stageRuntime.camera, {
      x: p.x ?? p[0] ?? stageRuntime.camera.x,
      y: p.y ?? p[1] ?? stageRuntime.camera.y,
      duration,
      ease: duration > 0 ? "power2.inOut" : "none",
      overwrite: stageRuntime.buildMode ? false : "auto",
      immediateRender: stageRuntime.buildMode ? false : undefined,
    });
  },

  /**
   * 变焦组件
   */
  "cam.zoom": (p: any) => {
    const duration = p.duration ?? p.d ?? p[1] ?? 0;
    return gsap.to(stageRuntime.camera, {
      zoom: p.val ?? p[0] ?? stageRuntime.camera.zoom,
      duration,
      ease: duration > 0 ? "power2.inOut" : "none",
      overwrite: stageRuntime.buildMode ? false : "auto",
      immediateRender: stageRuntime.buildMode ? false : undefined,
    });
  },

  /**
   * 旋转组件
   */
  "cam.rotate": (p: any) => {
    const duration = p.duration ?? p.d ?? p[1] ?? 0;
    return gsap.to(stageRuntime.camera, {
      rotation: p.val ?? p[0] ?? stageRuntime.camera.rotation,
      duration,
      ease: duration > 0 ? "power2.inOut" : "none",
      overwrite: stageRuntime.buildMode ? false : "auto",
      immediateRender: stageRuntime.buildMode ? false : undefined,
    });
  },

  /**
   * 绝对聚焦组件 (桥接逻辑)
   */
  "cam.focus": (p: any) => {
    const absX = p.x ?? p[0];
    const absY = p.y ?? p[1];
    const duration = p.duration ?? p.d ?? p[2] ?? 0;

    const offX = absX - stageRuntime.designWidth / 2;
    const offY = absY - stageRuntime.designHeight / 2;

    return stagePresets["cam.move"]!({ x: offX, y: offY, duration });
  },

  /**
   * 叠加偏移组件（软性层，与 camera 独立，不产生属性冲突）
   */
  "cam.offset": (p: any) => {
    const duration = p.duration ?? p.d ?? p[2] ?? 0;
    return gsap.to(stageRuntime.cameraOffset, {
      x: p.x ?? p[0] ?? stageRuntime.cameraOffset.x,
      y: p.y ?? p[1] ?? stageRuntime.cameraOffset.y,
      duration,
      ease: duration > 0 ? "power2.inOut" : "none",
      overwrite: stageRuntime.buildMode ? false : "auto",
      immediateRender: stageRuntime.buildMode ? false : undefined,
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
      overwrite: stageRuntime.buildMode ? false : ("auto" as gsap.TweenVars["overwrite"]),
      immediateRender: stageRuntime.buildMode ? false : undefined,
    };
    resetTl.to(stageRuntime.camera, { x: 0, y: 0, duration, ...tweenOpts }, 0);
    resetTl.to(stageRuntime.camera, { zoom: 1, duration, ...tweenOpts }, 0);
    resetTl.to(stageRuntime.camera, { rotation: 0, duration, ...tweenOpts }, 0);
    resetTl.to(stageRuntime.cameraOffset, { x: 0, y: 0, duration, ...tweenOpts }, 0);
    resetTl.to(stageRuntime.cameraOffset, { zoom: 1, duration, ...tweenOpts }, 0);
    resetTl.to(stageRuntime.cameraOffset, { rotation: 0, duration, ...tweenOpts }, 0);
    if (stageRuntime.buildMode) {
      resetTl.call(() => stageRuntime.clearModifiers(), [], duration);
    } else {
      stageRuntime.clearModifiers();
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

    stageRuntime.addModifier("shake", () => ({
      x: (Math.random() - 0.5) * state.s * 2,
      y: (Math.random() - 0.5) * state.s * 2,
    }));

    return gsap.to(state, {
      s: 0, duration, ease: "power2.out",
      onComplete: () => stageRuntime.removeModifier("shake")
    });
  },

  /**
   * 呼吸感组件 (Modifier 模式)
   */
  "cam.drift": (p: any) => {
    const strength = p.strength ?? p[0] ?? 5;
    const speed = p.speed ?? p[1] ?? 0.001;

    if (strength === 0) {
      stageRuntime.removeModifier("drift");
      return;
    }

    stageRuntime.addModifier("drift", (time) => ({
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
