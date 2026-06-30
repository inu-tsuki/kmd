import { KineticChar } from "../KineticChar";
import { effectManager } from "./EffectManager";
import { styleManager } from "./StyleManager";
import { stageManager } from "../stage/StageManager";
import { TokenWrapper } from "../TokenWrapper";
import { KineticText } from "../KineticText";
import { RuntimeValueResolver } from "../runtime/RuntimeValueResolver";
import type { CommandLevel, EffectConfig } from "../parser/types";
import type { EffectTrack } from "./types";
import { Container, Filter, TextStyle } from "pixi.js";
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

export type EffectCommandLane =
  | "layout"
  | "stage"
  | "style"
  | "effect"
  | "unknown";

export type EffectChainHint =
  | "group_sync"
  | "char_stagger"
  | "char_tween"
  | "container_only"
  | "graph_gate"
  | "unknown";

export interface EffectCommandClassification {
  config: EffectConfig;
  lane: EffectCommandLane;
  track: EffectTrack | "stage" | "layout" | "unknown";
  isStyle: boolean;
  isLayout: boolean;
  isStage: boolean;
  participatesInStylePreview: boolean;
  defaultLevel?: CommandLevel;
  chainHint: EffectChainHint;
}

export class EffectProcessor {

  public static classifyCommand(config: EffectConfig): EffectCommandClassification {
    const isLayout = layoutManager.has(config.name);
    const isStage = stageManager.has(config.name) && !effectManager.has(config.name);
    const isStyle = styleManager.has(config.name);
    const effectMeta = effectManager.getMetadata(config.name);
    const effectRegistered = effectManager.has(config.name);

    const lane: EffectCommandLane = isLayout
      ? "layout"
      : isStage
        ? "stage"
        : isStyle
          ? "style"
          : effectRegistered
            ? "effect"
            : "unknown";

    const track: EffectCommandClassification["track"] = isLayout
      ? "layout"
      : isStage
        ? "stage"
        : effectMeta?.track ?? (isStyle ? "instant" : "unknown");

    return {
      config,
      lane,
      track,
      isStyle,
      isLayout,
      isStage,
      participatesInStylePreview: this.shouldApplyAsInitialStyle(config),
      defaultLevel: this.inferDefaultLevel(config),
      chainHint: this.inferChainHint(config),
    };
  }

  public static classifyCommands(configs: EffectConfig[]): EffectCommandClassification[] {
    return configs.map((config) => this.classifyCommand(config));
  }

  /**
   * 按 track 对特效列表进行分类
   * 这是 Timeline 构建的核心分流器
   */
  public static classifyByTrack(configs: EffectConfig[]): TrackClassifiedEffects {
    const result: TrackClassifiedEffects = {
      entrance: [], behavior: [], instant: [], timing: [], stage: []
    };

    for (const cfg of configs) {
      const classified = this.classifyCommand(cfg);
      if (classified.lane === "stage") {
        result.stage.push(cfg);
        continue;
      }

      if (
        classified.track === "entrance" ||
        classified.track === "behavior" ||
        classified.track === "instant" ||
        classified.track === "timing"
      ) {
        result[classified.track].push(cfg);
        continue;
      }

      if (classified.lane === "layout") continue;

      // 未知特效默认归入 instant
      result.instant.push(cfg);
    }

    return result;
  }

