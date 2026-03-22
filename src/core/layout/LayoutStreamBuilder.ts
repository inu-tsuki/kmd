import { KineticChar } from "../KineticChar";
import { TextStyle, CanvasTextMetrics } from "pixi.js";
import type { LayoutStream, LayoutCommand } from "./types";
import type { KMDToken, EffectConfig } from "../parser/types";
import { EffectProcessor } from "../effects/EffectProcessor";
import { layoutManager } from "./LayoutManager";
import { stageManager } from "../stage/StageManager";
import { layout } from "./LayoutEngine";

export class LayoutStreamBuilder {
  private static measureTextSafe(text: string, style: TextStyle) {
    const metrics = CanvasTextMetrics.measureText(text, style);

    // 如果 ascent/descent 依然丢失（可能因为 Pixi v8 某些环境下 fontProperties 还没同步），尝试手动补全
    const fontProps = metrics.fontProperties || {
      ascent: (style.fontSize as number) * 0.8,
      descent: (style.fontSize as number) * 0.2,
      fontSize: style.fontSize as number
    };

    return {
      width: metrics.width,
      lineHeight: metrics.lineHeight || (style.fontSize as number) * 1.2,
      ascent: fontProps.ascent || (style.fontSize as number) * 0.8,
      descent: fontProps.descent || (style.fontSize as number) * 0.2
    };
  }

