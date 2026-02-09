<script setup lang="ts">
  import { ref, onMounted, onUnmounted } from "vue";
  import ReaderCanvas from "./components/ReaderCanvas.vue";
  import KmdEditor from "./components/KmdEditor.vue";

  const kmdContent = ref("");
  const canvasRef = ref<any>(null);

  // 默认加载一个测试示例
  onMounted(async () => {
    const res = await fetch("/final-test.kmd");
    kmdContent.value = await res.text();
    
    // 绑定全局快捷键
    window.addEventListener("keydown", handleKeydown);
  });

  onUnmounted(() => {
    window.removeEventListener("keydown", handleKeydown);
  });

  const handleKeydown = (e: KeyboardEvent) => {
    // Ctrl + Enter: 运行
    if (e.ctrlKey && e.key === "Enter") {
      runScript();
    }
    // Alt + N: 下一步
    if (e.altKey && e.key === "n") {
      nextStep();
    }
  };

  const runScript = () => {
    canvasRef.value?.loadAndPlay(kmdContent.value);
  };

  const stopScript = () => {
    canvasRef.value?.stop();
  };

  const nextStep = () => {
    canvasRef.value?.next();
  };
</script>

<template>
  <div class="editor-layout">
    <!-- 左侧：编辑器区域 -->
    <div class="editor-panel">
      <div class="panel-header">
        <span class="brand">KMD Editor <small>v1.1.0</small></span>
        <div class="controls">
          <button @click="runScript" class="btn-run" title="Ctrl + Enter">▶ 运行</button>
          <button @click="nextStep" title="Alt + N">⏭ 下一步</button>
          <button @click="stopScript">⏹ 停止</button>
        </div>
      </div>
      
      <div class="editor-wrapper">
        <KmdEditor v-model="kmdContent" />
      </div>

      <div class="panel-footer">
        快捷键: Ctrl + Enter 运行 | Alt + N 下一步
      </div>
    </div>

    <!-- 右侧：预览区域 -->
    <div class="preview-panel">
      <ReaderCanvas ref="canvasRef" />
    </div>
  </div>
</template>

<style>
  /* 基础重置 */
  body, html, #app {
    margin: 0; padding: 0;
    width: 100%; height: 100%;
    background: #1e1e1e;
    color: #d4d4d4;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  }

  .editor-layout {
    display: flex;
    width: 100%;
    height: 100%;
  }

  .editor-panel {
    flex: 0 0 500px;
    display: flex;
    flex-direction: column;
    border-right: 1px solid #333;
    background: #252526;
  }

  .editor-wrapper {
    flex: 1;
    overflow: hidden;
  }

  .panel-header {
    padding: 10px 15px;
    background: #333;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .brand {
    font-weight: bold;
    color: #4fc08d;
  }

  .controls button {
    margin-left: 5px;
    padding: 4px 10px;
    background: #444;
    border: none;
    color: white;
    cursor: pointer;
    border-radius: 3px;
    font-size: 13px;
  }

  .controls button:hover {
    background: #555;
  }

  .controls .btn-run {
    background: #28a745;
  }

  .panel-footer {
    padding: 5px 15px;
    font-size: 12px;
    color: #666;
    background: #252526;
    border-top: 1px solid #333;
  }

  .preview-panel {
    flex: 1;
    position: relative;
    background: #000;
  }
</style>