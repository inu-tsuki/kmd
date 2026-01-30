<template>
  <div ref="canvasContainer" class="canvas-container">
    <!-- Pixi 的 Canvas 会被插入到这里 -->
    <div v-if="!isReady" class="loading">Engine Loading...</div>
  </div>
</template>

<script setup lang="ts">
  import { ref, onMounted, onUnmounted } from "vue";
  import { readerApp } from "../core/App";
  // import { effectManager } from "../core/effects/EffectManager";
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
        layout.addLine("{第一章}：{觉醒} @ f.red.popIn(delay=0) f.blue.popIn(delay=0.5) .fadeShake(strength=1, delay=1.5)");
    layout.addLine(""); // 空行
    layout.addLine("那是{深渊}的凝视。 @ f.purple.glitch.rainbow");
    layout.addLine("它在问我： @ .border");
    layout.addLine("你愿意献祭灵魂吗？ @ .red.shake.glow.pulse");
    layout.addLine("我回答：{不愿意}。 @ f(blue, bold, shake, wave, rotate)");
    layout.addLine("");
    layout.addLine("“你制作的{东西}，真是……”他说， @ f.rainbow.float");
    layout.addLine("{意☆味☆不☆明}呢 @ f.pulse.glitch.glow");
    layout.addLine("叠加测试：{摇摆闪烁} @ f.swing.flash");
    layout.addLine("位置叠加：{又抖又浪} @ f.shake.wave.blur(strength=2)");
/*     // 1. 赛博朋克风：RGB 色散
    const textRGB = new KineticText("{CYBERPUNK} @ f.rgbShift(dist=2, anim=1)");
    textRGB.x = readerApp.pixiApp.renderer.width / 2 - 100;
    textRGB.y = 400;
    readerApp.pixiApp.stage.addChild(textRGB);

    // 2. 物理效果：文字掉落
    const textDrop = new KineticText("{牛顿}的苹果 @ f.gravity");
    textDrop.x = readerApp.pixiApp.renderer.width / 2 - 100;
    textDrop.y = 300; // 从高处开始
    readerApp.pixiApp.stage.addChild(textDrop);
    // 测试：高温扭曲效果
    // 频率高一点，振幅小一点，像热浪
    const textWarp = new KineticText(
      "{高温警报} @ f.warp(freq=20, amp=0.02, speed=0.01) f.red",
    );
    textWarp.x = readerApp.pixiApp.renderer.width / 2 - 100;
    textWarp.y = 100;
    readerApp.pixiApp.stage.addChild(textWarp);

    // 测试：液化效果
    // 频率低一点，振幅大一点，像水
    const textLiquid = new KineticText(
      "{我融化了...} @ f.warp(freq=5, amp=0.1, speed=0.005)",
    );
    textLiquid.x = readerApp.pixiApp.renderer.width / 2 - 100;
    textLiquid.y = 200;
    readerApp.pixiApp.stage.addChild(textLiquid); */
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
