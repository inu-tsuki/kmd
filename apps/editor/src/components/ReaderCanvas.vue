<template>
  <div ref="canvasContainer" class="canvas-container">
    <div v-if="!isReady" class="loading">Engine Loading...</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { readerApp } from "../core/App";
import { scriptPlayer } from "../core/player/ScriptPlayer";
import { layout } from "../core/layout/LayoutEngine";
import { stageManager } from "../core/stage/StageManager";
import { useEditorStore } from "../store/editorStore";

const canvasContainer = ref<HTMLElement | null>(null);
const isReady = ref(false);
const store = useEditorStore();
let resizeObserver: ResizeObserver | null = null;

onMounted(async () => {
  if (!canvasContainer.value) return;
  await readerApp.init(canvasContainer.value);

  // 关键：使用 ResizeObserver 监听容器尺寸变化
  resizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(() => {
      if (readerApp.pixiApp && readerApp.pixiApp.renderer) {
        readerApp.pixiApp.resize();
        // 强制渲染一帧
        readerApp.pixiApp.render();
      }
    });
  });
  resizeObserver.observe(canvasContainer.value);

  layout.init(stageManager.contentLayer, 100);
  // 同步单例 Player 到 Store
  store.setPlayer(scriptPlayer);
  isReady.value = true;
});

onUnmounted(async () => {
  // 核心修复：移除 stop() 调用。
  // 布局调整时组件会卸载重挂，但不应停止正在进行的演出。
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});

const loadAndPlay = async (kmdSource: string) => {
  await scriptPlayer.stop();
  await scriptPlayer.load(kmdSource);
  scriptPlayer.toggleAutoPlay(true);
};

const stop = async () => {
  await scriptPlayer.stop();
};

const next = () => {
  scriptPlayer.next(true);
};

defineExpose({
  loadAndPlay,
  stop,
  next,
  getPlayer: () => scriptPlayer,
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
