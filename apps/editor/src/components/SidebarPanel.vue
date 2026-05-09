<template>
  <div class="sidebar-panel" :class="{ collapsed: isCollapsed }">
    <div class="sidebar-header" @click="isCollapsed = !isCollapsed">
      <span class="icon">{{ icon }}</span>
      <span class="title" v-show="!isCollapsed">{{ title }}</span>
      <div class="toggle-btn">
        {{ isCollapsed ? '›' : '‹' }}
      </div>
    </div>
    <div class="sidebar-content" v-show="!isCollapsed">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

defineProps<{
  title: string;
  icon?: string;
}>();

const isCollapsed = ref(false);
</script>

<style scoped>
.sidebar-panel {
  width: 300px;
  background: #252526;
  border-left: 1px solid #333;
  display: flex;
  flex-direction: column;
  transition: width 0.2s ease;
}

.sidebar-panel.collapsed {
  width: 40px;
}

.sidebar-header {
  padding: 10px;
  background: #333;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #ccc;
  user-select: none;
}

.sidebar-header:hover {
  background: #3c3c3c;
  color: #fff;
}

.icon {
  width: 20px;
  text-align: center;
}

.title {
  flex: 1;
  font-size: 12px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.toggle-btn {
  font-size: 16px;
}

.sidebar-content {
  flex: 1;
  padding: 15px;
  overflow-y: auto;
}
</style>
