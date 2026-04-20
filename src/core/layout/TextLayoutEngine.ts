import type {
  LayoutStream,
  LayoutContext,
  MarkerMap,
  LayoutItem,
  LayoutCommand,
  LayoutResult,
  LayoutAuditRecord,
  CursorState,
  LayoutPreflightResult,
  LinePlan,
} from './types';
import { layoutManager } from './LayoutManager';
import type { FullOptions } from "../KineticText";

export class TextLayoutEngine {
  public static lastAuditLog: LayoutAuditRecord[] = [];
  public static lastPreflightResult: LayoutPreflightResult | null = null;

  private static toGlobal(ctx: { options: { baseOffset: CursorState } }, local: { x: number, y: number }): CursorState {
    return {
      x: local.x + ctx.options.baseOffset.x,
      y: local.y + ctx.options.baseOffset.y,
    };
  }

  private static calculateBounds(lineResults: LayoutResult[]) {
    if (lineResults.length === 0) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    lineResults.forEach((r) => {
      const halfW = r.item.width / 2;
      // 核心修正：基于 Baseline 和 ascent/descent 计算上下边界
      const { ascent, descent } = (r.item as any).charData;
      minX = Math.min(minX, r.x - halfW);
      maxX = Math.max(maxX, r.x + halfW);
      minY = Math.min(minY, r.y - ascent);
      maxY = Math.max(maxY, r.y + descent);
    });
    return { minX, maxX, minY, maxY, midX: (minX + maxX) / 2, midY: (minY + maxY) / 2 };
  }

  private static findFirstLineMaxAscent(stream: LayoutStream) {
    let firstLineMaxAscent = 0;
    for (const node of stream) {
      if (node.isCommand) continue;
      const item = node as LayoutItem;
      if ((item as any).charData?.char?.text === "\n") break;
      const ascent = (item as any).charData?.ascent || 0;
      if (ascent > firstLineMaxAscent) firstLineMaxAscent = ascent;
    }
    return firstLineMaxAscent;
  }

  private static applyLineAlignment(
    line: LayoutResult[],
    options: FullOptions,
    touchedMarkers?: string[],
    markers?: Map<string, CursorState>,
  ) {
    if (line.length === 0 || options.align === "left") return;
    const inFlows = line.filter(r => r.inFlow);
    if (inFlows.length === 0) return;

    const first = inFlows[0]!;
    const last = inFlows[inFlows.length - 1]!;
    const width = (last.x + last.item.width / 2) - (first.x - first.item.width / 2);
    const correction =
      (options.align === "center" ? (options.maxWidth - width) / 2 : options.maxWidth - width) -
      (first.x - first.item.width / 2);

    line.forEach(r => {
      if (r.inFlow) r.x += correction;
    });

    if (touchedMarkers && markers) {
      touchedMarkers.forEach(name => {
        const marker = markers.get(name);
        if (marker) marker.x += correction;
      });
    }
  }