  public static build(
    tokens: KMDToken[],
    baseStyle: TextStyle,
    globalEffects: EffectConfig[],
  ): { stream: LayoutStream; allCharsData: any[] } {
    const stream: LayoutStream = [];
    const allCharsData: any[] = [];

    const { layoutCmds: globalLayouts } = EffectProcessor.partition(globalEffects);
    globalLayouts.forEach((cmd) => stream.push(cmd));

    tokens.forEach((token, tokenIdx) => {
      const { layoutCmds: effectLayouts, visualConfigs, stageConfigs: effectStageConfigs } = EffectProcessor.partition(token.effects);
      const allRawInstructions = [
        ...token.layoutInstructions,
        ...effectLayouts.map(cmd => ({ type: cmd.type as string, params: cmd.params }))
      ];

      let finalContent = token.content;
      if (finalContent.startsWith("var.")) {
        const marker = layout.globalMarkers.get(finalContent);
        if (marker !== undefined) finalContent = String(marker.x);
      }

      const measurementStyle = baseStyle.clone();
      EffectProcessor.applyInitialStylesToStyle(measurementStyle, visualConfigs);
      console.log(`[Layout-Diag] Measuring token "${finalContent.substring(0, 5)}" with style:`, measurementStyle);

      // 手动构建 CSS 字体字符串以兼容 Pixi v8
      const s = measurementStyle;
      const fSize = typeof s.fontSize === 'number' ? `${s.fontSize}px` : s.fontSize;

      // 核心修正：更鲁棒的字体族字符串构建
      const buildFontFamilyString = (ff: string | string[]) => {
        if (Array.isArray(ff)) {
          return ff.map(f => f.includes(' ') && !f.startsWith('"') ? `"${f}"` : f).join(', ');
        }
        return ff;
      };

      const fFamily = buildFontFamilyString(s.fontFamily);
      const fontString = `${s.fontStyle} ${s.fontVariant} ${s.fontWeight} ${fSize} ${fFamily}`;

      // 诊断：检查分辨率一致性
      const currentRes = window.devicePixelRatio || 1;
      const measurementRes = (CanvasTextMetrics as any)._canvas?.width ?
        (CanvasTextMetrics as any)._canvas.width / (CanvasTextMetrics as any)._canvas.style.width : "unknown";

      // 诊断：检查浏览器是否真的加载了这些字体
      const firstFont = Array.isArray(s.fontFamily) ? s.fontFamily[0] : s.fontFamily;
      const isLoaded = (document as any).fonts?.check(`${fSize} ${firstFont}`);

      if (token.content.trim()) {
        console.log(`[Layout-Diag] Token: "${token.content.substring(0, 5)}", font: "${fontString}", loaded: ${isLoaded}, screenRes: ${currentRes}, measureRes: ${measurementRes}`);
      }

      // 预先测量字体指标
      const fontMetrics = CanvasTextMetrics.measureFont(fontString);
      const safeGlobalMetrics = {
        ascent: fontMetrics.ascent || (measurementStyle.fontSize as number) * 0.8,
        descent: fontMetrics.descent || (measurementStyle.fontSize as number) * 0.2
      };

      // 特殊处理 Sugar Token (> / >> / >>>)
      if ((token as any).isSugar && token.sugar && token.sugar.length > 0) {
        // 创建一个无宽度的隐形字符用于承载时序信号
        const dummyChar = new KineticChar("", measurementStyle);
        const charData = {
          char: dummyChar,
          effects: [],
          timingSugars: token.sugar.map((s: any) => ({ name: s.name, params: s.params, level: s.level })),
          tokenIdx, charIdx: 0, width: 0, height: 0,
          ascent: safeGlobalMetrics.ascent, descent: safeGlobalMetrics.descent,
          stageInstructions: [],
          line: token.line // 注入行号
        };
        allCharsData.push(charData);
        stream.push({ isCommand: false, width: 0, height: 0, charData });
        return; 
      }

      let tokenWidth = 0;
      const charWidths: number[] = [];
      const chars = Array.from(finalContent); // 稳健处理 Unicode
      chars.forEach((charText, i) => {
        const tempChar = new KineticChar(charText, measurementStyle);
        charWidths.push(tempChar.width);
        tokenWidth += tempChar.width;
        if (i < chars.length - 1) tokenWidth += measurementStyle.letterSpacing || 0;
        tempChar.destroy();
      });

      const preCmds: LayoutCommand[] = [];
      const postCmds: LayoutCommand[] = [];
      const stageInstructions: any[] = [];

      allRawInstructions.forEach(instr => {
        const expander = layoutManager.getExpander(instr.type);
        if (expander) {
          const { pre, post } = expander(instr.params, {
            width: tokenWidth, charWidths, letterSpacing: measurementStyle.letterSpacing || 0,
            fontSize: measurementStyle.fontSize as number,
            lineHeight: measurementStyle.lineHeight || (measurementStyle.fontSize as number) * 1.2,
            markers: layout.globalMarkers
          });
          // lineScope: 行级排版拆分 — pre 仅发射 pre 命令，post 仅发射 post 命令
          const scope = (instr as any).lineScope as string | undefined;
          if (!scope) {
            if (pre) preCmds.push(...pre); if (post) postCmds.push(...post);
          } else if (scope === "pre") {
            if (pre) preCmds.push(...pre);
          } else if (scope === "post") {
            if (post) postCmds.push(...post);
          }
        } else {
          // 非展开器指令是单点操作（如 mark），不像 offset 那样有 pre/post 成对结构。
          // lineScope "post" 的副本应跳过，否则会在末 token 位置覆写首 token 的结果。
          const scope = (instr as any).lineScope as string | undefined;
          if (scope === "post") return;
          if (stageManager.has(instr.type)) stageInstructions.push(instr);
          else {
            const cmd = layoutManager.generate(instr.type, instr.params);
            if (cmd) preCmds.push(cmd);
          }
        }
      });

      // f. chain 中的舞台指令（partition 路由到 stageConfigs）补充到 stageInstructions
      // 例：f.pause(2s)、f.cam.move(...)! — 经由 §5.5/§6.5 在正确时间点触发
      effectStageConfigs.forEach(cfg => {
        stageInstructions.push({ type: cfg.name, params: cfg.params ?? {}, blocking: cfg.blocking, level: cfg.level });
      });

      preCmds.forEach(c => stream.push(c));

      if (finalContent.length === 0 && stageInstructions.length > 0) {
        const charData = {
          char: null, effects: visualConfigs, tokenIdx, charIdx: 0,
          width: 0, height: 0,
          ascent: safeGlobalMetrics.ascent, descent: safeGlobalMetrics.descent,
          stageInstructions,
          line: token.line // 注入行号
        };
        allCharsData.push(charData);
        stream.push({ isCommand: false, width: 0, height: 0, charData });
      }

      for (let i = 0; i < chars.length; i++) {
        const charText = chars[i]!;
        const charStyle = measurementStyle.clone();

        // 关键：获取精确指标，使用安全助手
        const charMetrics = LayoutStreamBuilder.measureTextSafe(charText, charStyle);

        const char = new KineticChar(charText, charStyle);
        // 核心修复：baseStyleSnapshot 必须反映未应用特效的基准样式
        // charStyle 已经被 applyInitialStylesToStyle 修改过（如 big → fontSize*=1.5），
        // 如果 snapshot 也带着修改后的值，seek 时 resetStyle() 恢复到的"基准态"
        // 仍然含有特效，再经 replayStyles 重放一次就会导致双重应用。
        // 因此用 baseStyle（段落级原始样式）覆写 snapshot。
        (char as any).baseStyleSnapshot.fontSize = baseStyle.fontSize;
        (char as any).baseStyleSnapshot.fontFamily = baseStyle.fontFamily;
        (char as any).baseStyleSnapshot.fontWeight = baseStyle.fontWeight;
        (char as any).baseStyleSnapshot.fontStyle = baseStyle.fontStyle;
        (char as any).baseStyleSnapshot.fill = baseStyle.fill;
        (char as any).baseStyleSnapshot.stroke = baseStyle.stroke;
        (char as any).baseStyleSnapshot.dropShadow = baseStyle.dropShadow;
        // 核心加固：无论来源如何，只要字符是 \n，就标记为 NewLine
        if (charText === "\n") char.isNewLine = true;
        
        const isLastChar = i === chars.length - 1;
        const charEffects = [...visualConfigs];
        const timingSugars: any[] = [];
        
        if (token.sugar) {
          // 这里的逻辑：如果是针对特定索引的，或者是全局针对该 Token 的（charIdx 为 undefined），都应用
          token.sugar.filter((s: any) => s.charIdx === i || s.charIdx === undefined).forEach((s: any) => {
            timingSugars.push({ name: s.name, params: s.params, level: s.level });
          });
        }
        
        const charData = {
          char, 
          effects: charEffects, 
          timingSugars, // 独立存储时序糖衣
          tokenIdx, 
          charIdx: i,
          width: charMetrics.width,
          height: charMetrics.ascent + charMetrics.descent, // 核心变更：使用物理字高而非行高
          ascent: charMetrics.ascent,
          descent: charMetrics.descent,
          stageInstructions: isLastChar ? stageInstructions : [],
          line: token.line // 核心修复：注入行号
        };

        if (token.content.includes("重音") || token.content.includes("轻声")) {
          console.log(`[Builder-Trace] Char: "${charText}", width: ${charData.width}, ascent: ${charData.ascent}, descent: ${charData.descent}, font: ${charStyle.fontFamily}`);
        }

        allCharsData.push(charData);
        stream.push({ isCommand: false, width: charData.width, height: charData.height, charData });
      }
      postCmds.forEach(c => stream.push(c));
    });
    return { stream, allCharsData };
  }
}