  /**
   * 查询单个特效的 track 类型
   */
  public static getTrack(name: string): EffectTrack | "stage" | "unknown" {
    const track = this.classifyCommand({ name, params: {} }).track;
    return track === "layout"
      ? "unknown"
      : track as EffectTrack | "stage" | "unknown";
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
      const classified = this.classifyCommand(cfg);
      if (classified.isLayout) {
        layoutCmds.push({ isCommand: true, type: cfg.name as any, params: cfg.params });
      } else if (classified.isStage) {
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
      const referenced = RuntimeValueResolver.resolveReference(v);
      resolved[k] = referenced !== undefined ? referenced : v;
    });
    return resolved;
  }

  /**
   * 提取 pause / hold 等时序指令的持续时长（秒）。INV-7 单一真相源——
   * 原本 `Number(params?.duration ?? params?.d ?? params?.[0] ?? <default>)` 在 7 处复制
   * （SA-19），default 随上下文不同（pause=1、char-hold=0.5、delay=0）。集中到此避免漂移。
   *
   * R9-Medium：用 `RuntimeValueResolver.resolveNumeric` 解析 `var.*` 引用——原 `Number()` 直接转
   * `Number("var.delay_val")=NaN`，导致 `hold(var.delay_val)` / `pause(var.delay_val)` 时长失效。
   * 与 stage 路径的 `resolveStageNumeric`（F-3）同源，保证 hold/pause 变量解析与运行时执行一致。
   * 样例 `apps/editor/public/tests/10-variables.kmd` 的"变量 hold 时长"预期依赖此。
   */
  public static resolvePauseDuration(params: any, defaultValue: number): number {
    const raw = params?.duration ?? params?.d ?? params?.[0] ?? defaultValue;
    return RuntimeValueResolver.resolveNumeric(raw, defaultValue);
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
    // R17/SA-32：经 classifyStyleWrite 单一真相源判定（P1 路径）。pre-hold 边界 + isStyle 统一此处。
    for (const config of configs) {
      const { isStyle, isBlocking } = this.classifyStyleWrite(config);
      if (isBlocking) break;
      if (isStyle) {
        const resolved = this.resolveParams(config.params);
        // 构建阶段强制为 false，防止冲突锁死后续动态修改
        styleManager.apply(style, config.name, resolved, false);
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

      // INV-7（SA-18）：容器级判定镜像 isCharLevelEffect 的反（action/group/显式 group-block → 容器）。
      // 原三段（isExplicitGroup/isPureGroupType/isActionDefault）等价于 !isCharLevelEffect。
      // groupHoldEncountered 是独立语义（post-hold 一律执行），保留 OR。
      const isContainerLevel = !this.isCharLevelEffect(config);
      const shouldExecute = isContainerLevel || groupHoldEncountered;

      if (shouldExecute) {
        const resolved = this.resolveParams(config.params);
        if (isStyle) {
          this.applyStyleRecursively(target, config.name, resolved, true);
        } else if (meta) {
          const result: any = effectManager.apply(target, config.name, resolved, true);
          this.processEffectResult(result, config, finalRes);
          // 契约守卫：block 级非 filter/behavior/entrance 特效经 applyGroupEffects 同步执行，
          // 不得 return 资源（filter/tween/{filters,tickerFn}/{tween,filter}）。需 return 资源的
          // block 级特效必须像 instant/behavior filter 或 entrance 那样在 SegmentBuilder 分流进
          // record 通道，否则 seek/stop/clearScreen 清不到 → 资源泄漏。
          if (result instanceof Filter || result instanceof gsap.core.Tween
              || result instanceof gsap.core.Timeline
              || (result && typeof result === 'object'
                  && ('filters' in result || 'tickerFn' in result
                      || ('tween' in result && 'filter' in result)))) {
            console.warn(
              `[EffectProcessor] block 级特效 "${config.name}" 经 applyGroupEffects 返回了资源 ` +
              `（filter/tween/{filters,tickerFn}/{tween,filter}），不进 cleanup record → seek/stop 时泄漏。` +
              `请在 SegmentBuilder 分流该特效进 record 通道（参考 blockInstant/blockBehavior/blockEntrance 分支）。`
            );
          }
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
        if (this.shouldLogTimingDiagnostics()) {
          console.log(`[Timing-Trace] Sugar: slow, multiplier: ${res.speedMultiplier}`);
        }
      }
      else if (s.name === "fast") {
        res.speedMultiplier = s.params[0] ?? 0.5;
        if (this.shouldLogTimingDiagnostics()) {
          console.log(`[Timing-Trace] Sugar: fast, multiplier: ${res.speedMultiplier}`);
        }
      }
    }
    return res;
  }

  private static shouldLogTimingDiagnostics() {
    try {
      const runtimeConfig = (globalThis as any).KmdRuntimeConfig;
      if (runtimeConfig?.debugOverlay === true || runtimeConfig?.settings?.debugOverlay === true) {
        return true;
      }
      const params = new URLSearchParams(globalThis.location?.search ?? "");
      return params.get("kmdDebugProbe") === "1" || params.get("kmdTimingDiag") === "1";
    } catch {
      return false;
    }
  }

  public static shouldApplyAsInitialStyle(config: EffectConfig): boolean {
    // R19/SA-33：与 classifyStyleWrite 同源（同一 pre-hold 边界 + isStyle 判定），避免边界表达式
    // 漂移。其产物 participatesInStylePreview 目前无消费方（grep 确认），但保持同源以防将来接消费时
    // 踩 group/block style 的同缝（见 classifyStyleWrite doc）。
    const { isStyle, isBlocking } = this.classifyStyleWrite(config);
    return isStyle && !isBlocking;
  }

  /**
   * R17/SA-32：style 资源身份判定的**单一真相源**。
   *
   * 背景：R13-R16 四轮修复 INV-7 在 style 数据流的四个形态（窗口耦合 SA-28 / 多路径清理 SA-29 /
   * baseline 错位 SA-30 / 第二条构建路径 SA-31），但"初始态 vs 动态变更"的判定 + pre-hold 边界
   * 仍散落在 P1-P5 各写入路径，每条独立实现。R17 把判定收敛到此处——所有 style 写入路径经
   * `classifyStyleWrite` 拿 `{isStyle, isBlocking}`，调用方维护 `holdEncountered` 游标算
   * `isInitial = isStyle && !holdEncountered`（pre-hold，进 baseline，不 record）、
   * `isDynamic = isStyle && holdEncountered`（post-hold，进 record，不 baseline）。
   *
   * 无状态设计：单看一个 config 无法知道"是否在 pre-hold 窗口内"（需知道前面有没有遇过
   * blocking），故只返回 `{isStyle, isBlocking}`，游标由调用方局部维护。这统一了"边界判定 +
   * isStyle 判定"——消除 site1 旧 `hold||blocking` 漏 group/block 的不一致（该不一致已随 R15
   * site1 删除消除，此处把"正确边界"固化进 helper 防回退）。
   *
   * pre-hold 边界 = `hold || blocking || level==="group" || level==="block"`（非 style 时），
   * 与 `applyInitialStylesToStyle`（P1）原始边界对齐（R15 site3 已对齐、site1 已删）。
   *
   * **R19/SA-33**：style 与"非 style 边界"解耦。原 v1.0.0 边界对 style 也判 `level==="group"||"block"`
   *（无设计理由——早于 R13-R17 全部审计），导致显式 group/block style（如 `f.red:group`、token 级
   * `f.red:block`）既不进 baseline（P1 遇 isBlocking 直接 break）、也不进 record（site2 `if(isStyle)
   * return false` 跳过），被整条吞掉。style 经 `applyStyleRecursively` 最终落到每个 KineticChar，
   * 不分容器/逐字语义，应与 char/block 同模型进 baseline + 测量（R15/R16）。故 style 不受 level 边界
   * 阻断——只有**非 style** 的容器级特效（filter/timing/stage）才把 `level==="group"||"block"` 当终止烘焙边界。
   * post-hold 的 group/block style（链中 hold 之后）仍由调用方游标判 isDynamic → 进 record（site2/3）。
   */
  public static classifyStyleWrite(config: EffectConfig): { isStyle: boolean; isBlocking: boolean } {
    const isStyle = styleManager.has(config.name);
    // R19/SA-33：style 不受 level==="group"/"block" 边界阻断（见上 doc）。仅非 style 时这些 level 才终止烘焙。
    const isStyleScoped = isStyle && (config.level === "group" || config.level === "block");
    const isBlocking = !isStyleScoped && (
      config.name === "hold" ||
      config.blocking ||
      config.level === "group" ||
      config.level === "block"
    );
    return { isStyle, isBlocking };
  }

  private static inferDefaultLevel(config: EffectConfig): CommandLevel | undefined {
    if (config.level) return config.level;
    const meta = effectManager.getMetadata(config.name);
    if (meta?.targetType === "char") return "char";
    if (meta?.targetType === "group") return "group";
    // targetType:"both" 的默认 level 由 isCharLevelEffect 判定（含 action 排除语义）。
    return undefined;
  }

  /**
   * INV-7（SA-18）单一真相源：判定一个特效是否应按"逐字 char 级"应用。
   *
   * 规则：
   * - 显式 `level === "char"` → 是。
   * - 无显式 level + `targetType ∈ {char, both}` → 是，**但排除 `type === "action"`**
   *   （action 类特效如 go/slow/fast/wait 经 timing 路径处理，不该逐字 apply）。
   * - 其余（group/block 显式、targetType:"group"、无 level 的 action）→ 否。
   *
   * 调用点：applyGroupEffects（镜像：!isCharLevelEffect 即容器级）、
   * TextPlayer.unrollGroupChain 的 isCharLevel（路由决策）。统一经此 helper 消除 drift。
   * 注意：style 特效不进此判定——它们经 styleManager.has gate 走 applyStyleRecursively。
   * （历史注记：applyCharEffects 曾是第三个调用点，已确认为死代码删除——见 self-audit §4 R-A。）
   */
  public static isCharLevelEffect(config: EffectConfig): boolean {
    if (config.level === "char") return true;
    if (config.level) return false; // group/block 显式
    const meta = effectManager.getMetadata(config.name);
    if (!meta) return false;
    if (meta.type === "action") return false;
    return meta.targetType === "char" || meta.targetType === "both";
  }

  private static inferChainHint(config: EffectConfig): EffectChainHint {
    const meta = effectManager.getMetadata(config.name);
    if (layoutManager.has(config.name) || (stageManager.has(config.name) && !effectManager.has(config.name))) {
      return "graph_gate";
    }
    if (config.name === "hold" && config.level === "char") return "char_stagger";
    if (config.name === "hold") return "group_sync";
    if (config.level === "group" || config.level === "block" || meta?.targetType === "group") {
      return "container_only";
    }
    if (meta?.track === "entrance" && (meta.targetType === "char" || meta.targetType === "both")) {
      return "char_tween";
    }
    return "unknown";
  }
}
