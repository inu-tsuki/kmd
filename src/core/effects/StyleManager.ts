import { TextStyle } from "pixi.js";
import type { StyleFunction, IStyleRegistry, EffectMetadata } from "./types";
import * as Presets from "./styles";

class StyleManager {
  private registry: IStyleRegistry = {};
  
  // Track applied mutex groups for each TextStyle object
  // Using WeakMap to avoid memory leaks when TextStyle is destroyed
  private activeMutexes: WeakMap<TextStyle, Set<string>> = new WeakMap();

  constructor() {
    // 自动加载所有静态样式预设
    this.registerBatch(Presets as unknown as Record<string, { fn: StyleFunction; meta: EffectMetadata }>);
  }

  // 注册单个样式
  public register(name: string, fn: StyleFunction, meta: EffectMetadata) {
    this.registry[name] = { fn, meta };
  }

  // 批量注册
  public registerBatch(styles: Record<string, { fn: StyleFunction; meta: EffectMetadata }>) {
    Object.assign(this.registry, styles);
  }

  // 是否存在某个样式
  public has(name: string) {
    return !!this.registry[name];
  }

  // 应用样式，支持单个或多个样式同时应用
  public apply(
    style: TextStyle,
    name: string | string[],
    params?: Record<string, any>,
  ) {
    if (Array.isArray(name)) {
      name.forEach((n) => this.apply(style, n, params));
      return;
    }

    const entry = this.registry[name];
    if (!entry) {
      console.warn(`[StyleManager] Unknown style: ${name}`);
      return;
    }

    const { fn, meta } = entry;

    // --- Conflict Detection ---
    if (meta.mutexGroup) {
      let appliedMutexes = this.activeMutexes.get(style);
      if (!appliedMutexes) {
        appliedMutexes = new Set();
        this.activeMutexes.set(style, appliedMutexes);
      }

      if (appliedMutexes.has(meta.mutexGroup)) {
        console.warn(
          `%c[Style Conflict] Style group "${meta.mutexGroup}" already applied. Skipping "${name}".`,
          "color: orange; font-weight: bold;"
        );
        return;
      }

      appliedMutexes.add(meta.mutexGroup);
    }

    try {
      fn(style, params);
    } catch (err) {
      console.error(`[StyleManager] Error applying style "${name}":`, err);
    }
  }
}

export const styleManager = new StyleManager();