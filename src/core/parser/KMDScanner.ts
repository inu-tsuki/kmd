import type { KMDToken, EffectConfig, LayoutInstruction, KMDScanResult, BlockOptions } from "./types";
import { KMDCommandParser } from "./KMDCommandParser";
import { stageManager } from "../stage/StageManager";
import { layoutManager } from "../layout/LayoutManager";

export class KMDScanner {
  private braceIdCounter = 0;

  public scan(bodyText: string, startLine: number = 0): KMDScanResult {
    const lines = bodyText.split("\n");
    const allTokens: KMDToken[] = [];
    const allGlobalEffects: EffectConfig[] = [];
    const blockOptions: BlockOptions = {};

    let hasProcessedBlockOptions = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]!;
      const absoluteLine = startLine + i;

      // A. 处理注释 (直接忽略，不生成 Token，不影响 Y 轴)
      const commentIdx = line.indexOf("//");
      if (commentIdx !== -1 && (commentIdx === 0 || line[commentIdx - 1] === " ")) {
        line = line.substring(0, commentIdx).trimEnd();
        if (!line) continue; // 纯注释行，跳过
      }

      // B. 处理 Block Options ([...])
      // 仅在段落开头尝试处理一次
      if (!hasProcessedBlockOptions && line.trim().startsWith("[")) {
        const trimmed = line.trim();
        const endIdx = trimmed.indexOf("]");
        if (endIdx !== -1) {
          const content = trimmed.substring(1, endIdx);
          this.parseBlockOptions(content, blockOptions, allGlobalEffects, absoluteLine);

          const remaining = trimmed.substring(endIdx + 1).trim();
          if (!remaining) {
            hasProcessedBlockOptions = true;
            continue; // 选项独占一行，跳过
          }
          line = remaining; // 同行有文字，继续处理
          hasProcessedBlockOptions = true;
        }
      }

      // C. 处理 --- (清屏)
      if (line.trim() === "---") {
        allTokens.push({
          content: "",
          effects: [], commands: [], params: {}, sugar: [],
          layoutInstructions: [{ type: "pause", params: KMDCommandParser.parseParams("0.5s"), blocking: true }],
          isSceneClear: true,
          line: absoluteLine,
          range: { start: 0, end: line.length }
        } as any);
        continue;
      }

      if (!line.trim()) {
        // 纯空行，仅在不是最后一行时上报 \n
        if (i !== lines.length - 1) {
          allTokens.push({ content: "\n", effects: [], commands: [], params: {}, layoutInstructions: [], sugar: [], line: absoluteLine } as any);
        }
        continue;
      }

      // D. 标准内容扫描
      const atIdx = this.findAtSymbol(line);
      let bodyPart = atIdx !== -1 ? line.substring(0, atIdx).trimEnd() : line.trimEnd();
      let cmdPart = atIdx !== -1 ? line.substring(atIdx + 1) : "";
      const cmdPartOffset = atIdx !== -1 ? atIdx + 1 : -1;

      // 裸 @ 行：body 和 cmd 都为空，完全跳过（不发射任何 token，避免前导 \n 干扰排版）
      if (atIdx !== -1 && !bodyPart.trim() && !cmdPart.trim()) {
        continue;
      }

      let isSpecialHeading = false;
      if (bodyPart.trim().startsWith("# ")) {
        isSpecialHeading = true;
        bodyPart = bodyPart.trim().substring(2);
      }

      const lineTokens = this.scanLineBody(bodyPart);
      lineTokens.forEach(t => t.line = absoluteLine);

      if (isSpecialHeading) {
        lineTokens.forEach(t => {
          t.effects.push({ name: "special", params: {}, level: "char", line: absoluteLine, range: { start: 0, end: 1 } });
        });
      }

      if (cmdPart.trim()) {
        this.applyCommandsToTokens(cmdPart, lineTokens, allGlobalEffects, absoluteLine, cmdPartOffset);
      }

