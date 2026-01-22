import { Container } from "pixi.js";
import type { EffectFunction, IEffectRegistry, EffectParams } from "./types";
import * as Presets from "./presets";

class EffectManager {
  private registry: IEffectRegistry = {};

  constructor() {
    // 自动加载所有预设
    this.registerBatch(Presets);
  }

  // 注册单个特效
  public register(name: string, effect: EffectFunction) {
    this.registry[name] = effect;
  }

  // 批量注册
  public registerBatch(effects: Record<string, EffectFunction>) {
    Object.assign(this.registry, effects);
  }

  // 应用特效的核心方法
  // name: "shake" | "wave"
  public apply(target: Container, name: string, params?: EffectParams) {
    const effectFn = this.registry[name];
    if (!effectFn) {
      console.warn(`[EffectManager] Unknown effect: ${name}`);
      return;
    }

    // 执行特效并返回 GSAP 实例（方便后续 kill）
    return effectFn(target, params);
  }
}

// 导出单例
export const effectManager = new EffectManager();
