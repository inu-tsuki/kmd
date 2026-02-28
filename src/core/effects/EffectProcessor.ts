import { KineticChar } from "../KineticChar";
import { effectManager } from "./EffectManager";
import { styleManager } from "./StyleManager";
import { stageManager } from "../stage/StageManager";
import { TokenWrapper } from "../TokenWrapper";
import { KineticText } from "../KineticText";
import { layout } from "../layout/LayoutEngine";
import type { EffectConfig } from "../parser/types";
import type { EffectTrack } from "./types";
import { Container, TextStyle } from "pixi.js";
import { layoutManager } from "../layout/LayoutManager";
import type { LayoutCommand } from "../layout/types";
import gsap from "gsap";

export interface EffectLogicResult {
  delayOverride?: number;
  speedMultiplier?: number;
  blockAdvanceRequested?: boolean;
}

/**
 * 按 track 分类的特效配置，供 Timeline 构建器使用
 */
export interface TrackClassifiedEffects {
  entrance: EffectConfig[];   // 入场动画，生成 Tween 挂到 Timeline
  behavior: EffectConfig[];   // 持续行为，注册到 Ticker
  instant: EffectConfig[];    // 样式/滤镜，立即应用
  timing: EffectConfig[];     // 时序控制 (go/slow/fast/wait)
  stage: EffectConfig[];      // 舞台指令 (cam.move 等)
}

export class EffectProcessor {

  /**
   * 按 track 对特效列表进行分类
   * 这是 Timeline 构建的核心分流器
   */
  public static classifyByTrack(configs: EffectConfig[]): TrackClassifiedEffects {
    const result: TrackClassifiedEffects = {
      entrance: [], behavior: [], instant: [], timing: [], stage: []
    };

    for (const cfg of configs) {
      // 舞台指令优先判断（它们不在 effectManager 中注册）
      if (stageManager.has(cfg.name) && !effectManager.has(cfg.name)) {
        result.stage.push(cfg);
        continue;
      }

      // 查询特效元数据获取 track
      const meta = effectManager.getMetadata(cfg.name);
      if (meta?.track) {
        result[meta.track].push(cfg);
        continue;
      }

      // 样式兜底：StyleManager 中的都是 instant
      if (styleManager.has(cfg.name)) {
        result.instant.push(cfg);
        continue;
      }

      // 布局指令不归入任何 track（已在 partition 中处理）
      if (layoutManager.has(cfg.name)) continue;

      // 未知特效默认归入 instant
      result.instant.push(cfg);
    }

    return result;
  }

  /**
   * 查询单个特效的 track 类型
   */
  public static getTrack(name: string): EffectTrack | "stage" | "unknown" {
    if (stageManager.has(name) && !effectManager.has(name)) return "stage";
    const meta = effectManager.getMetadata(name);
    if (meta?.track) return meta.track;
    if (styleManager.has(name)) return "instant";
    return "unknown";
  }
  public static partition(configs: EffectConfig[]): {
    layoutCmds: LayoutCommand[];
    visualConfigs: EffectConfig[];
    stageConfigs: EffectConfig[];
  } {
    const layoutCmds: LayoutCommand[] = [];
    const visualConfigs: EffectConfig[] = [];
    const stageConfigs: EffectConfig[] = [];

    configs.forEach((cfg) => {
      if (layoutManager.has(cfg.name)) {
        layoutCmds.push({ isCommand: true, type: cfg.name as any, params: cfg.params });
      } else if (!effectManager.has(cfg.name) && stageManager.has(cfg.name)) {
        stageConfigs.push(cfg);
      } else {
        visualConfigs.push(cfg);
      }
    });

    return { layoutCmds, visualConfigs, stageConfigs };
  }

  public static resolveParams(params: any): any {
    if (!params) return {};
    const resolved: any = {};
    Object.entries(params).forEach(([k, v]) => {
      if (typeof v === 'string' && v.startsWith("var.")) {
        const marker = layout.globalMarkers.get(v);
        resolved[k] = marker ? marker.x : v;
      } else {
        resolved[k] = v;
      }
    });
    return resolved;
  }

  public static applyStyleRecursively(target: Container, name: string, params: any, force: boolean) {
    const resolved = this.resolveParams(params);
    if (target instanceof KineticChar) {
      styleManager.apply(target.style, name, resolved, force);
    } else if (target instanceof TokenWrapper) {
      target.chars.forEach(c => styleManager.apply(c.style, name, resolved, force));
    } else if (target instanceof KineticText) {
      target.tokens.forEach(t => t.chars.forEach(c => styleManager.apply(c.style, name, resolved, force)));
    }
  }

  public static applyInitialStylesToStyle(style: TextStyle, configs: EffectConfig[]) {
    for (const config of configs) {
      const isBlocking = config.name === "hold" || config.blocking || config.level === "group" || config.level === "block";
      if (isBlocking) break;
      if (styleManager.has(config.name)) {
        const resolved = this.resolveParams(config.params);
        // 构建阶段强制为 false，防止冲突锁死后续动态修改
        styleManager.apply(style, config.name, resolved, false);
      }
    }
  }

  public static applyInitialStyles(target: Container, configs: EffectConfig[]) {
    for (const config of configs) {
      const isBlocking = config.name === "hold" || config.blocking || config.level === "group" || config.level === "block";
      if (isBlocking) break;
      if (styleManager.has(config.name)) {
        if (target instanceof KineticChar) {
          const resolved = this.resolveParams(config.params);
          styleManager.apply(target.style, config.name, resolved, false);
        }
      }
    }
  }

