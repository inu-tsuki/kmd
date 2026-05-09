<template>
  <div 
    class="splitter-bar" 
    :class="direction"
    @mousedown="handleMouseDown"
  >
    <!-- 幽灵线：仅在拖拽时显示 -->
    <teleport to="body">
      <div v-if="isDragging" class="ghost-guide-overlay" @mousemove="handleMouseMove" @mouseup="handleMouseUp">
        <div 
          class="ghost-line" 
          :class="direction"
          :style="ghostStyle"
        ></div>
      </div>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  direction: 'horizontal' | 'vertical';
}>();

const emit = defineEmits<{
  (e: 'resize-end', ratio: number): void;
}>();

const isDragging = ref(false);
const ghostPos = ref(0);
const containerRect = ref<DOMRect | null>(null);

const handleMouseDown = (e: MouseEvent) => {
  isDragging.value = true;
  // 获取父容器的大小，用于后续计算百分比
  const parent = (e.currentTarget as HTMLElement).parentElement;
  if (parent) {
    containerRect.value = parent.getBoundingClientRect();
  }
  updateGhostPos(e);
};

const handleMouseMove = (e: MouseEvent) => {
  if (!isDragging.value) return;
  updateGhostPos(e);
};

const updateGhostPos = (e: MouseEvent) => {
  if (props.direction === 'horizontal') {
    ghostPos.value = e.clientX;
  } else {
    ghostPos.value = e.clientY;
  }
};

const handleMouseUp = () => {
  if (!isDragging.value || !containerRect.value) return;
  
  // 计算百分比
  let ratio = 50;
  const rect = containerRect.value;
  
  if (props.direction === 'horizontal') {
    ratio = ((ghostPos.value - rect.left) / rect.width) * 100;
  } else {
    ratio = ((ghostPos.value - rect.top) / rect.height) * 100;
  }

  // 限制边界 (10% - 90%)
  ratio = Math.max(10, Math.min(90, ratio));
  
  emit('resize-end', ratio);
  isDragging.value = false;
};

const ghostStyle = computed(() => {
  if (props.direction === 'horizontal') {
    return { left: `${ghostPos.value}px`, top: 0, bottom: 0, width: '2px' };
  } else {
    return { top: `${ghostPos.value}px`, left: 0, right: 0, height: '2px' };
  }
});
</script>

<style scoped>
.splitter-bar {
  background: #111;
  position: relative;
  z-index: 100;
  transition: background 0.2s;
  flex-shrink: 0;
}

.splitter-bar:hover {
  background: #007acc;
}

/* 增加鼠标热区：通过透明伪元素或直接扩大宽度 */
.splitter-bar.horizontal {
  width: 2px; /* 视觉宽度 */
  cursor: col-resize;
  margin: 0 3px; /* 逻辑占位，同时增加可点击范围 */
  padding: 0 2px; /* 增加背景填充区域，实际热区约 6px */
  background-clip: content-box; /* 仅让内容区显示颜色，padding 区域透明 */
}

.splitter-bar.vertical {
  height: 2px; /* 视觉高度 */
  cursor: row-resize;
  margin: 3px 0;
  padding: 2px 0;
  background-clip: content-box;
}

/* 幽灵线覆盖层 */
.ghost-guide-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  cursor: inherit; /* 继承 Splitter 的光标样式 */
}

.ghost-line {
  position: absolute;
  background: #007acc;
  box-shadow: 0 0 8px rgba(0, 122, 204, 0.8);
  pointer-events: none;
}

.ghost-line.horizontal {
  border-left: 1px dashed #fff;
}

.ghost-line.vertical {
  border-top: 1px dashed #fff;
}
</style>
