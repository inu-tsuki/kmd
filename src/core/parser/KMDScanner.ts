import type { KMDToken, EffectConfig, LayoutInstruction } from "./types";
import { KMDCommandParser } from "./KMDCommandParser";
import { stageManager } from "../stage/StageManager";

export class KMDScanner {
  private braceIdCounter = 0;

  public scan(bodyText: string, startLine: number = 0): { tokens: KMDToken[]; globalEffects: EffectConfig[] } {
    const lines = bodyText.split("\n");
    const allTokens: KMDToken[] = [];
    const allGlobalEffects: EffectConfig[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const absoluteLine = startLine + i;

      if (!line.trim() && i !== lines.length - 1) {
        allTokens.push({ content: "\n", effects: [], commands: [], params: {}, layoutInstructions: [], sugar: [], line: absoluteLine } as any);
        continue;
      }

      // 1. 处理 --- (清屏/转场)
      if (line.trim() === "---") {
          allTokens.push({
              content: "",
              effects: [], commands: [], params: {}, sugar: [],
              layoutInstructions: [{ type: "wait", params: { 0: "0.5s" }, blocking: true }],
              isSceneClear: true, // 标记为场景清除
              line: absoluteLine,
              range: { start: 0, end: line.length }
          } as any);
          if (i < lines.length - 1) allTokens.push({ content: "\n", effects: [], commands: [], params: {}, layoutInstructions: [], sugar: [], line: absoluteLine } as any);
          continue;
      }

      const atIdx = this.findAtSymbol(line);
      let bodyPart = atIdx !== -1 ? line.substring(0, atIdx).trimEnd() : line.trimEnd();
      let cmdPart = atIdx !== -1 ? line.substring(atIdx + 1).trim() : "";

      // 2. 处理 # (特殊字体)
      let isSpecialHeading = false;
      if (bodyPart.trim().startsWith("# ")) {
          isSpecialHeading = true;
          bodyPart = bodyPart.trim().substring(2);
      }

      const lineTokens = this.scanLineBody(bodyPart);
      // 注入行号
      lineTokens.forEach(t => t.line = absoluteLine);
      
      if (isSpecialHeading) {
          lineTokens.forEach(t => {
              t.effects.push({ name: "special", params: {}, level: "char" });
          });
      }

      if (cmdPart) this.applyCommandsToTokens(cmdPart, lineTokens, allGlobalEffects);

      allTokens.push(...lineTokens);
      if (i < lines.length - 1) allTokens.push({ content: "\n", effects: [], commands: [], params: {}, layoutInstructions: [], sugar: [], line: absoluteLine } as any);
    }
    return { tokens: allTokens, globalEffects: allGlobalEffects };
  }

