import { stageRuntime } from "./StageRuntimeInstance";
import { stageManager } from "./StageManager";
import type { StageEffectFunction } from "./StageRuntime";
import type { StageCommandMetadataMap } from "./types";
import { RuntimeValueResolver } from "../runtime/RuntimeValueResolver";
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
  "bg": {
    name: "bg",
    kind: "background",
    propertyKey: "background.set",
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

/**
 * 解析 stage 命令的数值参数（含变量引用 `var.*`）。R4-3 修复：原 `Number(params[1])` 直接转数值，
 * 但实际执行经 `StageRuntime.apply()` 会解析 `var.*`（RuntimeValueResolver）。`cam.shake(10, var.dur)`
 * 的 record duration 会变成 `Number("var.dur")=NaN` → seek duration 过滤失效，结束后仍可能重放。
 * 此处与 StageRuntime.apply 同源解析，保证 record duration 与运行时执行一致。
 */
export function resolveStageNumeric(value: any, fallback: number): number {
  if (typeof value === "number") return value;
  const referenced = RuntimeValueResolver.resolveReference(value);
  if (referenced !== undefined) return referenced;
  const numeric = typeof value === "string" ? parseFloat(value) : NaN;
  return Number.isNaN(numeric) ? fallback : numeric;
}

/**
 * 按命令语义提取 stage modifier 的持续时长（秒）。
 * 不能用通用 params[1]——cam.shake 的 params[1] 是 duration，但 cam.drift 的 params[1] 是 speed。
 * - cam.shake: duration = params.duration ?? params.d ?? params[1] ?? 0.5（有限效果）
 * - cam.drift: persistent，无 duration（undefined）
 * 其他 modifier-based 命令默认 persistent。
 * R4-3：数值经 resolveStageNumeric 解析变量引用，与 StageRuntime.apply 同源（不再直接 Number()）。
 */
export function getStageModifierDuration(command: string, params: any): number | undefined {
  if (command === "cam.shake") {
    const raw = params?.duration ?? params?.d ?? params?.[1] ?? 0.5;
    return resolveStageNumeric(raw, 0.5);
  }
  return undefined;
}

/**
 * 构建 stage modifier / clear boundary 的 StageModifierRecord 片段（不含 timePosition）。
 *
 * 单一真相源：global（SegmentBuilder.applyStageConfigs）、inline（TextStageCueScheduler.schedule）、
 * token-chain（TextPlayer.unrollGroupChain / unrollCharChain）三路径共用此 helper，
 * 保证 cam.reset 在任一写法下都被记为 clear boundary（SA-12 的根本修复——上一版只在 global
 * 路径特殊处理 cam.reset，inline/token-chain 的 `文字 @ cam.reset!` 落非 modifier 分支只 captureTween，
 * 导致 seek 到 reset 后 replayStageModifiers 找不到边界，仍重放 reset 前的 persistent modifier）。
 *
 * - cam.reset → isClearBoundary（清掉之前所有 modifier 的 replay 边界）。cam.reset 仍需立即 apply：
 *   它返回 reset timeline（可 seek tween），与 cam.move 等对称，由调用方在 record 后 apply + capture。
 * - modifierBased（cam.shake/cam.drift）→ 携 duration（按命令语义提取）。调用方用 tl.call 延迟 apply
 *   （modifier 在 timeline 时间触发，不在 build 期 apply）。
 * - 其余（cam.move 等可 seek tween 命令）→ null（不需要 seek 重放，走 apply + captureTween）。
 *
 * 返回值由调用方附加 timePosition 后 push 进 segment.stageModifierRecords。
 */
export function buildStageModifierRecord(
  command: string,
  params: any,
): StageModifierRecordFragment | null {
  if (command === "cam.reset") {
    // R4-2：cam.reset 的 boundary 生效时间 = reset 起点 + resetDuration（与正常播放对齐——
    // buildMode 下 cam.reset 在 resetTl 末尾（timePosition + duration）才 clearModifiers）。
    // 携 resetDuration 供 replayStageModifiers 计算 effective boundary time。
    // resetDuration 经 resolveStageNumeric 解析变量（与 getStageModifierDuration 同源）。
    const resetDuration = resolveStageNumeric(
      params?.duration ?? params?.d ?? params?.[0] ?? 0,
      0,
    );
    return {
      command: "cam.reset",
      params: { ...(params || {}) },
      isClearBoundary: true,
      resetDuration,
    };
  }
  if (stageCommandMetadata[command]?.modifierBased) {
    const fragment: StageModifierRecordFragment = {
      command,
      params: { ...(params || {}) },
      duration: getStageModifierDuration(command, params),
    };
    // F-3：cam.shake 的 baseStrength + easeName 在 build 期解析并写进 record，replay 只读不重算。
    // 与 StageRuntime.apply 同源一次（resolveStageNumeric），消除"record 说 A、timeline 说 B"的对齐债。
    if (command === "cam.shake") {
      fragment.baseStrength = resolveStageNumeric(
        params?.strength ?? params?.[0] ?? SHAKE_STRENGTH_FALLBACK,
        SHAKE_STRENGTH_FALLBACK,
      );
      fragment.easeName = CAM_SHAKE_EASE;
    }
    return fragment;
  }
  // SA-41：bg 是即时状态设置命令（setBackgroundColor/setBackgroundSprite），返回 void 无 tween。
  // 原实现在 build 期同步 apply（line 878），导致所有 bg 在构建时立刻执行、最后一条赢，
  // 而非在时间线 cursor 位置触发。改为延迟执行 + 记入 stageModifierRecords 供 seek 重放。
  // duration undefined = persistent（seek 时总是重放，与 cam.drift 同语义）。
  if (command === "bg") {
    return {
      command: "bg",
      params: { ...(params || {}) },
    };
  }
  return null;
}

/** buildStageModifierRecord 返回值形状（StageModifierRecord 去掉 timePosition 的可序列化部分）。 */
export interface StageModifierRecordFragment {
  command: string;
  params: Record<string, any>;
  duration?: number;
  isClearBoundary?: boolean;
  /** cam.reset 的持续时长（秒）。replayStageModifiers 用它算 boundary 生效时间 = timePosition + resetDuration，
   *  与正常播放（buildMode 下 resetTl 末尾 clearModifiers）对齐。R4-2。 */
  resetDuration?: number;
  /** cam.shake 的基础强度（build 期已解析变量，F-3）。replay 只读不重算。 */
  baseStrength?: number;
  /** cam.shake 的衰减缓动曲线名（build 期从 preset ease 读，F-3）。replay 用 gsap.parseEase 求值。 */
  easeName?: string;
}

/**
 * cam.shake 的衰减缓动曲线名。单一真相源（F-3）：preset 的 gsap.to ease 与 record 的 easeName 共用此常量，
 * 保证 replay 衰减与正常播放逐帧同源。GSAP `power2.out` 实为 `1-(1-t)^3`（§B-bis），replay 经
 * gsap.parseEase(CAM_SHAKE_EASE) 求值，不硬编码指数。
 */
export const CAM_SHAKE_EASE = "power2.out";

/**
 * cam.shake 的 strength 参数键序（build 期解析用）。F-3：与 replay 回退路径一致。
 */
const SHAKE_STRENGTH_FALLBACK = 5;

/**
 * cam.drift 的 speed 默认值（与 stagePresets["cam.drift"] 的 `p.speed ?? p[1] ?? 0.001` 同源）。
 */
const DRIFT_SPEED_FALLBACK = 0.001;

/**
 * R22-followup（stage 默认参数对齐）：构建期预解析 modifierBased 命令的数值参数，让自然播放
 * （tl.call → stageManager.apply）与 seek 重放（replayStageModifiers 读 record）走**同一份已解析
 * params**，消除"自然播放 fallback 0、seek 重放 fallback 命令默认值"的裂缝。
 *
 * **背景**：modifierBased 命令（cam.shake/cam.drift）原本自然播放的 tl.call 传 **raw** params，
 * `StageRuntime.apply` 运行时二次解析、fallback 用 0（StageRuntime.ts:158）；而 seek 重放读
 * `buildStageModifierRecord` 预解析的 `baseStrength`/`duration`（fallback 命令默认值 5/0.5）。故
 * `cam.shake(var.missing, var.missingDur)`：自然播放得 strength=0/duration=0（几乎无效果），
 * seek 重放得 strength=5/duration=0.5（正常默认 shake）——不一致。
 *
 * **修法**：构建期一次性把数值字段解析成数字（缺失变量按命令预设默认值，与 stagePresets["cam.shake"]/
 * ["cam.drift"] 的 `??` 默认同源），非数值字段（如 `static:true`）原样透传。自然播放 tl.call 传此
 * 预解析 params，`StageRuntime.apply` 见数字直接透传（resolveNumeric 对 number 原样返回），不再 fallback。
 * 与视觉特效体系（EffectProcessor.resolveParams 构建期解析一次、两条路径共享）同模型。
 *
 * **单一真相源**：默认值常量（SHAKE_STRENGTH_FALLBACK / DRIFT_SPEED_FALLBACK / getStageModifierDuration
 * 的 0.5）须与 stagePresets["cam.shake"]/["cam.drift"] 的 `??` 默认保持同步——新增 modifierBased 命令
 * 时此处与 preset 同步更新，否则两边默认值又会裂。
 */
export function buildStageModifierApplyParams(command: string, rawParams: any): Record<string, any> {
  const params: Record<string, any> = { ...(rawParams || {}) };
  if (command === "cam.shake") {
    // strength：键序 strength / [0]，fallback SHAKE_STRENGTH_FALLBACK(5)——与 stagePresets["cam.shake"] 同源。
    const strengthRaw = rawParams?.strength ?? rawParams?.[0];
    params.strength = resolveStageNumeric(strengthRaw, SHAKE_STRENGTH_FALLBACK);
    if (rawParams?.[0] !== undefined) params[0] = params.strength;
    // duration：键序 duration / d / [1]，fallback 0.5——与 getStageModifierDuration 同源。
    const durationRaw = rawParams?.duration ?? rawParams?.d ?? rawParams?.[1];
    const duration = resolveStageNumeric(durationRaw, 0.5);
    params.duration = duration;
    if (rawParams?.d !== undefined) params.d = duration;
    if (rawParams?.[1] !== undefined) params[1] = duration;
  } else if (command === "cam.drift") {
    // strength：键序 strength / [0]，fallback 5——与 stagePresets["cam.drift"] 同源。
    const strengthRaw = rawParams?.strength ?? rawParams?.[0];
    params.strength = resolveStageNumeric(strengthRaw, SHAKE_STRENGTH_FALLBACK);
    if (rawParams?.[0] !== undefined) params[0] = params.strength;
    // speed：键序 speed / [1]，fallback DRIFT_SPEED_FALLBACK(0.001)——与 stagePresets["cam.drift"] 同源。
    const speedRaw = rawParams?.speed ?? rawParams?.[1];
    params.speed = resolveStageNumeric(speedRaw, DRIFT_SPEED_FALLBACK);
    if (rawParams?.[1] !== undefined) params[1] = params.speed;
  }
  return params;
}

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
   *
   * 两条形态：
   * - 正常（默认）：addModifier("shake") + gsap.to(state, {s:0, CAM_SHAKE_EASE, onComplete: removeModifier}）。§B-bis：tween.kill 抑制 onComplete。
   *   modifier 靠 tween onComplete 移除。state 衰减，所以 modifier 强度随时间归零。
   * - static（seek 重放专用）：`p.static === true`。addModifier 后**不创建衰减 tween**——
   *   modifier 以恒定强度保留，由调用方在下次 clearModifiers 时清掉（PlaybackController.replayStageModifiers
   *   走 seek 路径，ScriptPlayer.seekToTime 每次 seek 前都 clearModifiers，所以静态 modifier
   *   不会跨 seek 堆叠）。**不能复用 duration:0**——GSAP 零时长 tween 会同步触发 onComplete（§B-bis）→
   *   removeModifier 立即移除，结果是 no-op（用户写的 cam.shake(…,0) 语义也会被这个空洞污染）。
   *   strength 由调用方按 power2.out 衰减公式预算后传入。
   */
  "cam.shake": (p: any) => {
    const strength = p.strength ?? p[0] ?? 5;
    const duration = p.duration ?? p.d ?? p[1] ?? 0.5;

    // state.s 由衰减 tween 驱动 → modifier 强度随时间归零（power2.out）。R3 修复：闭包必须读
    // state.s（不能读常量 strength——否则 tween 衰减不生效，满强度抖到 onComplete 突然移除）。
    // static 模式下不创建 tween，state.s 固定为传入 strength，modifier 恒定强度。
    const state = { s: strength };

    stageRuntime.addModifier("shake", () => ({
      x: (Math.random() - 0.5) * state.s * 2,
      y: (Math.random() - 0.5) * state.s * 2,
    }));

    if (p.static === true) {
      // 静态重放：恒定强度（state.s = strength），不衰减、不自删。modifier 生命周期归 seek 流程管理
      // （clearModifiers）。**不能复用 duration:0**——GSAP 零时长 tween 同步 onComplete（§B-bis）→ removeModifier
      // 立即移除（no-op，且污染用户 cam.shake(…,0) 语义）。strength 由调用方按 CAM_SHAKE_EASE 衰减预算。
      return;
    }

    const tween = gsap.to(state, {
      s: 0, duration, ease: CAM_SHAKE_EASE,
      onComplete: () => stageRuntime.removeModifier("shake")
    });
    // R6-2：注册衰减 tween，clearModifiers / removeModifier 会 kill 它。否则旧 tween 的
    // onComplete（removeModifier("shake")）会在 clearModifiers + 新 shake 注册后误删新 modifier。
    stageRuntime.registerModifierTween("shake", tween);
    return tween;
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

  /**
   * 背景设置 (DIP-FX M2 Task B) —— bg(color) / bg(src) 双格式。
   * B1: bg(color) → setBackgroundColor 别名（最便宜）。Bug 5: 同时清除已有图片 sprite。
   * B2: bg(src="path/to/image.jpg") → Assets.load → cover-fit Sprite → backgroundLayer。
   *     editor-dev 级：从 public/ 直接加载，无 manifest/security gate。
   *     fire-and-forget async：apply 返回 null，图片异步加载后替换。
   *     Bug 7: 纪元号守卫——并发 bg(src) 丢弃过期 resolve。
   * B3: :bg filter 路由通过 stageManager.getBackgroundSprite() 获取精灵作为 DIP filter target。
   *     Bug 6: SegmentBuilder 通过 onBackgroundReady 注册回调，sprite 加载完成时延后 apply。
   */
  "bg": (p: any) => {
    const color = p.color ?? p[0];
    const src = p.src ?? p.source ?? p[1];

    // B1: 纯色背景 — Bug 5: 清除已有图片 sprite
    if (color !== undefined && src === undefined) {
      stageManager.setBackgroundColor(color);
      stageManager.setBackgroundSprite(null);
      return;
    }

    // B2: 图片背景（editor-dev 级，fire-and-forget）
    if (src !== undefined) {
      const baseUrl = (import.meta as any).env?.BASE_URL ?? "/";
      const url = src.startsWith("http") || src.startsWith("/") || src.startsWith("blob:")
        ? src
        : baseUrl + src.replace(/^\.\//, "");

      // bg(color, src) 的语义是先落纯色 fallback，再等待图片加载；必须清掉旧 sprite，
      // 否则旧图会遮住 fallback，且旧 :bg filters 可能继续显示到新图 resolve。
      if (color !== undefined) {
        stageManager.setBackgroundColor(color);
        stageManager.setBackgroundSprite(null, null, {
          unloadTexture: stageManager.bgSpriteUrl !== url,
        });
      }

      // 委托 StageManager.loadBackgroundFromUrl（含纪元守卫 + cover-fit + 就绪回调）
      stageManager.loadBackgroundFromUrl(url);
      return;
    }

    // 无参：默认黑色 — Bug 5: 清除已有图片 sprite
    stageManager.setBackgroundColor(0x000000);
    stageManager.setBackgroundSprite(null);
  },
};
