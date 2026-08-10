import type {
  LayoutContext,
  LayoutEngineOptions,
  LayoutResult,
  CursorState,
  LinePlan,
} from "./types";

type LineBounds = LinePlan["bounds"];

export interface LayoutLineState {
  context: LayoutContext;
  options: LayoutEngineOptions;
  lines: LayoutResult[][];
  currentLineIndex: number;
}

export interface PreflightLineState extends LayoutLineState {
  lineBaseYs: number[];
}

export interface FinalizedLineState {
  hasInFlow: boolean;
  bounds: LineBounds;
}

export class LineAccumulator {
  public static currentLine(lines: LayoutResult[][], currentLineIndex: number) {
    return lines[currentLineIndex];
  }

  public static pushResult(lines: LayoutResult[][], currentLineIndex: number, result: LayoutResult) {
    if (!lines[currentLineIndex]) {
      lines[currentLineIndex] = [];
    }
    lines[currentLineIndex]!.push(result);
  }

  public static finalizeLine(
    line: LayoutResult[],
    options: LayoutEngineOptions,
    touchedMarkers?: string[],
    markers?: Map<string, CursorState>,
  ): FinalizedLineState {
    this.applyLineAlignment(line, options, touchedMarkers, markers);
    return {
      hasInFlow: line.some((result) => result.inFlow),
      bounds: this.calculateBounds(line),
    };
  }

  public static advancePreflightState(state: PreflightLineState) {
    const currentLine = this.currentLine(state.lines, state.currentLineIndex);
    const hasInFlow = currentLine ? currentLine.some((result) => result.inFlow) : false;

    if (hasInFlow) {
      state.context.baselineY += state.options.lineHeight;
    }

    state.currentLineIndex++;
    state.lines[state.currentLineIndex] = [];
    state.lineBaseYs[state.currentLineIndex] = state.context.baselineY;
    state.context.activeCursor.x = 0;
    state.context.activeCursor.y = state.context.baselineY;
    state.context.isFlowBroken = false;
  }

  public static advanceCalculationState(state: LayoutLineState, hasInFlow: boolean) {
    if (hasInFlow) {
      state.context.baselineY += state.options.lineHeight;
    }

    state.context.activeCursor.x = 0;
    state.context.activeCursor.y = state.context.baselineY;
    state.currentLineIndex++;
    state.lines[state.currentLineIndex] = [];
    state.context.touchedMarkers = [];
    state.context.isFlowBroken = false;
  }

  public static calculateEstimatedBounds(lines: LinePlan[]) {
    const boundedLines = lines.filter((line) => !!line.bounds);
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

  private static applyLineAlignment(
    line: LayoutResult[],
    options: LayoutEngineOptions,
    touchedMarkers?: string[],
    markers?: Map<string, CursorState>,
  ) {
    if (line.length === 0 || options.align === "left") return;
    const inFlows = line.filter((result) => result.inFlow);
    if (inFlows.length === 0) return;

    const first = inFlows[0]!;
    const last = inFlows[inFlows.length - 1]!;
    const width = (last.x + last.item.width / 2) - (first.x - first.item.width / 2);
    const correction =
      (options.align === "center" ? (options.maxWidth - width) / 2 : options.maxWidth - width) -
      (first.x - first.item.width / 2);

    line.forEach((result) => {
      if (result.inFlow) {
        result.x += correction;
      }
    });

    if (touchedMarkers && markers) {
      touchedMarkers.forEach((name) => {
        const marker = markers.get(name);
        if (marker) {
          marker.x += correction;
        }
      });
    }
  }

  private static calculateBounds(lineResults: LayoutResult[]): LineBounds {
    if (lineResults.length === 0) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    lineResults.forEach((result) => {
      const halfW = result.item.width / 2;
      const { ascent = 0, descent = 0 } = result.item.charData ?? {};
      minX = Math.min(minX, result.x - halfW);
      maxX = Math.max(maxX, result.x + halfW);
      minY = Math.min(minY, result.y - ascent);
      maxY = Math.max(maxY, result.y + descent);
    });

    return {
      minX,
      maxX,
      minY,
      maxY,
      midX: (minX + maxX) / 2,
      midY: (minY + maxY) / 2,
    };
  }
}
