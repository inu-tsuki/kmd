<template>
  <div class="explorer-view">
    <!-- Header -->
    <div class="explorer-header">
      <span class="project-name" :title="store.projectHandle?.name ?? ''">
        {{ store.projectHandle ? store.projectHandle.name : "EXPLORER" }}
      </span>
      <button
        class="open-btn"
        @click="handleOpenFolder"
        :disabled="!isFsaSupported()"
        :title="isFsaSupported() ? '打开文件夹' : '需要 Chrome 或 Edge 浏览器'"
      >
        ⊕
      </button>
    </div>

    <!-- 无项目时 -->
    <div v-if="!store.projectHandle" class="empty-state">
      <div class="empty-icon">📂</div>
      <p v-if="!isFsaSupported()" class="compat-hint">
        需要 Chrome 或 Edge 浏览器
      </p>
      <template v-else>
        <p class="empty-hint">打开本地项目文件夹<br />以管理 KMD 脚本</p>
        <button class="open-folder-btn" @click="handleOpenFolder">
          打开文件夹
        </button>
      </template>
    </div>

    <!-- 文件树 -->
    <div v-else class="file-tree">
      <div
        v-for="item in flatTree"
        :key="item.path"
        class="tree-item"
        :class="{
          active: item.path === store.activeFilePath,
          directory: item.kind === 'directory',
        }"
        :style="{ paddingLeft: `${item.depth * 12 + 8}px` }"
        @click="handleItemClick(item)"
        :title="item.path"
      >
        <span class="item-icon">{{
          item.kind === "directory"
            ? expandedPaths.has(item.path)
              ? "▾"
              : "▸"
            : getFileIcon(item.name)
        }}</span>
        <span class="item-name">{{ item.name }}</span>
        <span
          v-if="item.kind === 'file' && store.dirtyFiles.has(item.path)"
          class="dirty-dot"
          title="未保存"
          >●</span
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useEditorStore } from "../store/editorStore";
import { isFsaSupported } from "../services/fileSystem";
import type { FileNode } from "../services/fileSystem";

const store = useEditorStore();
const expandedPaths = ref(new Set<string>());

interface FlatItem extends FileNode {
  depth: number;
}

function flattenTree(nodes: FileNode[], depth = 0): FlatItem[] {
  const result: FlatItem[] = [];
  for (const node of nodes) {
    result.push({ ...node, depth });
    if (
      node.kind === "directory" &&
      expandedPaths.value.has(node.path) &&
      node.children
    ) {
      result.push(...flattenTree(node.children, depth + 1));
    }
  }
  return result;
}

const flatTree = computed(() => flattenTree(store.fileTree));

const handleOpenFolder = async () => {
  await store.openFolder();
  expandedPaths.value = new Set<string>();
};

const handleItemClick = (item: FlatItem) => {
  if (item.kind === "directory") {
    const next = new Set(expandedPaths.value);
    if (next.has(item.path)) next.delete(item.path);
    else next.add(item.path);
    expandedPaths.value = next;
  } else {
    store.openFile(item);
  }
};

function getFileIcon(name: string): string {
  if (name.endsWith(".kmd")) return "📄";
  if (name.endsWith(".yaml") || name.endsWith(".yml")) return "⚙";
  if (name.endsWith(".ttf") || name.endsWith(".otf") || name.endsWith(".woff2"))
    return "🔤";
  if (
    name.endsWith(".png") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".svg")
  )
    return "🖼";
  return "📃";
}
</script>

<style scoped>
.explorer-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-sidebar);
  color: var(--text-main);
  font-size: 12px;
  overflow: hidden;
}

.explorer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  height: var(--panel-header-height);
  background: var(--bg-header);
  border-bottom: 1px solid var(--border-dark);
  flex-shrink: 0;
}

.project-name {
  font-size: 11px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.open-btn {
  background: transparent;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 2px 5px;
  font-size: 14px;
  line-height: 1;
  border-radius: 2px;
  flex-shrink: 0;
}
.open-btn:hover:not(:disabled) {
  color: var(--text-bright);
  background: var(--bg-active);
}
.open-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 10px;
  padding: 24px 16px;
}

.empty-icon {
  font-size: 36px;
  opacity: 0.35;
}

.empty-hint {
  color: var(--text-dim);
  font-size: 11px;
  text-align: center;
  margin: 0;
  line-height: 1.6;
}

.compat-hint {
  color: var(--accent-warn);
  font-size: 11px;
  text-align: center;
  margin: 0;
}

.open-folder-btn {
  background: var(--accent-secondary);
  border: none;
  color: #fff;
  padding: 5px 14px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}
.open-folder-btn:hover {
  opacity: 0.85;
}

.file-tree {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
}

.tree-item {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  cursor: pointer;
  border-radius: 2px;
  padding-right: 8px;
  user-select: none;
  margin: 0 2px;
}
.tree-item:hover {
  background: var(--bg-active);
}
.tree-item.active {
  background: var(--bg-active);
}
.tree-item.active .item-name {
  color: var(--accent-primary);
}

.item-icon {
  flex-shrink: 0;
  width: 14px;
  text-align: center;
  font-size: 10px;
  color: var(--text-dim);
}
.tree-item.directory .item-icon {
  color: var(--text-main);
}

.item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dirty-dot {
  color: var(--accent-warn);
  font-size: 10px;
  flex-shrink: 0;
}

.file-tree::-webkit-scrollbar {
  width: 4px;
}
.file-tree::-webkit-scrollbar-track {
  background: transparent;
}
.file-tree::-webkit-scrollbar-thumb {
  background: var(--border-light);
  border-radius: 2px;
}
</style>
