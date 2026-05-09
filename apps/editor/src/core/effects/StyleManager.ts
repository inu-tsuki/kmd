import { TextStyle } from "pixi.js";
import type { StyleFunction, IStyleRegistry, EffectMetadata } from "./types";
import * as Presets from "./styles";

class StyleManager {
  private registry: IStyleRegistry = {};

  // Track applied mutex groups for each TextStyle object
  private activeMutexes: WeakMap<TextStyle, Set<string>> = new WeakMap();

  constructor() {
    // 自动加载所有静态样式预设
    this.registerBatch(Presets as unknown as Record<string, { fn: StyleFunction; meta: EffectMetadata }>);
  }

  public register(name: string, fn: StyleFunction, meta: EffectMetadata) {
    this.registry[name] = { fn, meta };
  }

  public registerBatch(styles: Record<string, { fn: StyleFunction; meta: EffectMetadata }>) {
    Object.assign(this.registry, styles);
  }

  public has(name: string) {
    return !!this.registry[name];
  }

  public getMetadata(name: string) {
    return this.registry[name]?.meta;
  }

  /**
   * 应用样式
   * @param style 目标样式对象
   * @param name 样式名
   * @param params 参数
   * @param force 是否强制覆盖互斥检查 (用于时序链)
   */
  public apply(
    style: TextStyle,
    name: string | string[],
    params: Record<string, any> = {},
    force: boolean = false
  ) {
    if (Array.isArray(name)) {
      name.forEach((n) => this.apply(style, n, params, force));
      return;
    }

    const entry = this.registry[name];
    if (!entry) {
      console.warn(`[StyleManager] Unknown style: ${name}`);
      return;
    }

    const { fn, meta } = entry;

    // --- Conflict Detection ---
    const overrideGroups = ['color', 'weight', 'size', 'sizeModifier', 'shadow', 'stroke'];
    if (meta.mutexGroup && !force) {
      let appliedMutexes = this.activeMutexes.get(style);
      if (!appliedMutexes) {
        appliedMutexes = new Set();
        this.activeMutexes.set(style, appliedMutexes);
      }

      if (appliedMutexes.has(meta.mutexGroup) && !overrideGroups.includes(meta.mutexGroup)) {
        console.warn(
          `%c[Style Conflict] Style group "${meta.mutexGroup}" already applied. Skipping "${name}".`,
          "color: orange; font-weight: bold;"
        );
        return;
      }

      appliedMutexes.add(meta.mutexGroup);
    }

    try {
      if (meta.mutexGroup === 'fontFamily') {
        console.log(`[StyleManager] Applying font family: "${name}" | params:`, params);
      }
      fn(style, params);
      if (meta.mutexGroup === 'fontFamily') {
        console.log(`[StyleManager] Style object now has fontFamily: "${style.fontFamily}"`);
      }
    } catch (err) {
      console.error(`[StyleManager] Error applying style "${name}":`, err);
    }
  }
}

export const styleManager = new StyleManager();
