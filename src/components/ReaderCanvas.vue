<template>
  <div ref="canvasContainer" class="canvas-container">
    <div v-if="!isReady" class="loading">Engine Loading...</div>
  </div>
</template>

<script setup lang="ts">
  import { ref, onMounted } from "vue";
  import { readerApp } from "../core/App";
  import { ScriptPlayer } from "../core/player/ScriptPlayer";
  import { layout } from "../core/layout/LayoutEngine";
  import { stageManager } from "../core/stage/StageManager";

  const canvasContainer = ref<HTMLElement | null>(null);
  const isReady = ref(false);
  let player: ScriptPlayer | null = null;

  onMounted(async () => {
    if (!canvasContainer.value) return;
    await readerApp.init(canvasContainer.value);
    layout.init(stageManager.contentLayer, 100);
    player = new ScriptPlayer(stageManager.contentLayer);
    isReady.value = true;
  });

  const loadAndPlay = async (kmdSource: string) => {
    if (!player) return;
    await player.clearScreen();
    await player.load(kmdSource);
    player.toggleAutoPlay(true);
  };

  const stop = async () => {
    if (!player) return;
    await player.clearScreen();
    player.toggleAutoPlay(false);
  };

  const next = () => {
    player?.next(true);
  };

  defineExpose({
    loadAndPlay,
    stop,
    next
  });
</script>

<style scoped>
  .canvas-container {
    width: 100%;
    height: 100%; /* 全屏 */
    background: #000;
    overflow: hidden;
    position: relative;
    flex: auto;
  }
  .loading {
    color: white;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }
</style>
