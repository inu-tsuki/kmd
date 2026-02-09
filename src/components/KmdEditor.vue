<template>
  <div ref="editorContainer" class="monaco-container"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import * as monaco from 'monaco-editor';
import { registerKMDLanguage } from '../core/editor/kmd-lang';
import { parser } from '../core/parser/Parser';

// 初始化语言
registerKMDLanguage();

const props = defineProps<{
  modelValue: string;
}>();

const emit = defineEmits(['update:modelValue', 'change']);

const editorContainer = ref<HTMLElement | null>(null);
let editor: monaco.editor.IStandaloneCodeEditor | null = null;

const validateModel = (value: string) => {
  if (!editor) return;
  const model = editor.getModel();
  if (!model) return;

  const errors = parser.validate(value);
  const markers: monaco.editor.IMarkerData[] = errors.map(err => {
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

  monaco.editor.setModelMarkers(model, 'kmd', markers);
};

onMounted(() => {
  if (!editorContainer.value) return;

  editor = monaco.editor.create(editorContainer.value, {
    value: props.modelValue,
    language: 'kmd',
    theme: 'kmd-theme',
    automaticLayout: true,
    fontSize: 14,
    fontFamily: "'Fira Code', 'Courier New', monospace",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: 'on',
    renderWhitespace: 'selection',
    wordWrap: 'on',
    unicodeHighlight: {
      ambiguousCharacters: false
    }
  });

  // 监听编辑内容变化
  editor.onDidChangeModelContent(() => {
    const value = editor?.getValue() || '';
    emit('update:modelValue', value);
    emit('change', value);
    validateModel(value);
  });

  // 初始校验
  validateModel(props.modelValue);
});

// 支持外部 modelValue 变化（如加载示例文件）
watch(() => props.modelValue, (newVal) => {
  if (editor && newVal !== editor.getValue()) {
    editor.setValue(newVal);
    validateModel(newVal);
  }
});

onUnmounted(() => {
  editor?.dispose();
});
</script>

<style scoped>
.monaco-container {
  width: 100%;
  height: 100%;
  border: none;
}
</style>