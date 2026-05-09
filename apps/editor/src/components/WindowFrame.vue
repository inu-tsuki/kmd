<template>
  <div 
    class="window-frame" 
    @dragover.prevent="handleDragOver" 
    @dragleave="handleDragLeave"
    @drop="handleDrop"
    ref="frameRef"
  >
    <div class="window-header">
      <div class="tabs">
        <div 
          v-for="view in views" 
          :key="view.id"
          class="tab"
          :class="{ active: currentViewId === view.id }"
          @click="currentViewId = view.id"
          draggable="true"
          @dragstart="handleDragStart($event, view.id)"
        >
          <span class="tab-icon" v-if="view.icon">{{ view.icon }}</span>
          <span class="tab-title">{{ view.title }}</span>
        </div>
      </div>
      <div class="actions">
        <slot name="actions"></slot>
      </div>
    </div>
    <div class="window-body">
      <keep-alive>
        <component :is="currentViewComponent" :key="currentViewId" />
      </keep-alive>

      <!-- 停靠指示层 -->
      <div v-if="dropZone" class="dock-overlay" :class="dropZone"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useEditorStore } from '../store/editorStore';

export interface ViewConfig {
  id: string;
  title: string;
  icon?: string;
  component: any;
}

const props = defineProps<{
  id: string; // 窗口的唯一 ID
  views: ViewConfig[];
  defaultViewId?: string;
}>();

const store = useEditorStore();
const currentViewId = ref(props.defaultViewId || props.views[0]?.id);
const frameRef = ref<HTMLElement | null>(null);
const dropZone = ref<'top' | 'right' | 'bottom' | 'left' | 'center' | null>(null);

// 当 views 改变时（比如被拖走了），检查 currentViewId 是否还合法
watch(() => props.views, (newViews) => {
  if (!newViews.find(v => v.id === currentViewId.value)) {
    currentViewId.value = newViews[0]?.id;
  }
}, { deep: true });

const currentViewComponent = computed(() => {
  return props.views.find(v => v.id === currentViewId.value)?.component;
});

// --- Drag & Drop 处理 ---

const handleDragStart = (e: DragEvent, viewId: string) => {
  console.log('[DnD] Start dragging:', viewId, 'from window:', props.id);
  if (e.dataTransfer) {
    e.dataTransfer.setData('viewId', viewId);
    e.dataTransfer.setData('sourceWindowId', props.id);
    e.dataTransfer.effectAllowed = 'move';
  }
};

const handleDragOver = (e: DragEvent) => {
  if (!frameRef.value) return;
  
  const rect = frameRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const w = rect.width;
  const h = rect.height;

  // 判定停靠区逻辑
  const margin = 0.3; // 边缘占比 30% 触发分裂
  let nextZone: 'top' | 'right' | 'bottom' | 'left' | 'center' = 'center';

  if (x < w * margin) nextZone = 'left';
  else if (x > w * (1 - margin)) nextZone = 'right';
  else if (y < h * margin) nextZone = 'top';
  else if (y > h * (1 - margin)) nextZone = 'bottom';
  else nextZone = 'center';

  if (dropZone.value !== nextZone) {
    dropZone.value = nextZone;
  }
};

const handleDragLeave = () => {
  dropZone.value = null;
};

const handleDrop = (e: DragEvent) => {
  const viewId = e.dataTransfer?.getData('viewId');
  const sourceWindowId = e.dataTransfer?.getData('sourceWindowId');
  console.log('[DnD] Drop:', viewId, 'on window:', props.id, 'zone:', dropZone.value);
  if (viewId && dropZone.value) {
    store.moveView(viewId, props.id, dropZone.value, sourceWindowId);
  }
  dropZone.value = null;
};
</script>

<style scoped>
.window-frame {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-sidebar);
  overflow: hidden;
  position: relative;
}

.window-header {
  height: var(--panel-header-height);
  background: var(--bg-header);
  display: flex;
  justify-content: space-between;
  align-items: center;
  user-select: none;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-dark);
}

.tabs {
  display: flex;
  height: 100%;
  overflow-x: auto;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 15px;
  height: 100%;
  font-size: 11px;
  color: var(--text-dim);
  background: var(--bg-header);
  cursor: grab;
  border-right: 1px solid var(--border-dark);
}

.tab:active {
  cursor: grabbing;
}

.tab:hover {
  background: var(--bg-active);
  color: var(--text-main);
}

.tab.active {
  background: var(--bg-editor);
  color: var(--accent-primary);
  border-bottom: 1px solid var(--accent-primary);
}

.tab-icon {
  font-size: 14px;
}

.window-body {
  flex: 1;
  position: relative;
  overflow: hidden;
}

/* 停靠指示层样式 */
.dock-overlay {
  position: absolute;
  background: rgba(0, 122, 204, 0.2);
  border: 1px solid var(--accent-secondary);
  pointer-events: none;
  z-index: 1000;
}

.dock-overlay.center { top: 0; left: 0; right: 0; bottom: 0; }
.dock-overlay.top { top: 0; left: 0; right: 0; height: 50%; }
.dock-overlay.bottom { bottom: 0; left: 0; right: 0; height: 50%; }
.dock-overlay.left { top: 0; left: 0; width: 50%; bottom: 0; }
.dock-overlay.right { top: 0; right: 0; width: 50%; bottom: 0; }

.actions {
  display: flex;
  padding-right: 10px;
}

.tabs::-webkit-scrollbar {
  display: none;
}
.tabs {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>