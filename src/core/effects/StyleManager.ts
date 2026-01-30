import { TextStyle } from "pixi.js";
import type { StyleFunction, IStyleRegistry } from "./types";
import * as Presets from "./styles";

class StyleManager {
  private registry: IStyleRegistry = {};

  constructor() {
    // 自动加载所有静态样式预设
    this.registerBatch(Presets as Record<string, StyleFunction>);
  }

  // 注册单个样式
  public register(name: string, styleFn: StyleFunction) {
    this.registry[name] = styleFn;
  }

  // 批量注册
  public registerBatch(styles: Record<string, StyleFunction>) {
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
      name.forEach((n) => this.apply(style, n));
      return;
    }

    const styleFn = this.registry[name];
    if (!styleFn) {
      console.warn(`[StyleManager] Unknown style: ${name}`);
      return;
    }

    try {
      styleFn(style, params);
    } catch (err) {
      console.error(`[StyleManager] Error applying style "${name}":`, err);
    }
  }
}

export const styleManager = new StyleManager();
