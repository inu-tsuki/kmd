import type { EffectConfig, KMDLineData, KMDToken } from "./types";
import { effectManager } from "../effects/EffectManager";
import { styleManager } from "../effects/StyleManager";

export class KMDParser {
  // 辅助函数：解析参数字符串 "delay=0.1, strength=5" -> { delay: 0.1, strength: 5 }
  private parseParams(paramStr: string): Record<string, any> {
    const params: Record<string, any> = {};
    if (!paramStr) return params;

    const pairs = paramStr.split(",");
    pairs.forEach((pair) => {
      const [key, val] = pair.split("=").map((s) => s.trim());
      if (key && val) {
        // 尝试转数字，转不了就存字符串
        const numVal = parseFloat(val);
        params[key] = isNaN(numVal) ? val : numVal;
      }
    });
    return params;
  }

  public parse(input: string): KMDLineData {
    const tokens: KMDToken[] = [];
    const globalEffects: EffectConfig[] = [];
    const formatQueue: EffectConfig[][] = []; // 队列：存储等待分配给 {} 的特效组

    // 1. 切分正文与指令区
    const [bodyPart, commandPart] = input.split("@").map((s) => s.trim());
    if (!bodyPart) {
      return { tokens, globalEffects };
    }

    // 2. 解析指令区 (The Command Parser)
    // 我们需要提取三种东西：
    // - f.red (单样式)
    // - f(red, bold) (组合样式)
    // - .shake (全局特效)

    if (commandPart) {
      // 正则解释：
      // f\.([\w-]+)         -> 匹配 f.popIn
      // (?:\(([^)]+)\))?    -> 可选匹配 (delay=0.1)，捕获括号内的内容
      // 允许链式调用 f.A(..).B(..)

      // 【关键修复】步骤 0: 保护括号内的空格
      // 将 (a, b) 变成 (a,__SPACE__b) 防止被 split 切断
      const safeCommandPart = commandPart.replace(/\([^)]+\)/g, (m) => {
        return m.replace(/\s/g, "__SPACE__");
      });

      // 为了处理链式且带参数的情况，简单的 split('.') 已经不够用了。
      // 我们需要一个更强大的正则循环来提取。

      // 策略：先按空格切分不同的指令组（假设 f.A.B 是连在一起的）
      const cmdGroups = safeCommandPart.split(/\s+/);

      cmdGroups.forEach((groupStr) => {
        if (groupStr.startsWith("f.")) {
          // 处理格式化指令: f.popIn(d=1).shake
          // 这是一个复杂的解析，为了 MVP，我们假设用户写 f.popIn(d=1) f.shake
          // 或者我们需要写一个针对 groupStr 的 parser

          // 简易实现：只支持单个带参指令，或者用 f(...) 组合
          // 让我们实现针对 "f.name(args).name2(args)" 的解析

          const effectsInGroup: EffectConfig[] = [];
          // 正则：匹配 .name(args) 或 .name
          const chainRegex = /\.([\w-]+)(?:\(([^)]+)\))?/g;
          let chainMatch;

          // 从第 2 个字符开始匹配（跳过开头的 'f'）
          while ((chainMatch = chainRegex.exec(groupStr)) !== null) {
            const effectName = chainMatch[1];
            const argsStr = chainMatch[2]
              ? chainMatch[2].replace(/__SPACE__/g, " ")
              : undefined;

            effectsInGroup.push({
              name: effectName || "",
              params: this.parseParams(argsStr || ""),
            });
            console.log(
              "[Parser] Parsed effect:",
              effectName,
              "with params:",
              argsStr,
            );
          }

          if (effectsInGroup.length > 0) formatQueue.push(effectsInGroup);
        } else if (groupStr.startsWith(".")) {
          // 全局指令 .glitch(s=1)
          const chainRegex = /\.([\w-]+)(?:\(([^)]+)\))?/g;
          let chainMatch;
          while ((chainMatch = chainRegex.exec(groupStr)) !== null) {
            globalEffects.push({
              name: chainMatch[1] || "",
              params: this.parseParams(
                chainMatch[2] ? chainMatch[2].replace(/__SPACE__/g, " ") : "",
              ),
            });
            console.log(
              "[Parser] Parsed global effect:",
              chainMatch[1],
              "with params:",
              chainMatch[2],
            );
          }
        }
      });
    }

    // 3. 解析正文区 (The Body Parser)
    // 正则逻辑保持不变
    const bodyRegex = /\{([^}]+)\}|([^{]+)/g;
    let match;
    let hasBraces = false; // 标记：是否发现了包围符

    while ((match = bodyRegex.exec(bodyPart)) !== null) {
      const braceContent = match[1];
      const plainContent = match[2];

      if (braceContent) {
        hasBraces = true; // 发现显式 Token
        const assignedEffects = formatQueue.shift() || [];

        tokens.push({
          content: braceContent,
          effects: assignedEffects,
          commands: [],
          params: {},
        });
      } else if (plainContent) {
        // 普通文字暂时不分配特效，先存着
        tokens.push({
          content: plainContent,
          effects: [],
          commands: [],
          params: {},
        });
      }
    }

    // --- 4. 后处理逻辑：自动降级 ---
    // 如果全句没有 {}，但队列里有残留的格式化指令
    // 例如: "System Failure @ f.red.shake"
    if (!hasBraces && formatQueue.length > 0) {
      // 取出第一个指令组 (比如 ['red', 'shake'])
      const fallbackEffects = formatQueue.shift() || [];

      // 将其应用到所有的普通文字 Token 上
      tokens.forEach((t) => {
        t.effects = [...t.effects, ...fallbackEffects];
      });
    }

    return { tokens, globalEffects };
  }

  public validate(input: string): string[] {
    const errors: string[] = [];
    const { tokens } = this.parse(input);

    // 检查所有 Token
    tokens.forEach((token) => {
      // 检查特效是否存在
      token.effects.forEach((eff) => {
        if (!effectManager.has(eff.name) && !styleManager.has(eff.name)) {
          errors.push(
            `Unknown effect: "${eff.name}" in token "{${token.content}}"`,
          );
        }
      });

      // TODO: 静态检查互斥（高级）
      // 这需要 effectManager 暴露查询 mutexGroup 的接口
      // 比如检查 eff.name 和 eff2.name 是否属于同一组
    });

    return errors;
  }
}

export const parser = new KMDParser();