  private static calculateEstimatedBounds(lines: LinePlan[]) {
    const boundedLines = lines.filter(line => !!line.bounds);
    if (boundedLines.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    return boundedLines.reduce((acc, line) => {
      const bounds = line.bounds!;
      return {
        minX: Math.min(acc.minX, bounds.minX),
        minY: Math.min(acc.minY, bounds.minY),
        maxX: Math.max(acc.maxX, bounds.maxX),
        maxY: Math.max(acc.maxY, bounds.maxY),
      };
    }, {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    });
  }

  /**
     * 幻影预扫描：模拟完整路径，建立基于 Baseline 的标记图与行几何预检结果
     */
  public static preflight(stream: LayoutStream, options: FullOptions, globalMarkers: MarkerMap): LayoutPreflightResult {
    const firstLineMaxAscent = this.findFirstLineMaxAscent(stream);
    const ctx: LayoutContext = {
      activeCursor: {
        x: options.indent * options.fontSize,
        y: firstLineMaxAscent,
      },
      isFlowBroken: false,
      justMoved: false,
      markers: new Map(globalMarkers),
      touchedMarkers: [],
      displayOffset: { x: 0, y: 0 },
      _displayOffsetStack: [],
      baselineY: firstLineMaxAscent,
      options: { ...options, baseOffset: { x: 0, y: 0 } },
    };

    const lines: LayoutResult[][] = [[]];
    const lineBaseYs: number[] = [ctx.baselineY];
    let lIdx = 0;

    for (const node of stream) {
      if (node.isCommand) {
        const cmd = node as LayoutCommand;
        const op = layoutManager.getOperator(cmd.type);
        if (op) op(ctx, cmd.params);
        continue;
      }
      const item = node as LayoutItem;
      const charText = (item as any).charData?.char?.text || "";

      const handleWrap = () => {
        const currentLine = lines[lIdx];
        if (currentLine && currentLine.some(r => r.inFlow)) ctx.baselineY += options.lineHeight;
        lIdx++; lines[lIdx] = [];
        lineBaseYs[lIdx] = ctx.baselineY;
        ctx.activeCursor.x = 0;
        ctx.activeCursor.y = ctx.baselineY;
        ctx.isFlowBroken = false;
      };

      if (charText === '\n') { handleWrap(); continue; }
      if (!ctx.isFlowBroken && !ctx.justMoved && ctx.activeCursor.x + item.width > options.maxWidth * 1.05) {
        handleWrap();
      }

      // 核心修正：基于字号的比例间距 (Tracking)
      const charData = (item as any).charData;
      const fSize = charData.fontSize || charData.char?.style?.fontSize || options.fontSize;

      // 使用 0.02em (2% 字号) 作为基础步进补偿，追求极致紧凑的专业排版质感
      const tracking = fSize * 0.02;
      const stepDistance = item.width + tracking + options.letterSpacing;
      const currentLine = lines[lIdx];
      if (currentLine) {
        const res: LayoutResult = {
          item,
          x: ctx.activeCursor.x + item.width / 2,
          y: ctx.activeCursor.y, // 核心：直接返回 Baseline Y
          inFlow: !ctx.isFlowBroken,
          stepDistance: stepDistance,
        };
        currentLine.push(res);
      }

      ctx.activeCursor.x += stepDistance;
      ctx.justMoved = false;
    }

    const linePlans: LinePlan[] = [];
    lines.forEach((line, idx) => {
      this.applyLineAlignment(line, options);
      const bounds = this.calculateBounds(line);
      const baseline = lineBaseYs[idx] ?? (idx * options.lineHeight);
      linePlans.push({
        index: idx,
        baselineY: baseline,
        hasInFlow: line.some(r => r.inFlow),
        bounds,
      });
      ctx.markers.set(`phantom_${idx}.start`, { x: bounds ? bounds.minX : 0, y: baseline });
      ctx.markers.set(`phantom_${idx}.mid`, { x: bounds ? bounds.midX : options.maxWidth / 2, y: baseline });
      ctx.markers.set(`phantom_${idx}.end`, { x: bounds ? bounds.maxX : 0, y: baseline });
      console.log(
        `[Phantom-Trace] Line ${idx} baseline: ${baseline}, bounds:`,
        bounds,
      );
    });

    // 收集幻影扫描期间被写入的标记名（touchedMarkers 在幻影扫描中不会被重置）
    const writtenKeys = new Set(ctx.touchedMarkers);
    const preflight: LayoutPreflightResult = {
      lines: linePlans,
      anchors: { markers: ctx.markers, writtenKeys },
      diagnostics: [],
      estimatedBounds: this.calculateEstimatedBounds(linePlans),
    };
    this.lastPreflightResult = preflight;
    return preflight;
  }

  public static calculate(
    stream: LayoutStream,
    options: FullOptions,
    globalMarkers: MarkerMap = options.externalMarkers
  ): LayoutResult[] {

    const preflight = this.preflight(stream, options, globalMarkers);
    const phantomMarkers = preflight.anchors.markers;
    const phantomWrittenKeys = preflight.anchors.writtenKeys;
    const results: LayoutResult[] = [];

    const firstLineMaxAscent = this.findFirstLineMaxAscent(stream);

    const context: LayoutContext = {
      activeCursor: { x: options.indent * options.fontSize, y: firstLineMaxAscent },
      isFlowBroken: false,
      justMoved: false,
      markers: globalMarkers,
      touchedMarkers: [],
      displayOffset: { x: 0, y: 0 },
      _displayOffsetStack: [],
      baselineY: firstLineMaxAscent,
      options: { ...options },
    };

    // 核心修正 5.3b：同步幻影扫描期间写入的标记（前向引用支持）。
    // 使用 writtenKeys 而非 !globalMarkers.has(k) 判断——确保 rebuild 时
    // 前向引用标记（如 p2 被后续行定义但前文 goto(p2) 引用）总是获得正确坐标。
    phantomMarkers.forEach((v, k) => {
      if (!k.startsWith('phantom_') && phantomWrittenKeys.has(k)) {
        globalMarkers.set(k, this.toGlobal(context, v));
      }
    });

    const lines: LayoutResult[][] = [[]];
    let currentLineIndex = 0;

    const updateReservedMarkers = () => {
      context.markers.set('line.start', this.toGlobal(context, { x: 0, y: context.baselineY }));
      context.markers.set('line.mid', this.toGlobal(context, { x: options.maxWidth / 2, y: context.baselineY }));
      context.markers.set('line.end', this.toGlobal(context, { x: context.activeCursor.x, y: context.baselineY }));

      const nS = phantomMarkers.get(`phantom_${currentLineIndex + 1}.start`);
      if (nS) {
        context.markers.set('next.start', this.toGlobal(context, nS));
        const nM = phantomMarkers.get(`phantom_${currentLineIndex + 1}.mid`);
        if (nM) context.markers.set('next.mid', this.toGlobal(context, nM));
        const nE = phantomMarkers.get(`phantom_${currentLineIndex + 1}.end`);
        if (nE) context.markers.set('next.end', this.toGlobal(context, nE));
      }
    };

    for (const node of stream) {
      updateReservedMarkers();

      if (node.isCommand) {
        const cmd = node as LayoutCommand;
        const operator = layoutManager.getOperator(cmd.type);
        if (operator) operator(context, cmd.params);
        continue;
      }

      const item = node as LayoutItem;
      const charText = (item as any).charData?.char?.text || "";

      const handleLineBreak = () => {
        const currentLine = lines[currentLineIndex];
        let hasInFlow = currentLine ? currentLine.some(r => r.inFlow) : false;

        if (currentLine) {
          this.applyLineAlignment(currentLine, options, context.touchedMarkers, context.markers);
          context.markers.set('prev.start', this.toGlobal(context, { x: 0, y: context.baselineY }));
          context.markers.set('prev.mid', this.toGlobal(context, { x: options.maxWidth / 2, y: context.baselineY }));
          context.markers.set('prev.end', this.toGlobal(context, { x: context.activeCursor.x, y: context.baselineY }));
        }

        if (hasInFlow) context.baselineY += options.lineHeight;
        context.activeCursor.x = 0;
        context.activeCursor.y = context.baselineY;

        currentLineIndex++;
        lines[currentLineIndex] = [];
        context.touchedMarkers = [];
      };

      if (charText === "\n") {
        const res: LayoutResult = {
          item,
          x: context.activeCursor.x,
          y: context.activeCursor.y, // 换行符锚定在 Baseline
          inFlow: false,
        };
        results.push(res);
        const currentLine = lines[currentLineIndex];
        if (currentLine) currentLine.push(res);
        handleLineBreak();
        context.isFlowBroken = false;
        continue;
      }

      if (
        !context.isFlowBroken &&
        !context.justMoved &&
        context.activeCursor.x + item.width > options.maxWidth * 1.05
      ) {
        handleLineBreak();
      }

      const { height } = (item as any).charData;
      const result: LayoutResult = {
        item,
        x: context.activeCursor.x + item.width / 2,
        y: context.activeCursor.y, // 核心：直接锚定在 Baseline
        inFlow: !context.isFlowBroken,
        displayOffsetX: context.displayOffset.x || undefined,
        displayOffsetY: context.displayOffset.y || undefined,
      };

      if (charText.trim()) {
        console.log(
          `[Layout-Math] Char: "${charText}", height: ${height}, baselineY: ${result.y}`,
        );
      }

      const currentLine = lines[currentLineIndex];
      if (currentLine) currentLine.push(result);
      results.push(result);

      // 核心修正：基于字号的比例间距 (Tracking)
      const cData = (item as any).charData;
      const fSize = cData.fontSize || cData.char?.style?.fontSize || options.fontSize;
      const tracking = fSize * 0.02;
      const stepDistance = item.width + tracking + options.letterSpacing;

      result.stepDistance = stepDistance;

      if (charText.trim()) {
        console.log(
          `[Layout-Spacing] Char: "${charText}", width: ${item.width}, tracking: ${tracking}, stepDistance: ${stepDistance}`,
        );
      }

      context.activeCursor.x += stepDistance;
      context.justMoved = false;
    }
    const finalLine = lines[currentLineIndex];
    if (finalLine && finalLine.length > 0) {
      this.applyLineAlignment(finalLine, options, context.touchedMarkers, context.markers);
    }

    return results;
  }
}