      allTokens.push(...lineTokens);
      // 行末换行符 — 仅在当前行产生了内容 token 时才发射（纯指令行不参与排版）
      if (i < lines.length - 1 && lineTokens.length > 0) {
        allTokens.push({ content: "\n", effects: [], commands: [], params: {}, layoutInstructions: [], sugar: [], line: absoluteLine } as any);
      }
    }

    return { tokens: allTokens, globalEffects: allGlobalEffects, blockOptions };
  }

  private parseBlockOptions(content: string, options: BlockOptions, globalEffects: EffectConfig[], line: number) {
    const parts: string[] = [];
    let cur = ""; let depth = 0;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === "(") depth++; else if (content[i] === ")") depth--;
      if (content[i] === " " && depth === 0) { if (cur) parts.push(cur); cur = ""; }
      else cur += content[i];
    }
    if (cur) parts.push(cur);

    parts.forEach(p => {
      if (p.includes("=")) {
        const eq = p.indexOf("=");
        const key = p.substring(0, eq).trim();
        const val = KMDCommandParser.autoConvert(p.substring(eq + 1).trim());
        (options as any)[key] = val;
      } else {
        const subChain = KMDCommandParser.parseEffectChain(p);
        subChain.forEach(eff => {
          globalEffects.push({ ...eff, line, level: "block" });
        });
      }
    });
  }

  private scanLineBody(text: string): KMDToken[] {
    const tokens: KMDToken[] = [];
    let pos = 0;
    let currentText = "";
    let isBold = false;
    let isItalic = false;
    let tokenStartPos = 0;

    const flushText = (bracedGroupId?: number) => {
      if (currentText || bracedGroupId !== undefined) {
        const t = this.createSimpleToken(currentText);
        t.range = { start: tokenStartPos, end: pos };
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
        tokenStartPos = pos;
      }
    };

    while (pos < text.length) {
      const char = text[pos]!;
      if (char === "\\") {
        pos++; if (pos < text.length) { currentText += text[pos]; pos++; }
        continue;
      }
      if (char === "*" && text[pos + 1] === "*") {
        flushText(); isBold = !isBold; pos += 2; tokenStartPos = pos; continue;
      }
      if (char === "*" && !isBold) {
        flushText(); isItalic = !isItalic; pos++; tokenStartPos = pos; continue;
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
        tokenStartPos = pos; continue;
      }
      if (char === "{") {
        flushText(); this.braceIdCounter++; const gid = this.braceIdCounter; pos++; tokenStartPos = pos;
        while (pos < text.length && text[pos] !== "}") {
          const c = text[pos]!;
          if (c === "\\") { pos++; if (pos < text.length) { currentText += text[pos]; pos++; } }
          else if (c === "*" && text[pos + 1] === "*") { flushText(gid); isBold = !isBold; pos += 2; tokenStartPos = pos; }
          else if (c === "*" && !isBold) { flushText(gid); isItalic = !isItalic; pos++; tokenStartPos = pos; }
          else if (c === "|") {
            // 花括号内的管道符：生成 pause token
            flushText(gid); const pipeStart = pos; pos++; let p = "";
            if (text[pos] === "(") { pos++; while (pos < text.length && text[pos] !== ")" && text[pos] !== "}") { p += text[pos]; pos++; } if (text[pos] === ")") pos++; }
            tokens.push({
              content: "", isPipe: true as any,
              layoutInstructions: [{ type: "pause", params: KMDCommandParser.parseParams(p || "0.5s"), blocking: true }],
              effects: [], commands: [], params: {}, sugar: [], range: { start: pipeStart, end: pos }
            } as any);
            tokenStartPos = pos;
          }
          else if (c === ">" || c === "~" || c === "^") {
            flushText(gid); const sugarPosStart = pos;
            if (c === ">") {
              let cnt = 0; while (pos < text.length && text[pos] === ">") { cnt++; pos++; }
              const level = cnt >= 3 ? "block" : (cnt === 2 ? "group" : "char");
              tokens.push({
                content: "", isSugar: true, sugar: [{ name: "go", params: {}, level }],
                effects: [], commands: [], params: {}, layoutInstructions: [], range: { start: sugarPosStart, end: pos }
              } as any);
            } else {
              const sName = c === "~" ? "slow" : "fast";
              tokens.push({
                content: "", isSugar: true, sugar: [{ name: sName, params: {}, level: "char" }],
                effects: [], commands: [], params: {}, layoutInstructions: [], range: { start: sugarPosStart, end: pos + 1 }
              } as any);
              pos++;
            }
            tokenStartPos = pos;
          } else { currentText += c; pos++; }
        }
        flushText(gid); pos++; tokenStartPos = pos; continue;
      }
      if (char === "|") {
        flushText(); const pipeStart = pos; pos++; let p = "";
        if (text[pos] === "(") { pos++; while (pos < text.length && text[pos] !== ")") { p += text[pos]; pos++; } pos++; }
        tokens.push({
          content: "", isPipe: true as any,
          layoutInstructions: [{ type: "pause", params: KMDCommandParser.parseParams(p || "0.5s"), blocking: true }],
          effects: [], commands: [], params: {}, sugar: [], range: { start: pipeStart, end: pos }
        } as any);
        tokenStartPos = pos; continue;
      }
      if (char === "~" || char === "^") {
        flushText(); const sName = char === "~" ? "slow" : "fast";
        tokens.push({
          content: "", isSugar: true, sugar: [{ name: sName, params: {}, level: "char" }],
          effects: [], commands: [], params: {}, layoutInstructions: [], range: { start: pos, end: pos + 1 }
        } as any);
        pos++; tokenStartPos = pos; continue;
      }
      currentText += char; pos++;
    }
    flushText();
    const merged: KMDToken[] = [];
    tokens.forEach(t => {
      const last = merged[merged.length - 1];
      const canMerge = last && !(t as any).isSugar && !(t as any).isPipe && !(t as any).isBraced && t.content && t.content !== "\n" &&
        !(last as any).isSugar && !(last as any).isPipe && !(last as any).isBraced && last.content && last.content !== "\n" &&
        t.effects.length === 0 && last.effects.length === 0 && (!t.sugar || t.sugar.length === 0) && (!last.sugar || last.sugar.length === 0) &&
        t.line === last.line;
      if (canMerge) { last.content += t.content; if (last.range && t.range) last.range.end = t.range.end; }
      else merged.push(t);
    });
    return merged;
  }

  private applyCommandsToTokens(cmdStr: string, tokens: KMDToken[], globalEffects: EffectConfig[], line: number, offset: number) {
    const parts: Array<{ text: string, start: number, end: number }> = [];
    let cur = ""; let depth = 0; let startPos = 0;
    for (let i = 0; i < cmdStr.length; i++) {
      if (cmdStr[i] === "(") depth++; else if (cmdStr[i] === ")") depth--;
      if (cmdStr[i] === " " && depth === 0) {
        if (cur.trim()) parts.push({ text: cur.trim(), start: offset + startPos, end: offset + i });
        cur = ""; startPos = i + 1;
      } else cur += cmdStr[i];
    }
    if (cur.trim()) parts.push({ text: cur.trim(), start: offset + startPos, end: offset + cmdStr.length });

    const visualQueue: EffectConfig[][] = [];
    const dotVisualEffects: EffectConfig[] = []; // .xxx 点链视觉特效，分配给全部 visualTargets
    const lineLayoutInstructions: LayoutInstruction[] = [];
    const dotLineLayoutInstructions: LayoutInstruction[] = []; // 行级排版（.xxx 点链）

    parts.forEach(p => {
      const subChain = KMDCommandParser.parseEffectChain(p.text);
      subChain.forEach(eff => { eff.line = line; eff.range = { start: p.start, end: p.end }; });
      if (p.text.startsWith("f.")) {
        // f.xxx → 逐 token 视觉特效链，与花括号组 1:1 匹配
        visualQueue.push(subChain);
      } else if (p.text.startsWith(".")) {
        // .xxx → 视觉特效注入全部 token（不进 visualQueue，避免被花括号匹配消费）
        //        排版/舞台指令按行级作用域拆分 pre/post
        subChain.forEach(eff => {
          if (layoutManager.has(eff.name) || stageManager.has(eff.name)) {
            dotLineLayoutInstructions.push({ type: eff.name, params: eff.params, blocking: eff.blocking, level: eff.level, line: eff.line, range: eff.range });
          } else {
            dotVisualEffects.push(eff);
          }
        });
      } else {
        // 裸名 xxx → 舞台指令或排版指令
        subChain.forEach(eff => {
          if (stageManager.has(eff.name) && tokens.length === 0) globalEffects.push({ ...eff, level: "block" });
          else lineLayoutInstructions.push({ type: eff.name, params: eff.params, blocking: eff.blocking, level: eff.level, line: eff.line, range: eff.range });
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
      if (primaryTarget) primaryTarget.layoutInstructions.push(...lineLayoutInstructions);
      // 行级排版（.xxx）：pre 挂首 token，post 挂末 token，横跨整行
      if (dotLineLayoutInstructions.length > 0) {
        const firstTarget = visualTargets[0] || tokens[0];
        const lastTarget = visualTargets[visualTargets.length - 1] || tokens[tokens.length - 1];
        dotLineLayoutInstructions.forEach(instr => {
          if (firstTarget) firstTarget.layoutInstructions.push({ ...instr, lineScope: "pre" });
          if (lastTarget) lastTarget.layoutInstructions.push({ ...instr, lineScope: "post" });
        });
      }
      // .xxx 点链视觉特效 → 注入全部 visualTargets（与 visualQueue 的花括号匹配逻辑独立）
      if (dotVisualEffects.length > 0) {
        const allTargets = visualTargets.length > 0 ? visualTargets : tokens;
        allTargets.forEach(t => t.effects.push(...dotVisualEffects));
      }
      // f.xxx → visualQueue 走花括号 1:1 匹配
      if (bracedGroupIds.length > 0) {
        if (visualQueue.length === bracedGroupIds.length) {
          bracedGroupIds.forEach((gid, idx) => { bracedGroups.get(gid)!.forEach(t => t.effects.push(...visualQueue[idx]!)); });
        } else {
          const firstGroup = bracedGroups.get(bracedGroupIds[0]!);
          if (firstGroup) { const v = visualQueue.shift(); if (v) firstGroup.forEach(t => t.effects.push(...v)); }
          const lastGroupId = bracedGroupIds[bracedGroupIds.length - 1];
          if (lastGroupId !== undefined) { const lastGroup = bracedGroups.get(lastGroupId); if (lastGroup) visualQueue.forEach(vChain => lastGroup.forEach(t => t.effects.push(...vChain))); }
        }
      } else if (visualQueue.length === 1 && visualTargets.length > 0) {
        visualTargets.forEach(t => t.effects.push(...visualQueue[0]!));
      } else if (visualQueue.length > 0) {
        const first = visualTargets[0] || tokens[0];
        const v = visualQueue.shift(); if (v && first) first.effects.push(...v);
        const last = visualTargets[visualTargets.length - 1] || tokens[tokens.length - 1];
        if (last) visualQueue.forEach(vChain => last.effects.push(...vChain));
      }
    } else {
      lineLayoutInstructions.forEach(l => globalEffects.push({ name: l.type, params: l.params, blocking: l.blocking, level: "block", line: l.line, range: l.range }));
      dotLineLayoutInstructions.forEach(l => globalEffects.push({ name: l.type, params: l.params, blocking: l.blocking, level: "block", line: l.line, range: l.range }));
      dotVisualEffects.forEach(eff => globalEffects.push({ ...eff, level: "block" }));
      visualQueue.forEach(vChain => vChain.forEach(eff => globalEffects.push({ ...eff, level: "block" })));
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
