<template>
  <div ref="canvasContainer" class="canvas-container">
    <!-- Pixi 的 Canvas 会被插入到这里 -->
    <div v-if="!isReady" class="loading">Engine Loading...</div>
  </div>
</template>

<script setup lang="ts">
  import { ref, onMounted, onUnmounted } from "vue";
  import { readerApp } from "../core/App";
  import { KineticText } from "../core/KineticText";

  const canvasContainer = ref<HTMLElement | null>(null);
  const isReady = ref(false);

  onMounted(async () => {
    if (!canvasContainer.value) return;

    // 1. 初始化 Pixi
    await readerApp.init(canvasContainer.value);
    isReady.value = true;
    const text = new KineticText("Ghost In Shell");
    text.x = 100;
    text.y = 300;
    readerApp.pixiApp.stage.addChild(text);

    // 测试 1: 全体波浪
    text.applyEffectToAll("wave", { height: 15 });

    // 测试 2: "Ghost" 这个词模糊进场
    text.applyEffectToRange(0, 5, "blurIn", { duration: 2 });

    // 测试 3: "Shell" 这个词故障震动
    text.applyEffectToRange(9, 14, "glitch");
  });

  onUnmounted(() => {
    // 组件销毁时的清理逻辑，视需求而定
  });
</script>

<style scoped>
  .canvas-container {
    width: 100%;
    height: 100vh; /* 全屏 */
    background: #000;
    overflow: hidden;
    position: relative;
  }
  .loading {
    color: white;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }
</style>
