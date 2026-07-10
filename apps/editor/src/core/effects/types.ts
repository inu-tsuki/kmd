import { Container } from "pixi.js";
import { TextStyle } from "pixi.js";

/**
 * 时间轨道分类 (Triple-Track)
 * - entrance: 入场/一次性动画，返回 Tween，挂载到 Segment Timeline，可 seek
 * - behavior: 持续物理行为，注册到 Ticker，seek 时重启
 * - instant:  立即生效的样式/滤镜，无时间维度
 * - timing:   时序控制指令 (go/slow/fast/wait)，转化为 Timeline 位置偏移
 */
export type EffectTrack = "entrance" | "behavior" | "instant" | "timing";
export type EffectSurface = "text" | "background";

export interface EffectMetadata {
  type: "behavior" | "style" | "filter" | "action" | "anim";
  track: EffectTrack;
  targetType: "char" | "group" | "both";
  mutexGroup?: string; // 互斥组名，例如 "color", "enter_anim"
  stackable?: boolean; // 是否允许同组叠加 (默认 false)
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
