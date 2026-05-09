import type {
  CursorState,
  LayoutContext,
  LayoutEngineOptions,
  LinePlan,
  MarkerMap,
  ReservedAnchorName,
} from "./types";

type LineBounds = LinePlan["bounds"];

export class AnchorCoordinator {
  public static toGlobal(
    ctx: { options: { baseOffset: CursorState } },
    local: CursorState,
  ): CursorState {
    return {
      x: local.x + ctx.options.baseOffset.x,
      y: local.y + ctx.options.baseOffset.y,
    };
  }

  public static writePhantomLineMarkers(
    markers: MarkerMap,
    lineIndex: number,
    baselineY: number,
    bounds: LineBounds,
    maxWidth: number,
  ) {
    markers.set(`phantom_${lineIndex}.start`, {
      x: bounds ? bounds.minX : 0,
      y: baselineY,
    });
    markers.set(`phantom_${lineIndex}.mid`, {
      x: bounds ? bounds.midX : maxWidth / 2,
      y: baselineY,
    });
    markers.set(`phantom_${lineIndex}.end`, {
      x: bounds ? bounds.maxX : 0,
      y: baselineY,
    });
  }

  public static collectWrittenKeys(context: Pick<LayoutContext, "touchedMarkers">) {
    return new Set(context.touchedMarkers);
  }

  public static syncWrittenPhantomMarkers(
    context: LayoutContext,
    phantomMarkers: MarkerMap,
    writtenKeys: Set<string>,
  ) {
    phantomMarkers.forEach((value, key) => {
      if (!key.startsWith("phantom_") && writtenKeys.has(key)) {
        context.markers.set(key, this.toGlobal(context, value));
      }
    });
  }

  public static updateReservedMarkers(
    context: LayoutContext,
    currentLineIndex: number,
    options: Pick<LayoutEngineOptions, "maxWidth">,
    phantomMarkers: MarkerMap,
  ) {
    this.writeGlobalMarker(context, "line.start", {
      x: 0,
      y: context.baselineY,
    });
    this.writeGlobalMarker(context, "line.mid", {
      x: options.maxWidth / 2,
      y: context.baselineY,
    });
    this.writeGlobalMarker(context, "line.end", {
      x: context.activeCursor.x,
      y: context.baselineY,
    });

    const nextStart = phantomMarkers.get(`phantom_${currentLineIndex + 1}.start`);
    if (!nextStart) {
      return;
    }

    this.writeGlobalMarker(context, "next.start", nextStart);
    const nextMid = phantomMarkers.get(`phantom_${currentLineIndex + 1}.mid`);
    if (nextMid) {
      this.writeGlobalMarker(context, "next.mid", nextMid);
    }
    const nextEnd = phantomMarkers.get(`phantom_${currentLineIndex + 1}.end`);
    if (nextEnd) {
      this.writeGlobalMarker(context, "next.end", nextEnd);
    }
  }

  public static publishPreviousLineMarkers(
    context: LayoutContext,
    options: Pick<LayoutEngineOptions, "maxWidth">,
  ) {
    this.writeGlobalMarker(context, "prev.start", {
      x: 0,
      y: context.baselineY,
    });
    this.writeGlobalMarker(context, "prev.mid", {
      x: options.maxWidth / 2,
      y: context.baselineY,
    });
    this.writeGlobalMarker(context, "prev.end", {
      x: context.activeCursor.x,
      y: context.baselineY,
    });
  }

  private static writeGlobalMarker(context: LayoutContext, name: ReservedAnchorName, local: CursorState) {
    context.markers.set(name, this.toGlobal(context, local));
  }
}