  private static processEffectResult(result: any, config: EffectConfig, finalRes: EffectLogicResult) {
    if (!result) return;
    if (result.type === "delay") {
      finalRes.delayOverride = result.value;
      if (config.level === "block") finalRes.blockAdvanceRequested = true;
    } else if (result.type === "speedMultiplier") {
      finalRes.speedMultiplier = result.value;
    } else if (typeof result === 'number') {
      finalRes.delayOverride = result;
      if (config.level === "block") finalRes.blockAdvanceRequested = true;
    }
  }

  public static async applyGroupEffects(target: Container, effects: EffectConfig[]): Promise<EffectLogicResult> {
    const { visualConfigs, stageConfigs } = this.partition(effects);
    let groupHoldEncountered = false;
    const finalRes: EffectLogicResult = {};

    // 1. 舞台指令
    for (const config of stageConfigs) {
       const result = stageManager.apply(config.name, config.params);
       this.processEffectResult(result, config, finalRes);
       if ((config.name === "pause" || config.blocking) && result) await result;
    }

    // 2. 视觉链条
    for (const config of visualConfigs) {
      const meta = effectManager.getMetadata(config.name);
      const isStyle = styleManager.has(config.name);
      const isBlocking = config.name === "hold" || config.blocking;

      if (isBlocking && config.level === "char") continue;

      const isExplicitGroup = config.level === "group" || config.level === "block";
      const isPureGroupType = meta && meta.targetType === "group";
      const isActionDefault = !config.level && meta && meta.type === "action";
      const shouldExecute = isExplicitGroup || isPureGroupType || isActionDefault || groupHoldEncountered;

      if (shouldExecute) {
        const resolved = this.resolveParams(config.params);
        if (isStyle) {
          this.applyStyleRecursively(target, config.name, resolved, true);
        } else if (meta) {
          const result: any = effectManager.apply(target, config.name, resolved, true);
          this.processEffectResult(result, config, finalRes);
          if (isBlocking) {
            if (result && typeof result.then === 'function') await result;
            else if (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline) await result;
          }
        } else if (layoutManager.has(config.name)) {
          // 动态排版接力：如果是一个排版指令但在播放期触发
          if (target instanceof KineticChar) {
             // 单字位移暂不支持直接 apply，需转换或跳过，通常排版指令对 Group 更有效
          } else {
             const kt = (target as any).parent instanceof KineticText ? (target as any).parent : null;
             if (kt && typeof kt.applyDynamicLayout === 'function') {
                 kt.applyDynamicLayout(config.name, resolved);
             }
          }
        }
      }
      if (isBlocking && config.level !== "char") groupHoldEncountered = true;
    }
    return finalRes;
  }

  /**
   * 专门处理节奏糖衣 (Timing Phase)
   * 这些指令是即时的，不参与阻塞
   */
  public static resolveTiming(sugars: any[]): EffectLogicResult & { advanceLevel?: string } {
    const res: EffectLogicResult & { advanceLevel?: string } = {};
    for (const s of sugars) {
       if (s.name === "go") {
         res.advanceLevel = s.level; 
         res.delayOverride = s.params[0] ?? 0;
         if (s.level === "group" || s.level === "block") {
            res.blockAdvanceRequested = true;
         }
       }
       else if (s.name === "slow") {
         res.speedMultiplier = s.params[0] ?? 2.0;
         console.log(`[Timing-Trace] Sugar: slow, multiplier: ${res.speedMultiplier}`);
       }
       else if (s.name === "fast") {
         res.speedMultiplier = s.params[0] ?? 0.5;
         console.log(`[Timing-Trace] Sugar: fast, multiplier: ${res.speedMultiplier}`);
       }
    }
    return res;
  }

  public static async applyCharEffects(char: KineticChar, effects: EffectConfig[], charIndex: number): Promise<EffectLogicResult> {
    const finalRes: EffectLogicResult = {};
    
    // 视觉链执行
    for (const config of effects) {
      const meta = effectManager.getMetadata(config.name);
      const isStyle = styleManager.has(config.name);
      const isBlocking = config.name === "hold" || config.blocking;

      // 核心修正：如果该样式属于”初始样式”（即在第一个阻塞指令之前），
      // 则跳过应用，因为在 LayoutStreamBuilder 阶段它已经反映在 char.style 中了。
      // 这彻底解决了 big/small 效果叠加两次导致字号变为 81 或 23 的问题。
      if (isStyle && !isBlocking) {
          continue; 
      }

      // 核心修正：如果是非 char 级的阻塞，在单字执行阶段跳过（交给组执行），但不能停止后续样式的应用
      if (isBlocking && config.level !== "char") {
          break; 
      }

      const resolved = this.resolveParams(config.params);
      if (isStyle) {
        styleManager.apply(char.style, config.name, resolved, true);
      } else {
        const isExplicitChar = config.level === "char";
        const isBothCharMatch = !config.level && meta && meta.targetType === "both" && meta.type !== "action";
        const isPureCharType = meta && meta.targetType === "char";

        if (isExplicitChar || isPureCharType || isBothCharMatch) {
          if (meta?.mutexGroup === "enter") {
            const autoParams = { ...resolved, delay: ((resolved.delay || 0) as number) + charIndex * 0.05 };
            char.pendingEnterConfig = { ...config, params: autoParams };
          } else {
            const autoParams = { ...resolved, charIndex };
            const result: any = effectManager.apply(char, config.name, autoParams, true);
            this.processEffectResult(result, config, finalRes);
            if (isBlocking && config.level === "char") {
              if (result && typeof result.then === 'function') await result;
              else if (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline) await result;
            }
          }
        }
      }
    }
    return finalRes;
  }
}