  private scanLineBody(text: string): KMDToken[] {
    const tokens: KMDToken[] = [];
    let pos = 0;
    let currentText = "";
    let isBold = false;
    let isItalic = false;
    let tokenStartPos = 0; // 记录当前正在构建的 Token 的起始列号

    const flushText = (bracedGroupId?: number) => {
        if (currentText || bracedGroupId !== undefined) {
            const t = this.createSimpleToken(currentText);
            t.range = { start: tokenStartPos, end: pos }; // 注入位置
            if (bracedGroupId !== undefined) {
                (t as any).isBraced = true;
                (t as any).braceGroupId = bracedGroupId;
            }
            if (isBold) {
                t.effects.push({ name: "bold", params: {}, level: "char" });
                t.sugar!.push({ name: "slow", params: {}, level: "char" });
            }
            if (isItalic) {
                t.effects.push({ name: "thin", params: {}, level: "char" });
                t.effects.push({ name: "dim", params: {}, level: "char" });
                t.sugar!.push({ name: "fast", params: {}, level: "char" });
            }
            tokens.push(t);
            currentText = "";
            tokenStartPos = pos; // 更新下一个 Token 的起点
        }
    };

    while (pos < text.length) {
      const char = text[pos]!;

      if (char === "\\") {
        pos++; if (pos < text.length) { currentText += text[pos]; pos++; }
        continue;
      }

      if (char === "*" && text[pos + 1] === "*") {
          flushText();
          isBold = !isBold;
          pos += 2;
          tokenStartPos = pos;
          continue;
      }
      if (char === "*" && !isBold) { 
          flushText();
          isItalic = !isItalic;
          pos++;
          tokenStartPos = pos;
          continue;
      }

      if (char === ">") {
        flushText();
        let cnt = 0; while (pos < text.length && text[pos] === ">") { cnt++; pos++; }
        const level = cnt >= 3 ? "block" : (cnt === 2 ? "group" : "char");
        tokens.push({
            content: "", isSugar: true, sugar: [{ name: "go", params: {}, level }],
            effects: [], commands: [], params: {}, layoutInstructions: [],
            range: { start: tokenStartPos, end: pos }
        } as any);
        tokenStartPos = pos;
        continue;
      }

      if (char === "{") {
        flushText();
        this.braceIdCounter++;
        const gid = this.braceIdCounter;
        pos++;
        tokenStartPos = pos;
        while (pos < text.length && text[pos] !== "}") {
          const c = text[pos]!;
          if (c === "\\") { pos++; if (pos < text.length) { currentText += text[pos]; pos++; } } 
          else if (c === "*" && text[pos + 1] === "*") {
              flushText(gid);
              isBold = !isBold;
              pos += 2;
              tokenStartPos = pos;
          }
          else if (c === "*" && !isBold) {
              flushText(gid);
              isItalic = !isItalic;
              pos++;
              tokenStartPos = pos;
          }
          else if (c === ">" || c === "~" || c === "^") {
            flushText(gid);
            const sugarPosStart = pos;
            if (c === ">") {
                let cnt = 0; while (pos < text.length && text[pos] === ">") { cnt++; pos++; }
                const level = cnt >= 3 ? "block" : (cnt === 2 ? "group" : "char");
                tokens.push({
                    content: "", isSugar: true, sugar: [{ name: "go", params: {}, level }],
                    effects: [], commands: [], params: {}, layoutInstructions: [],
                    range: { start: sugarPosStart, end: pos }
                } as any);
            } else {
                const sName = c === "~" ? "slow" : "fast";
                tokens.push({
                    content: "", isSugar: true, sugar: [{ name: sName, params: {}, level: "char" }],
                    effects: [], commands: [], params: {}, layoutInstructions: [],
                    range: { start: sugarPosStart, end: pos + 1 }
                } as any);
                pos++;
            }
            tokenStartPos = pos;
          } else { currentText += c; pos++; }
        }
        flushText(gid);
        pos++; 
        tokenStartPos = pos;
        continue;
      }

      if (char === "|") {
        flushText();
        const pipeStart = pos;
        pos++; let p = "";
        if (text[pos] === "(") { pos++; while (pos < text.length && text[pos] !== ")") { p += text[pos]; pos++; } pos++; }
        tokens.push({
          content: "", isPipe: true as any, 
          layoutInstructions: [{ type: "wait", params: KMDCommandParser.parseParams(p || "0.5s"), blocking: true }],
          effects: [], commands: [], params: {}, sugar: [],
          range: { start: pipeStart, end: pos }
        } as any);
        tokenStartPos = pos;
        continue;
      }

      if (char === "~" || char === "^") {
        flushText();
        const sName = char === "~" ? "slow" : "fast";
        tokens.push({
          content: "", isSugar: true, sugar: [{ name: sName, params: {}, level: "char" }],
          effects: [], commands: [], params: {}, layoutInstructions: [],
          range: { start: pos, end: pos + 1 }
        } as any);
        pos++; 
        tokenStartPos = pos;
        continue;
      }

      currentText += char; pos++;
    }
    flushText();
    
    const merged: KMDToken[] = [];
    tokens.forEach(t => {
        const last = merged[merged.length - 1];
        const hasEffects = t.effects.length > 0;
        const lastHasEffects = last && last.effects.length > 0;
        const hasSugar = t.sugar && t.sugar.length > 0;
        const lastHasSugar = last && last.sugar && last.sugar.length > 0;

        const canMerge = last && 
            !(t as any).isSugar && !(t as any).isPipe && !(t as any).isBraced && t.content && t.content !== "\n" &&
            !(last as any).isSugar && !(last as any).isPipe && !(last as any).isBraced && last.content && last.content !== "\n" &&
            !hasEffects && !lastHasEffects && !hasSugar && !lastHasSugar &&
            t.line === last.line; // 同行才合并

        if (canMerge) { 
            last.content += t.content; 
            if (last.range && t.range) last.range.end = t.range.end;
        } 
        else { merged.push(t); }
    });
    return merged;
  }

