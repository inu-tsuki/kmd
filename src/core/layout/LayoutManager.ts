import type { LayoutCommand, LayoutOperator, LayoutExpander } from "./types";
import * as Presets from "./layoutPresets";
import * as Expanders from "./layoutExpanders";

class LayoutManager {
  private registry: Record<string, LayoutOperator> = {};
  private expanders: Record<string, LayoutExpander> = {};

  constructor() {
    this.registerBatch(Presets as Record<string, LayoutOperator>);
    this.registerExpanderBatch(Expanders as Record<string, LayoutExpander>);
  }

  public register(name: string, operator: LayoutOperator) {
    this.registry[name] = operator;
  }

  public registerBatch(presets: Record<string, LayoutOperator>) {
    Object.entries(presets).forEach(([k, v]) => this.register(k, v));
  }

  public registerExpander(name: string, expander: LayoutExpander) {
    this.expanders[name] = expander;
  }

  public registerExpanderBatch(expanders: Record<string, LayoutExpander>) {
    Object.entries(expanders).forEach(([k, v]) => this.registerExpander(k, v));
  }

  public has(name: string): boolean {
    if (!name) return false;
    return (name in this.registry) || (name in this.expanders);
  }

  public getOperator(name: string): LayoutOperator | null {
    return this.registry[name] || null;
  }

  public getExpander(name: string): LayoutExpander | null {
    return this.expanders[name] || null;
  }

  public generate(name: string, params: any): LayoutCommand | null {
    // 只要是已注册的算子或扩展器，都允许生成指令对象
    if (this.registry[name] || this.expanders[name]) {
      return { type: name as any, params, isCommand: true };
    }
    return null;
  }
}

export const layoutManager = new LayoutManager();
