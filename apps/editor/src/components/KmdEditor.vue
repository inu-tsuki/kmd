<template>
  <div ref="editorContainer" class="monaco-container"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import * as monaco from "monaco-editor";
import { registerKMDLanguage } from "../editor/kmd-lang";
import {
  KMD_EDITOR_INPUT_OPTIONS,
  loadKmdEditorFont,
} from '../editor/editorOptions';
import { themeService } from "../editor/ThemeService";
import { parser } from "@kmd/core/parser/Parser";
import { useEditorStore } from "../store/editorStore";

const props = defineProps<{
  modelValue: string;
}>();

const emit = defineEmits(["update:modelValue", "change"]);

const store = useEditorStore();
const editorContainer = ref<HTMLElement | null>(null);
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let isDisposed = false;
let contextMenuLine: number | null = null;

// 现代装饰器集合管理
let decorationsCollection: monaco.editor.IEditorDecorationsCollection | null =
  null;

const updatePlayingLine = (line: number) => {
  if (!editor || isDisposed) return;

  if (!decorationsCollection) {
    decorationsCollection = editor.createDecorationsCollection([]);
  }

  if (line <= 0) {
    decorationsCollection.clear();
    return;
  }

  // 1. 设置高亮样式
  decorationsCollection.set([
    {
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: "kmd-playing-line",
        glyphMarginClassName: "kmd-playing-line-margin",
      },
    },
  ]);

  // 2. 自动滚动到视觉中心 (仅当不在当前视图内时)
  editor.revealLineInCenterIfOutsideViewport(
    line,
    monaco.editor.ScrollType.Smooth,
  );
};

// 监听 Store 中的行号变化
watch(
  () => store.currentLine,
  (newLine) => {
    updatePlayingLine(newLine);
  },
);

// 监听播放状态，停止时清除高亮。
// SA-22：读 store.playbackState（单一真相源）。playing 以外的态（paused/ended/idle/loading 等）
// 都清高亮——原 isPlaying 布尔无法区分这些，但语义上"非 playing 就该清高亮"。
watch(
  () => store.playbackState,
  (state) => {
    if (state !== "playing") updatePlayingLine(0);
  },
);

const validateModel = (value: string) => {
  if (!editor || isDisposed) return;
  const model = editor.getModel();
  if (!model) return;

  const errors = parser.validate(value);
  const markers: monaco.editor.IMarkerData[] = errors.map((err) => {
    // 限制行号范围，防止 getLineMaxColumn 报错
    const line = Math.max(1, Math.min(err.line, model.getLineCount()));
    return {
      severity: monaco.MarkerSeverity.Error,
      message: err.message,
      startLineNumber: line,
      startColumn: 1,
      endLineNumber: line,
      endColumn: model.getLineMaxColumn(line),
    };
  });

  if (!isDisposed) {
    monaco.editor.setModelMarkers(model, "kmd", markers);
  }
};

onMounted(async () => {
  if (!editorContainer.value) return;
  isDisposed = false;

  // Wait for TM grammar to load before creating editor (ensures correct initial highlight)
  await registerKMDLanguage();

  // Monaco 缓存字体度量。必须在 create() 前完成字体加载，否则先使用后备字体
  // 测量、随后切换到 Fira Code 时，光标与文字的横向位置会逐列累积偏差。
  const fontLoaded = await loadKmdEditorFont(document.fonts);
  if (!editorContainer.value || isDisposed) return;
  if (fontLoaded) monaco.editor.remeasureFonts();

  editor = monaco.editor.create(editorContainer.value, {
    value: props.modelValue,
    language: "kmd",
    theme: themeService.activeThemeName,
    automaticLayout: true,
    ...KMD_EDITOR_INPUT_OPTIONS,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: "on",
    glyphMargin: true, // 开启侧边栏图标区，用于播放指示
    renderWhitespace: "selection",
    wordWrap: "on",
    unicodeHighlight: {
      ambiguousCharacters: false,
    },
  });

  // Alt + 点击：只跳转，不改变播放意图。
  editor.onMouseDown((e) => {
    if (e.event.altKey && e.target.position) {
      const player = store.player;
      if (!player) return;
      const line = e.target.position.lineNumber;
      console.log(`[Editor-Jump] Alt+Click at line ${line}`);
      // SA-22：Alt+Click 是 seek 不是 play，不乐观声明播放态。
      // seekToSourceLine → seekToTime 会据 derivePhase 决定：正在播则 resume（发 "playing" 事件，adapter 设态），
      // 暂停则停留 paused。乐观写 playbackState 会与实际播放态漂移。
      player.seekToSourceLine(line);
    }
  });

  // Monaco 右键会提供鼠标命中的近似文本位置。先记录该行，菜单 action
  // 执行时再消费，避免依赖右键是否会同步移动 Monaco 光标。
  editor.onContextMenu((event) => {
    contextMenuLine = event.target.position?.lineNumber ?? null;
  });

  editor.addAction({
    id: 'kmd.play-from-source-line',
    label: '从此行开始播放',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1,
    run: async (actionEditor) => {
      const line = contextMenuLine ?? actionEditor.getPosition()?.lineNumber ?? null;
      contextMenuLine = null;
      if (line === null) return;

      const started = await store.runScriptFromLine(line);
      if (!started) {
        console.warn(`[Editor-PlayFromLine] line ${line} has no playable content at or after it`);
      }
    },
  });

  // 监听编辑内容变化
  editor.onDidChangeModelContent(() => {
    if (isDisposed) return;
    const value = editor?.getValue() || "";
    emit("update:modelValue", value);
    emit("change", value);
    validateModel(value);
  });

  // 初始校验
  validateModel(props.modelValue);
});

// 支持外部 modelValue 变化（如加载示例文件）
watch(
  () => props.modelValue,
  (newVal) => {
    if (editor && !isDisposed && newVal !== editor.getValue()) {
      editor.setValue(newVal);
      validateModel(newVal);
    }
  },
);

onUnmounted(() => {
  isDisposed = true;
  if (editor) {
    const model = editor.getModel();
    if (model) {
      try {
        monaco.editor.setModelMarkers(model, "kmd", []);
      } catch (e) {}
    }
    try {
      editor.dispose();
    } catch (e) {}
    editor = null;
  }
  contextMenuLine = null;
});
</script>

<style scoped>
.monaco-container {
  width: 100%;
  height: 100%;
  border: none;
}
</style>
