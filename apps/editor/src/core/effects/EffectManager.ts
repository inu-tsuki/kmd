import { Container } from "pixi.js";
import type { EffectMetadata, EffectFunction, EffectParams } from "./types";
import * as Presets from "./presets";

class EffectManager {
  // 存储特效实现的 Map
  private registry: Record<
    string,
    { fn: EffectFunction; meta: EffectMetadata }
  > = {};

  // 运行时记录：记录每个对象当前身上的互斥组
  // Key: Container Object Reference
  // Value: Set<MutexGroupName>
  // Using WeakMap to auto-clean when Container is destroyed
  private activeMutexes: WeakMap<Container, Set<string>> = new WeakMap();

  constructor() {
    // 自动加载所有预设
    this.registerBatch(Presets);
  }

  // 注册单个特效
  public register(name: string, fn: EffectFunction, meta: EffectMetadata) {
    this.registry[name] = { fn, meta };
  }

  // 批量注册
  public registerBatch(
    effects: Record<string, { fn: EffectFunction; meta: EffectMetadata }>,
  ) {
    Object.assign(this.registry, effects);
  }

  public has(name: string): boolean {
    return !!this.registry[name];
  }

  public getMetadata(name: string): EffectMetadata | undefined {
    return this.registry[name]?.meta;
  }

  // 应用特效的核心方法
  public apply(target: Container, name: string, params: EffectParams = {}, force: boolean = false) {
    console.log(`[EffectManager] Applying effect: ${name}`, params);
    const entry = this.registry[name];
    if (!entry) {
      console.warn(`[Effect] Unknown: ${name}`);
      return;
    }
    const { fn, meta } = entry;

    // --- 冲突检测核心逻辑 ---
    if (meta.mutexGroup && !force) {
      // 获取该对象已有的互斥组
      let targetMutexes = this.activeMutexes.get(target);
      if (!targetMutexes) {
        targetMutexes = new Set();
        this.activeMutexes.set(target, targetMutexes);
      }

      // 检查是否冲突
      // 如果已存在该组且不允许叠加，则冲突
      if (targetMutexes.has(meta.mutexGroup) && !meta.stackable) {
        console.warn(
          `%c[Effect Conflict] Token "${(target as any).text || "wrapper"}" already has an effect from group "${meta.mutexGroup}". Skipping "${name}".`,
          "color: orange; font-weight: bold;",
        );
        return;
      }

      // 记录新的互斥组
      targetMutexes.add(meta.mutexGroup);
    }

    // 执行
    return fn(target, params);
  }
}

// 导出单例
export const effectManager = new EffectManager();