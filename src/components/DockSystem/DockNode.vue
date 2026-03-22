<template>
  <div 
    v-if="node.type === 'split'" 
    class="dock-split" 
    :class="node.direction"
    :style="{ flex: node.size ? `0 0 ${node.size}%` : '1 1 auto' }"
  >
    <!-- 递归渲染子节点 -->
    <template v-for="(child, idx) in node.children" :key="child.id">
      <DockNode :node="child" />
      <!-- 在每两个子节点之间插入分割条 -->
      <SplitterBar 
        v-if="(idx as number) < node.children.length - 1" 
        :direction="node.direction"
        @resize-end="(ratio) => handleResizeEnd(idx as number, ratio)"
      />
    </template>
  </div>

  <div 
    v-else-if="node.type === 'window'" 
    class="dock-window"
    :style="{ flex: node.size ? `0 0 ${node.size}%` : '1 1 auto' }"
  >
    <WindowFrame :id="node.id" :views="mappedViews" />
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, watch } from 'vue';
import WindowFrame from '../WindowFrame.vue';
import SplitterBar from './SplitterBar.vue';
import { useEditorStore } from '../../store/editorStore';

// 引入视图
import EditorView from '../../views/EditorView.vue';
import PreviewView from '../../views/PreviewView.vue';
import InspectorView from '../../views/InspectorView.vue';
import MonitorView from '../../views/MonitorView.vue';
import ExplorerView from '../../views/ExplorerView.vue';

const props = defineProps<{
  node: any;
}>();

const store = useEditorStore();

// 防止初始化时的正反馈环路
let isLocked = false;
watch(() => props.node, () => {
  isLocked = true;
  setTimeout(() => isLocked = false, 500);
}, { deep: false });

// 核心逻辑：拖拽结束后的局部比例调整
const handleResizeEnd = (idx: number, ratio: number) => {
  if (isLocked) return;
  store.setNodeSizesFromSplitter(props.node.id, idx, ratio);
};

const viewRegistry: Record<string, any> = {
  'editor': { id: 'editor', title: 'Editor', icon: '📝', component: markRaw(EditorView) },
  'preview': { id: 'preview', title: 'Live Preview', icon: '🎬', component: markRaw(PreviewView) },
  'inspector': { id: 'inspector', title: 'Inspector', icon: '⚙', component: markRaw(InspectorView) },
  'monitor': { id: 'monitor', title: 'Monitor', icon: '📊', component: markRaw(MonitorView) },
  'explorer': { id: 'explorer', title: 'Explorer', icon: '📁', component: markRaw(ExplorerView) }
};

const mappedViews = computed(() => {
  if (!props.node.views) return [];
  return props.node.views.map((vId: string) => viewRegistry[vId]).filter(Boolean);
});
</script>

<style scoped>
.dock-split {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.dock-split.horizontal {
  flex-direction: row;
}

.dock-split.vertical {
  flex-direction: column;
}

.dock-window {
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
</style>