  private applyCommandsToTokens(cmdStr: string, tokens: KMDToken[], globalEffects: EffectConfig[]) {
    const parts: string[] = [];
    let cur = ""; let depth = 0;
    for (let i = 0; i < cmdStr.length; i++) {
      if (cmdStr[i] === "(") depth++; else if (cmdStr[i] === ")") depth--;
      if (cmdStr[i] === " " && depth === 0) { if (cur) parts.push(cur); cur = ""; } 
      else cur += cmdStr[i];
    }
    if (cur) parts.push(cur);

    const visualQueue: EffectConfig[][] = [];
    const lineLayoutInstructions: LayoutInstruction[] = [];

    parts.forEach(p => {
      if (KMDCommandParser.isVisual(p)) {
        visualQueue.push(KMDCommandParser.parseEffectChain(p));
      } else {
        const subChain = KMDCommandParser.parseEffectChain(p);
        subChain.forEach(eff => {
           if (stageManager.has(eff.name) && tokens.length === 0) {
              globalEffects.push({ name: eff.name, params: eff.params, blocking: eff.blocking, level: "block" });
           } else {
              lineLayoutInstructions.push({ type: eff.name, params: eff.params, blocking: eff.blocking });
           }
        });
      }
    });

    const visualTargets = tokens.filter(t => t.content.trim() && !(t as any).isSugar && !(t as any).isPipe);
    const bracedGroups: Map<number, KMDToken[]> = new Map();
    visualTargets.forEach(t => {
        const gid = (t as any).braceGroupId;
        if (gid !== undefined) {
            if (!bracedGroups.has(gid)) bracedGroups.set(gid, []);
            bracedGroups.get(gid)!.push(t);
        }
    });
    const bracedGroupIds = Array.from(bracedGroups.keys());

    if (tokens.length > 0) {
      const primaryTarget = visualTargets.filter(t => (t as any).isBraced)[0] || visualTargets[0] || tokens[0];
      if (primaryTarget) {
          primaryTarget.layoutInstructions.push(...lineLayoutInstructions);
      }

      let mappingDone = false;
      if (bracedGroupIds.length > 0) {
          if (visualQueue.length === bracedGroupIds.length) {
              bracedGroupIds.forEach((gid, idx) => {
                  const groupTokens = bracedGroups.get(gid)!;
                  const vChain = visualQueue[idx]!;
                  groupTokens.forEach(t => t.effects.push(...vChain));
              });
              mappingDone = true;
          } else {
              const firstGroup = bracedGroups.get(bracedGroupIds[0]!);
              if (firstGroup) {
                  const v = visualQueue.shift(); if (v) firstGroup.forEach(t => t.effects.push(...v));
              }
              
              const lastGroupId = bracedGroupIds[bracedGroupIds.length - 1];
              if (lastGroupId !== undefined) {
                  const lastGroup = bracedGroups.get(lastGroupId);
                  if (lastGroup) {
                      visualQueue.forEach(vChain => lastGroup.forEach(t => t.effects.push(...vChain)));
                  }
              }
              mappingDone = true;
          }
      } else if (visualQueue.length === 1 && visualTargets.length > 0) {
          const vChain = visualQueue[0]!;
          visualTargets.forEach(t => t.effects.push(...vChain));
          mappingDone = true;
      }

      if (!mappingDone && visualQueue.length > 0) {
        const first = visualTargets[0] || tokens[0];
        const v = visualQueue.shift(); if (v && first) first.effects.push(...v);
        const last = visualTargets[visualTargets.length - 1] || tokens[tokens.length - 1];
        if (last) {
            visualQueue.forEach(vChain => last.effects.push(...vChain));
        }
      }
    } else {
      lineLayoutInstructions.forEach(l => globalEffects.push({ name: l.type, params: l.params, blocking: l.blocking, level: "block" }));
      visualQueue.forEach(vChain => vChain.forEach(eff => globalEffects.push({ name: eff.name, params: eff.params, blocking: eff.blocking, level: "block" })));
    }
  }

  private findAtSymbol(line: string): number {
    let inBrace = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "\\") { i++; continue; }
      if (line[i] === "{") inBrace = true;
      else if (line[i] === "}") inBrace = false;
      else if (line[i] === "@" && !inBrace) return i;
    }
    return -1;
  }

  private createSimpleToken(text: string): KMDToken {
    return { content: text, effects: [], commands: [], params: {}, layoutInstructions: [], sugar: [] };
  }
}