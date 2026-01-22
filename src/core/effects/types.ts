import { Container } from "pixi.js";

// 特效配置参数（允许用户自定义，例如 f.shake(strength=10)）
export interface EffectParams {
  duration?: number;
  delay?: number;
  repeat?: number; // -1 代表无限循环
  [key: string]: any; // 允许其他任意参数，如 strength, frequency
}

// 特效函数签名
// target: 可以是整段文字(KineticText)，也可以是单个字(Text)
export type EffectFunction = (
  target: Container,
  params?: EffectParams,
) => gsap.core.Tween | gsap.core.Timeline | void;

// 注册表结构
export interface IEffectRegistry {
  [name: string]: EffectFunction;
}
