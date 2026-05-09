<template>
  <div class="layout-manager" v-click-outside="close">
    <button class="tool-btn dropdown-trigger" @click="isOpen = !isOpen">
      📐 布局管理
    </button>
    
    <div v-if="isOpen" class="dropdown-menu">
      <div class="menu-section">
        <div class="section-label">预设方案</div>
        <div class="btn-group">
          <button @click="applyPreset('default')">默认布局</button>
          <button @click="applyPreset('focus-editor')">专注编辑</button>
          <button @click="applyPreset('focus-preview')">专注预览</button>
        </div>
      </div>
      
      <div class="menu-divider"></div>
      
      <div class="menu-section">
        <div class="section-label">布局存档</div>
        <div v-for="i in 3" :key="i" class="slot-row">
          <span>存档 {{ i }}</span>
          <div class="actions">
            <button @click="store.saveLayout(i)">保存</button>
            <button @click="store.loadLayout(i)">载入</button>
          </div>
        </div>
      </div>

      <div class="menu-divider"></div>

      <div class="menu-section">
        <button class="export-btn" @click="exportAuditReport">
          📄 生成审计报告
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useEditorStore } from '../store/editorStore';

const store = useEditorStore();
const isOpen = ref(false);

const close = () => {
  isOpen.value = false;
};

const applyPreset = (type: any) => {
  store.resetLayout(type);
  close();
};

const exportAuditReport = () => {
  const data = JSON.stringify(store.layoutAuditLog, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `layout-audit-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  close();
};

// 简单的自定义指令用于点击外部关闭
const vClickOutside = {
  mounted(el: any, binding: any) {
    el.clickOutsideEvent = (event: Event) => {
      if (!(el === event.target || el.contains(event.target))) {
        binding.value();
      }
    };
    document.addEventListener('click', el.clickOutsideEvent);
  },
  unmounted(el: any) {
    document.removeEventListener('click', el.clickOutsideEvent);
  },
};
</script>

<style scoped>
.layout-manager {
  position: relative;
  display: inline-block;
}

.dropdown-trigger {
  color: var(--accent-primary) !important;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 5px;
  width: 200px;
  background: var(--bg-sidebar);
  border: 1px solid var(--border-light);
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  z-index: 1000;
  border-radius: 4px;
  padding: 8px 0;
}

.menu-section {
  padding: 0 12px 8px;
}

.section-label {
  font-size: 10px;
  color: var(--text-dim);
  text-transform: uppercase;
  margin-bottom: 8px;
  font-weight: bold;
}

.btn-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.btn-group button {
  text-align: left;
  background: var(--bg-header);
  border: 1px solid transparent;
  color: var(--text-main);
  font-size: 11px;
  padding: 6px 8px;
  border-radius: 2px;
  cursor: pointer;
}

.btn-group button:hover {
  background: var(--bg-active);
  color: var(--text-bright);
  border-color: var(--border-light);
}

.menu-divider {
  height: 1px;
  background: var(--border-main);
  margin: 4px 0 8px;
}

.slot-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--text-main);
  margin-bottom: 6px;
}

.actions {
  display: flex;
  gap: 4px;
}

.actions button {
  background: var(--bg-header);
  border: none;
  color: var(--text-dim);
  font-size: 10px;
  padding: 2px 6px;
  cursor: pointer;
}

.actions button:hover {
  background: var(--accent-secondary);
  color: #fff;
}

.export-btn {
  width: 100%;
  background: var(--accent-primary);
  border: none;
  color: #fff;
  font-size: 11px;
  padding: 8px;
  border-radius: 2px;
  cursor: pointer;
  font-weight: bold;
}

.export-btn:hover {
  filter: brightness(1.1);
}
</style>
