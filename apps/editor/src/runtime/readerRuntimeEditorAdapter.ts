import type {
  ReaderRuntimeCallbacks,
  ReaderRuntimeEditorStateAdapter,
  ReaderRuntimePlaybackState,
  ReaderRuntimeTimelineMarker,
  ReaderRuntimeTypography,
} from "../core/runtime";

export interface EditorRuntimeAdapterStore {
  currentTime: number;
  totalDuration: number;
  currentLine: number;
  timelineMarkers: ReaderRuntimeTimelineMarker[];
  isPlaying: boolean;
  /**
   * 完整播放生命周期态（idle/loading/ready/playing/paused/ended/error）。
   * SA-22：原本 adapter 的 setPlaybackState 只写 event.isPlaying，把 7 值 union 塌缩成布尔，
   * UI 无法区分 ended/paused/loading 等。playbackState 保留完整态作为单一真相源，
   * isPlaying 保留为派生布尔（=== state==="playing"）供旧消费者读。
   */
  playbackState: ReaderRuntimePlaybackState;
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
      // SA-22：保留完整 state（原塌缩为布尔导致 UI 无法区分 ended/paused 等）。
      // playbackState 是单一真相源；isPlaying 作为派生布尔同步写（兼容旧消费者）。
      store.playbackState = event.state;
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

