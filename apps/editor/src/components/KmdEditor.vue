<template>
  <div ref="editorContainer" class="monaco-container"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import * as monaco from "monaco-editor";
import { registerKMDLanguage } from "../core/editor/kmd-lang";
import { parser } from "../core/parser/Parser";
import { useEditorStore } from "../store/editorStore";
import { scriptPlayer } from "../core/player/ScriptPlayer";

const props = defineProps<{
  modelValue: string;
}>();

const emit = defineEmits(["update:modelValue", "change"]);

const store = useEditorStore();
const editorContainer = ref<HTMLElement | null>(null);
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let isDisposed = false;

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

// 监听播放状态，停止时清除高亮
watch(
  () => store.isPlaying,
  (playing) => {
    if (!playing) updatePlayingLine(0);
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

  editor = monaco.editor.create(editorContainer.value, {
    value: props.modelValue,
    language: "kmd",
    theme: "kmd-theme",
    automaticLayout: true,
    fontSize: 14,
    fontFamily: "'Fira Code', 'Courier New', monospace",
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

  // Alt + 点击：跳转播放
  editor.onMouseDown((e) => {
    if (e.event.altKey && e.target.position) {
      const line = e.target.position.lineNumber;
      const paragraphs = scriptPlayer.paragraphs;

      // 寻找该行所属的段落 (或之前的最后一个段落)
      let targetIdx = 0;
      for (let i = 0; i < paragraphs.length; i++) {
        const p = paragraphs[i];
        if (p && p.lineOffset !== undefined && p.lineOffset + 1 <= line) {
          targetIdx = i;
        } else if (p && p.lineOffset !== undefined && p.lineOffset + 1 > line) {
          break;
        }
      }

      console.log(
        `[Editor-Jump] Alt+Click at line ${line}, seeking to p[${targetIdx}]`,
      );
      scriptPlayer.seekTo(targetIdx);
      store.isPlaying = true;
    }
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
});
</script>

<style scoped>
.monaco-container {
  width: 100%;
  height: 100%;
  border: none;
}
</style>
