<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import "splitpanes/dist/splitpanes.css";

import DockNode from "./components/DockSystem/DockNode.vue";
import LayoutManager from "./components/LayoutManager.vue";
import TimeLordBar from "./components/Playback/TimeLordBar.vue";
import { useEditorStore } from "./store/editorStore";

const store = useEditorStore();

onMounted(async () => {
  // 尝试恢复上次打开的项目文件夹
  await store.restoreProject();

  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});

const isEditorFocused = () => {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "textarea" ||
    tag === "input" ||
    (el as HTMLElement).isContentEditable ||
    el.closest(".monaco-editor") !== null
  );
};

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape" && store.isPreviewMaximized) {
    store.togglePreviewMaximized();
    return;
  }
  if (e.ctrlKey && e.key === "Enter") {
    store.runScript();
    return;
  }
  if (e.ctrlKey && e.key === "s") {
    e.preventDefault();
    store.saveCurrentFile();
    return;
  }
  if (e.altKey && e.key === "n") {
    store.nextStep();
    return;
  }
  if (isEditorFocused()) return;

  if (e.key === " ") {
    e.preventDefault();
    store.player?.toggleAutoPlay();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    store.seekRelative(e.shiftKey ? -5 : -1);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    store.seekRelative(e.shiftKey ? 5 : 1);
  }
};

const createNew = () => {
  if (confirm("确定要创建新文件吗？")) {
    store.kmdContent =
      "---\ntitle: 未命名\nmode: stage\n---\n\n在这里开始创作...";
  }
};

const exportKmd = () => {
  const blob = new Blob([store.kmdContent], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "export.kmd";
  a.click();
  URL.revokeObjectURL(url);
};
</script>

<template>
  <div class="app-container">
    <!-- 顶部工具栏 -->
    <header class="top-toolbar">
      <div class="left-group">
        <span class="brand">KMD <span class="version">IDE v1.6.0</span></span>
        <button
          @click="store.openFolder"
          class="tool-btn"
          title="打开本地项目文件夹"
        >
          📁 打开
        </button>
        <button @click="createNew" class="tool-btn">新建</button>
        <button @click="exportKmd" class="tool-btn">导出</button>
      </div>

      <div class="center-group">
        <button @click="store.runScript" class="btn-run" title="Ctrl + Enter">
          ▶ 运行演出
        </button>
        <button @click="store.nextStep" class="tool-btn" title="Alt + N">
          ⏭ 下一步
        </button>
        <button @click="store.stopScript" class="tool-btn">⏹ 停止</button>
      </div>

      <div class="right-group">
        <button @click="store.togglePreviewMaximized" class="tool-btn" :title="store.isPreviewMaximized ? '退出最大化预览' : '最大化预览'">
          {{ store.isPreviewMaximized ? '🗗' : '🗗' }} 预览
        </button>
        <LayoutManager />
      </div>
    </header>

    <main class="main-layout">
      <!-- 动态布局内核 -->
      <DockNode :node="store.layoutTree" />
    </main>

    <!-- 播放控制条 -->
    <TimeLordBar />

    <!-- 底部状态栏 -->
    <footer class="status-bar">
      <span class="status-item">● System Ready</span>
      <span class="status-item"
        >Mode: {{ store.canvasConfig.mode.toUpperCase() }}</span
      >
      <span class="status-item"
        >Res: {{ store.canvasConfig.width }}x{{
          store.canvasConfig.height
        }}</span
      >
      <div class="divider-v"></div>
      <span v-if="store.activeFilePath" class="status-item file-status">
        {{ store.activeFilePath }}
        <span
          v-if="store.dirtyFiles.has(store.activeFilePath)"
          class="dirty-indicator"
        >
          ●</span
        >
      </span>
      <div class="spacer"></div>
      <span class="status-item">Kinetic Markdown Editor</span>
    </footer>
  </div>
</template>

<style>
/* 全局 IDE 风格布局 */
.app-container {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  background: #1e1e1e;
  color: #ccc;
}

.top-toolbar {
  height: 35px;
  background: #2d2d2d;
  display: flex;
  justify-content: space-between;
  padding: 0 10px;
  align-items: center;
  border-bottom: 1px solid #111;
  z-index: 100;
}

.main-layout {
  flex: 1;
  overflow: hidden;
}

.status-bar {
  height: 22px;
  background: #007acc;
  color: #fff;
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: 11px;
}
.status-bar .spacer {
  flex: 1;
}
.status-item {
  margin-right: 15px;
}
.divider-v {
  width: 1px;
  height: 12px;
  background: rgba(255, 255, 255, 0.3);
  margin: 0 8px;
}
.file-status {
  opacity: 0.9;
  font-family: monospace;
}
.dirty-indicator {
  color: #f9c06a;
  font-size: 13px;
}

/* Splitpanes 深度美化 */
.splitpanes__pane {
  transition: none !important;
}
.splitpanes--vertical > .splitpanes__splitter {
  min-width: 3px;
  background: #111;
  border-left: 1px solid #333;
}
.splitpanes--horizontal > .splitpanes__splitter {
  min-height: 3px;
  background: #111;
  border-top: 1px solid #333;
}
.splitpanes__splitter:hover {
  background: #007acc !important;
}

/* 通用 UI 元素 */
.tool-btn {
  background: transparent;
  border: none;
  color: #aaa;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
  border-radius: 2px;
}
.tool-btn:hover {
  background: #3e3e3e;
  color: #fff;
}

.btn-run {
  background: #2d5a27;
  border: none;
  color: #fff;
  padding: 3px 12px;
  border-radius: 2px;
  cursor: pointer;
  font-weight: bold;
  font-size: 11px;
}
.btn-run:hover {
  background: #3e7b35;
}

.brand {
  color: #4fc08d;
  font-weight: bold;
  font-size: 13px;
}
.version {
  font-size: 9px;
  opacity: 0.5;
  margin-left: 4px;
}
.divider {
  width: 1px;
  height: 14px;
  background: #444;
  margin: 0 10px;
}
</style>
