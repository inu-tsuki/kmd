<template>
  <div ref="canvasContainer" class="canvas-container">
    <div v-if="!isReady" class="loading">Engine Loading...</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { createReaderRuntime, type ReaderRuntimeWebSession } from "../core/runtime";
import { useEditorStore } from "../store/editorStore";
import {
  createEditorRuntimeCallbacks,
  createEditorRuntimeTypography,
} from "../runtime/readerRuntimeEditorAdapter";

const canvasContainer = ref<HTMLElement | null>(null);
const isReady = ref(false);
const store = useEditorStore();
let runtime: ReaderRuntimeWebSession | null = null;

onMounted(async () => {
  if (!canvasContainer.value) return;
  runtime = await createReaderRuntime(canvasContainer.value, {
    assetBaseUrl: import.meta.env.BASE_URL,
    callbacks: createEditorRuntimeCallbacks(store),
    typography: createEditorRuntimeTypography(store),
  });
  // 同步单例 Player 到 Store
  store.setPlayer(runtime.getPlayer());
  isReady.value = true;
});

onUnmounted(async () => {
  // 核心修复：移除 stop() 调用。
  // 布局调整时组件会卸载重挂，但不应停止正在进行的演出。
  runtime?.detach();
  runtime = null;
});

const loadAndPlay = async (kmdSource: string) => {
  if (!runtime) return;
  await runtime.getPlayer().stop();
  await runtime.loadSource(kmdSource, { id: "editor-script" });
  runtime.play();
};

const stop = async () => {
  await runtime?.getPlayer().stop();
};

const next = () => {
  runtime?.getPlayer().next(true);
};

defineExpose({
  loadAndPlay,
  stop,
  next,
  getPlayer: () => runtime?.getPlayer() ?? null,
});
</script>

<style scoped>
.canvas-container {
  width: 100%;
  height: 100%;
  background: #000;
  overflow: hidden;
  position: relative;
}
.canvas-container :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}
.loading {
  color: white;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
</style>
