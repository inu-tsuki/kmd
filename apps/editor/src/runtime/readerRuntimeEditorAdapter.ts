import type {
  ReaderRuntimeCallbacks,
  ReaderRuntimeEditorStateAdapter,
  ReaderRuntimeTimelineMarker,
  ReaderRuntimeTypography,
} from "../core/runtime";

export interface EditorRuntimeAdapterStore {
  currentTime: number;
  totalDuration: number;
  currentLine: number;
  timelineMarkers: ReaderRuntimeTimelineMarker[];
  isPlaying: boolean;
  canvasConfig: {
    fontColor: string;
    fontFamily: string;
  };
}

export function createEditorRuntimeTypography(store: EditorRuntimeAdapterStore): ReaderRuntimeTypography {
  return {
    fill: store.canvasConfig.fontColor,
    fontFamily: store.canvasConfig.fontFamily,
  };
}

export function createEditorRuntimeStateAdapter(store: EditorRuntimeAdapterStore): ReaderRuntimeEditorStateAdapter {
  return {
    setCurrentTime(timeMs) {
      store.currentTime = timeMs;
    },
    setTotalDuration(durationMs) {
      store.totalDuration = durationMs;
    },
    setCurrentLine(line) {
      store.currentLine = line;
    },
    setTimelineMarkers(markers) {
      store.timelineMarkers = markers;
    },
    setBaseTypography(typography) {
      if (typeof typography.fill === "string") {
        store.canvasConfig.fontColor = typography.fill;
      }
      if (typeof typography.fontFamily === "string") {
        store.canvasConfig.fontFamily = typography.fontFamily;
      }
    },
    setPlaybackState(event) {
      store.isPlaying = event.isPlaying;
    },
    reportDiagnostic(diagnostic) {
      console.warn("[KMD Runtime Diagnostic]", diagnostic);
    },
    reportError(error) {
      console.error("[KMD Runtime Error]", error);
    },
  };
}

export function createEditorRuntimeCallbacks(store: EditorRuntimeAdapterStore): ReaderRuntimeCallbacks {
  const adapter = createEditorRuntimeStateAdapter(store);

  return {
    onReady(event) {
      if (event.durationMs !== undefined) {
        adapter.setTotalDuration?.(event.durationMs);
      }
      if (event.timelineMarkers) {
        adapter.setTimelineMarkers?.(event.timelineMarkers);
      }
    },
    onProgress(event) {
      if (event.timeMs !== undefined) {
        adapter.setCurrentTime?.(event.timeMs);
      }
      if (event.durationMs !== undefined) {
        adapter.setTotalDuration?.(event.durationMs);
      }
      if (event.line !== undefined) {
        adapter.setCurrentLine?.(event.line);
      }
    },
    onPlaybackStateChanged(event) {
      adapter.setPlaybackState?.(event);
    },
    onTimelineChanged(markers) {
      adapter.setTimelineMarkers?.(markers);
    },
    onDiagnostic(diagnostic) {
      adapter.reportDiagnostic?.(diagnostic);
    },
    onInspectionReported(event) {
      for (const diagnostic of event.diagnostics ?? []) {
        adapter.reportDiagnostic?.(diagnostic);
      }
    },
    onError(error) {
      adapter.reportError?.(error);
    },
  };
}

