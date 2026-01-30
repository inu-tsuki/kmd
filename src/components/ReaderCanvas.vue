<template>
  <div ref="canvasContainer" class="canvas-container">
    <!-- Pixi 的 Canvas 会被插入到这里 -->
    <div v-if="!isReady" class="loading">Engine Loading...</div>
  </div>
</template>

<script setup lang="ts">
  import { ref, onMounted, onUnmounted } from "vue";
  import { readerApp } from "../core/App";
  // import { KineticText } from "../core/KineticText";
  import { layout } from "../core/layout/LayoutEngine";

  const canvasContainer = ref<HTMLElement | null>(null);
  const isReady = ref(false);

  onMounted(async () => {
    if (!canvasContainer.value) return;
    await readerApp.init(canvasContainer.value);
    // 初始化排版引擎，告诉它往 stage 上画
    layout.init(readerApp.pixiApp.stage, 150);
    isReady.value = true;
    // 开始写小说！
    layout.addLine("{第一章}：觉醒 @ f.big.bold");
    layout.addLine(""); // 空行
    layout.addLine("那是{深渊}的凝视。 @ f.purple.glitch");
    layout.addLine("它在问我：");
    layout.addLine("你愿意献祭灵魂吗？ @ .red.shake.glow");
    layout.addLine("我回答：{不愿意}。 @ f(blue, bold)");
  });

  onUnmounted(() => {
    // 组件销毁时的清理逻辑，视需求而定
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
