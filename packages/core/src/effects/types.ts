import { Container } from "pixi.js";
import { TextStyle } from "pixi.js";
import type { CommandArgumentUnit, CommandArgumentUnits } from "../types/command";

/**
 * 时间轨道分类 (Triple-Track)
 * - entrance: 入场/一次性动画，返回 Tween，挂载到 Segment Timeline，可 seek
 * - behavior: 持续物理行为，注册到 Ticker，seek 时重启
 * - instant:  立即生效的样式/滤镜，无时间维度
 * - timing:   时序控制指令 (go/slow/fast/wait)，转化为 Timeline 位置偏移
 */
export type EffectTrack = "entrance" | "behavior" | "instant" | "timing";
export type EffectSurface = "text" | "background";

/**
 * 可序列化的 preset 参数描述。运行时 preset 与 LSP/Inspector 可以读取同一份
 * 默认值和边界，避免工具层再维护一张镜像表。
 */
export interface EffectParameterMetadata {
  type: "number" | "color" | "boolean" | "string";
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  description: string;
  unit?: CommandArgumentUnit;
}

export interface EffectMetadata {
  type: "behavior" | "style" | "filter" | "action" | "anim";
  track: EffectTrack;
  targetType: "char" | "group" | "both";
  mutexGroup?: string; // 互斥组名，例如 "color", "enter_anim"
  stackable?: boolean; // 是否允许同组叠加 (默认 false)
  /** 面向效果库浏览和工具投影的稳定分类；不参与运行时路由。 */
  category?: string;
  /** 参数默认值与合法边界；preset 实现应复用此 schema 做归一化。 */
  parameters?: Readonly<Record<string, EffectParameterMetadata>>;
  /** 裸数字的默认单位由注册表 metadata 提供，语法层不补单位。 */
  argumentUnits?: CommandArgumentUnits;
  /** Internal style record replayed with the effect to preserve cross-lane source order. */
  replayStyle?: string;
  /**
   * 内部样式：参与 apply 互斥记账，但对 has() 与 getRegisteredNames() 隐藏——
   * 不渗入 commandCatalog 已知命令门、IntelliSense、分类钉表，不扩大语言表面。
   * （主题二 S3：处方 6(d) rainbow 散写收口引入。）
   */
  internal?: boolean;
}

// 特效配置参数（允许用户自定义，例如 f.shake(strength=10)）
export interface EffectParams {
  duration?: number;
  delay?: number;
  repeat?: number; // -1 代表无限循环
  [key: string]: any; // 允许其他任意参数，如 strength, frequency
}

// 特效函数签名
export type EffectFunction = (
  target: Container,
  params?: EffectParams,
) => gsap.core.Tween | gsap.core.Timeline | Promise<void> | any;

export interface EffectDefinition {
  fn: EffectFunction;
  meta: EffectMetadata;
  profiles?: Partial<Record<EffectSurface, EffectFunction>>;
}

// 注册表结构
export interface IEffectRegistry {
  [name: string]: EffectDefinition;
}

// 样式处理器：接收一个 TextStyle 对象并直接修改它
export type StyleFunction = (style: TextStyle, params?: any) => void;

export interface IStyleRegistry {
  [name: string]: {
    fn: StyleFunction;
    meta: EffectMetadata;
  };
}
