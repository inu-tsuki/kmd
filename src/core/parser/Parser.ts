import type { KMDLineData, KMDToken } from "./types";

export class KMDParser {
  public parse(input: string): KMDLineData {
    const tokens: KMDToken[] = [];
    const globalEffects: string[] = [];

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

    const formatQueue: string[][] = []; // 队列：存储等待分配给 {} 的特效组

    if (commandPart) {
      // 正则解释：
      // 1. f\(([^)]+)\)  -> 匹配 f(red, bold) 捕获 "red, bold"
      // 2. f\.([\w\.-]+)  -> 匹配 "f.border.shake.red"
      // 3. \.([\w-]+)    -> 匹配 .shake 捕获 "shake" (全局)

      const cmdRegex = /f\(([^)]+)\)|f\.([\w\.-]+)|\.([\w-]+)/g;

      let match;
      while ((match = cmdRegex.exec(commandPart)) !== null) {
        if (match[1]) {
          // Case 1: f(red, bold) -> 保持不变
          const effects = match[1].split(",").map((s) => s.trim());
          formatQueue.push(effects);
        } else if (match[2]) {
          // Case 2: f.red.bold.shake
          // 这里捕获到的是 "red.bold.shake"
          // 我们按点号分割，变成一个数组 ['red', 'bold', 'shake']
          // 作为一个整体 push 进队列，对应同一个 Token
          const effects = match[2]
            .split(".")
            .filter((s) => s.trim().length > 0);
          formatQueue.push(effects);
        } else if (match[3]) {
          // Case 3: .global -> 保持不变
          globalEffects.push(match[3]);
        }
      }
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
}

export const parser = new KMDParser();
