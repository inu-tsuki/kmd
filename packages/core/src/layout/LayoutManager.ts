import type {
  LayoutCommand,
  LayoutCommandMetadata,
  LayoutCommandMetadataMap,
  LayoutOperator,
  LayoutExpander,
} from "./types";
import * as Presets from "./layoutPresets";
import * as Expanders from "./layoutExpanders";

class LayoutManager {
  private registry: Record<string, LayoutOperator> = {};
  private expanders: Record<string, LayoutExpander> = {};
  private operatorMetadata: Record<string, LayoutCommandMetadata> = {};
  private expanderMetadata: Record<string, LayoutCommandMetadata> = {};

  constructor() {
    this.registerBatch(Presets as Record<string, unknown>);
    this.registerExpanderBatch(Expanders as Record<string, unknown>);
    this.registerMetadataBatch(Presets.layoutPresetMetadata);
    this.registerExpanderMetadataBatch(Expanders.layoutExpanderMetadata);
  }

  public register(name: string, operator: LayoutOperator) {
    this.registry[name] = operator;
  }

  public registerBatch(presets: Record<string, unknown>) {
    Object.entries(presets).forEach(([k, v]) => {
      if (typeof v === "function") this.register(k, v as LayoutOperator);
    });
  }

  public registerExpander(name: string, expander: LayoutExpander) {
    this.expanders[name] = expander;
  }

  public registerExpanderBatch(expanders: Record<string, unknown>) {
    Object.entries(expanders).forEach(([k, v]) => {
      if (typeof v === "function") this.registerExpander(k, v as LayoutExpander);
    });
  }

  public registerMetadata(name: string, metadata: LayoutCommandMetadata) {
    this.operatorMetadata[name] = metadata;
  }

  public registerMetadataBatch(metadata: LayoutCommandMetadataMap) {
    Object.entries(metadata).forEach(([k, v]) => this.registerMetadata(k, v));
  }

  public registerExpanderMetadata(name: string, metadata: LayoutCommandMetadata) {
    this.expanderMetadata[name] = metadata;
  }

  public registerExpanderMetadataBatch(metadata: LayoutCommandMetadataMap) {
    Object.entries(metadata).forEach(([k, v]) => this.registerExpanderMetadata(k, v));
  }

  public has(name: string): boolean {
    if (!name) return false;
    return (name in this.registry) || (name in this.expanders);
  }

  // 供 IntelliSense/诊断枚举命令名；operator 与 expander 都是可用命令，合并去重
  public getRegisteredNames(): string[] {
    return [...new Set([...Object.keys(this.registry), ...Object.keys(this.expanders)])];
  }

  public getOperator(name: string): LayoutOperator | null {
    return this.registry[name] || null;
  }

  public getExpander(name: string): LayoutExpander | null {
    return this.expanders[name] || null;
  }

  public getOperatorMetadata(name: string): LayoutCommandMetadata | null {
    return this.operatorMetadata[name] || null;
  }

  public getExpanderMetadata(name: string): LayoutCommandMetadata | null {
    return this.expanderMetadata[name] || null;
  }

  public getMetadata(name: string): LayoutCommandMetadata | null {
    return this.getExpanderMetadata(name) || this.getOperatorMetadata(name);
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
