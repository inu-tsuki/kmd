import { AnchorCoordinator } from "./AnchorCoordinator";
import { LayoutAuditEmitter } from "./LayoutAuditEmitter";
import {
  LineAccumulator,
  type LayoutLineState,
  type PreflightLineState,
} from "./LineAccumulator";
import { LayoutPassRunner, type LayoutPassState } from "./LayoutPassRunner";
import type {
  LayoutStream,
  LayoutEngineOptions,
  MarkerMap,
  LayoutResult,
  LayoutAuditRecord,
  LayoutPreflightResult,
  LinePlan,
} from './types';

export class TextLayoutEngine {
  public static lastAuditLog: LayoutAuditRecord[] = [];
  public static lastPreflightResult: LayoutPreflightResult | null = null;

  /**
   * 幻影预扫描：模拟完整路径，建立基于 Baseline 的标记图与行几何预检结果
   */
  public static preflight(stream: LayoutStream, options: LayoutEngineOptions, globalMarkers: MarkerMap): LayoutPreflightResult {
    const firstLineMaxAscent = LayoutPassRunner.findFirstLineMaxAscent(stream);
    const ctx = LayoutPassRunner.createContext(
      options,
      new Map(globalMarkers),
      firstLineMaxAscent,
      { x: 0, y: 0 },
    );

    const state: PreflightLineState & LayoutPassState = {
      context: ctx,
      options,
      lines: [[]],
      lineBaseYs: [ctx.baselineY],
      currentLineIndex: 0,
    };

    LayoutPassRunner.run(stream, state, {
      onNewline: (currentState) => {
        LineAccumulator.advancePreflightState(currentState);
      },
      onWrap: (currentState) => {
        LineAccumulator.advancePreflightState(currentState);
      },
      onItem: (currentState, measured) => {
        LineAccumulator.pushResult(currentState.lines, currentState.currentLineIndex, {
          item: measured.item,
          x: currentState.context.activeCursor.x + measured.item.width / 2,
          y: currentState.context.activeCursor.y,
          inFlow: !currentState.context.isFlowBroken,
          stepDistance: measured.stepDistance,
        });
      },
    });

    const linePlans: LinePlan[] = [];
    state.lines.forEach((line, idx) => {
      const { bounds, hasInFlow } = LineAccumulator.finalizeLine(line, options);
      const baseline = state.lineBaseYs[idx] ?? (idx * options.lineHeight);
      linePlans.push({
        index: idx,
        baselineY: baseline,
        hasInFlow,
        bounds,
      });
      AnchorCoordinator.writePhantomLineMarkers(
        ctx.markers,
        idx,
        baseline,
        bounds,
        options.maxWidth,
      );
    });

    const writtenKeys = AnchorCoordinator.collectWrittenKeys(ctx);
    const preflight: LayoutPreflightResult = {
      lines: linePlans,
      anchors: { markers: ctx.markers, writtenKeys },
      diagnostics: [],
      estimatedBounds: LineAccumulator.calculateEstimatedBounds(linePlans),
    };
    LayoutAuditEmitter.emitPreflight(preflight);
    this.lastPreflightResult = preflight;
    return preflight;
  }

  public static calculate(
    stream: LayoutStream,
    options: LayoutEngineOptions,
    globalMarkers: MarkerMap = options.externalMarkers
  ): LayoutResult[] {

    const preflight = this.preflight(stream, options, globalMarkers);
    const phantomMarkers = preflight.anchors.markers;
    const phantomWrittenKeys = preflight.anchors.writtenKeys;
    const firstLineMaxAscent = LayoutPassRunner.findFirstLineMaxAscent(stream);
    const context = LayoutPassRunner.createContext(options, globalMarkers, firstLineMaxAscent);

    const state: LayoutLineState & LayoutPassState & {
      results: LayoutResult[];
    } = {
      context,
      options,
      results: [],
      lines: [[]],
      currentLineIndex: 0,
    };

    AnchorCoordinator.syncWrittenPhantomMarkers(context, phantomMarkers, phantomWrittenKeys);

    const handleLineBreak = (currentState: LayoutLineState & { results: LayoutResult[] }) => {
      const currentLine = LineAccumulator.currentLine(currentState.lines, currentState.currentLineIndex);
      const { hasInFlow } = currentLine
        ? LineAccumulator.finalizeLine(
            currentLine,
            options,
            currentState.context.touchedMarkers,
            currentState.context.markers,
          )
        : { hasInFlow: false };

      if (currentLine) {
        AnchorCoordinator.publishPreviousLineMarkers(currentState.context, options);
      }

      LineAccumulator.advanceCalculationState(currentState, hasInFlow);
    };

    LayoutPassRunner.run(stream, state, {
      beforeNode: (currentState) => {
        AnchorCoordinator.updateReservedMarkers(
          currentState.context,
          currentState.currentLineIndex,
          options,
          phantomMarkers,
        );
      },
      onNewline: (currentState, measured) => {
        const res: LayoutResult = {
          item: measured.item,
          x: currentState.context.activeCursor.x,
          y: currentState.context.activeCursor.y,
          inFlow: false,
        };
        LayoutAuditEmitter.stampResultMeta(currentState.context, res);
        currentState.results.push(res);
        LineAccumulator.pushResult(currentState.lines, currentState.currentLineIndex, res);
        handleLineBreak(currentState);
      },
      onWrap: (currentState) => {
        handleLineBreak(currentState);
      },
      onItem: (currentState, measured) => {
        const result: LayoutResult = {
          item: measured.item,
          x: currentState.context.activeCursor.x + measured.item.width / 2,
          y: currentState.context.activeCursor.y,
          inFlow: !currentState.context.isFlowBroken,
          displayOffsetX: currentState.context.displayOffset.x || undefined,
          displayOffsetY: currentState.context.displayOffset.y || undefined,
          stepDistance: measured.stepDistance,
        };

        LineAccumulator.pushResult(currentState.lines, currentState.currentLineIndex, result);
        LayoutAuditEmitter.stampResultMeta(currentState.context, result);
        currentState.results.push(result);
      },
    });

    const finalLine = state.lines[state.currentLineIndex];
    if (finalLine && finalLine.length > 0) {
      LineAccumulator.finalizeLine(
        finalLine,
        options,
        context.touchedMarkers,
        context.markers,
      );
    }
    this.lastAuditLog = LayoutAuditEmitter.buildAuditLog(context, state.results);

    LayoutAuditEmitter.emitCalculation({
      resultCount: state.results.length,
      auditRecordCount: this.lastAuditLog.length,
      markerCount: context.markers.size,
      estimatedBounds: preflight.estimatedBounds,
    });

    return state.results;
  }
}
