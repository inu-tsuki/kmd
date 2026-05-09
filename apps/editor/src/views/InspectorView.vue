<template>
  <div class="inspector-view">
    <!-- 顶部 Tab 切换 -->
    <div class="view-tabs">
      <div 
        class="view-tab" 
        :class="{ active: activeTab === 'canvas' }"
        @click="activeTab = 'canvas'"
      >
        <span class="tab-icon">🎨</span> 画布
      </div>
      <div 
        class="view-tab" 
        :class="{ active: activeTab === 'vars' }"
        @click="activeTab = 'vars'"
      >
        <span class="tab-icon">📊</span> 变量
      </div>
      <div 
        class="view-tab disabled"
      >
        <span class="tab-icon">📜</span> 段落
      </div>
    </div>

    <!-- 可滚动的内容区域 -->
    <div class="scroll-content">
      <!-- 1. 画布设定面板 -->
      <div v-if="activeTab === 'canvas'" class="config-panel">
        <div class="kmd-group">
          <div class="kmd-group-header">系统配置</div>
          <div class="kmd-field">
            <label class="kmd-label">播放模式</label>
            <div class="kmd-control-wrapper">
              <select v-model="store.canvasConfig.mode" class="kmd-select">
                <option value="stage">演戏模式 (Stage)</option>
                <option value="scroll">阅读模式 (Scroll)</option>
                <option value="page">分页模式 (Page)</option>
              </select>
            </div>
          </div>
        </div>

        <div class="kmd-group" v-if="store.canvasConfig.mode === 'stage'">
          <div class="kmd-group-header">物理画幅</div>
          <div class="kmd-field">
            <div class="input-grid">
              <div class="grid-item">
                <label class="kmd-label">Width</label>
                <input type="number" v-model.number="store.canvasConfig.width" class="kmd-input" />
              </div>
              <div class="grid-item">
                <label class="kmd-label">Height</label>
                <input type="number" v-model.number="store.canvasConfig.height" class="kmd-input" />
              </div>
            </div>
            <div class="preset-row">
              <button 
                v-for="p in ['16:9', '9:16', '1:1']" 
                :key="p"
                @click="store.setPreset(p)" 
                class="kmd-chip"
              >{{ p }}</button>
            </div>
          </div>
        </div>

        <div class="kmd-group">
          <div class="kmd-group-header">全局渲染</div>
          <div class="kmd-field">
            <div class="prop-row">
              <label class="kmd-label">画布背景色</label>
              <div class="color-preview-wrap">
                <span class="hex-code">{{ store.canvasConfig.bgColor }}</span>
                <input type="color" v-model="store.canvasConfig.bgColor" class="kmd-color-pick" />
              </div>
            </div>
          </div>
          <div class="kmd-field">
            <div class="prop-row">
              <label class="kmd-label">文字默认色</label>
              <div class="color-preview-wrap">
                <span class="hex-code">{{ store.canvasConfig.fontColor }}</span>
                <input type="color" v-model="store.canvasConfig.fontColor" class="kmd-color-pick" />
              </div>
            </div>
          </div>
          <div class="kmd-field">
            <label class="kmd-label">默认字体族</label>
            <div class="kmd-control-wrapper">
              <select v-model="store.canvasConfig.fontFamily" class="kmd-select">
                <option value="LXGW WenKai">霞鹜文楷</option>
                <option value="Smiley Sans">得意黑</option>
                <option value="Sasara Regular">更纱黑体</option>
                <option value="Fira Code">Fira Code</option>
                <option value="sans-serif">系统默认</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. 变量设定面板 -->
      <div v-if="activeTab === 'vars'" class="config-panel">
        <div class="kmd-group">
          <div class="kmd-group-header">实时全局变量 (var.*)</div>
          <div v-if="Object.keys(markers).length === 0" class="empty-hint">
            <div class="icon">🔍</div>
            <p>等待脚本定义变量...</p>
          </div>
          <div class="var-table">
            <div v-for="(val, key) in markers" :key="key" class="var-row">
              <div class="var-info">
                <span class="prefix">var.</span>
                <span class="name">{{ key }}</span>
              </div>
              <div class="var-value-box">{{ val.x.toFixed(1) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useEditorStore } from '../store/editorStore';
import { layout } from '../core/layout/LayoutEngine';

const store = useEditorStore();
const activeTab = ref('canvas');
const markers = ref<any>({});

let timer: any = null;
onMounted(() => {
  timer = setInterval(() => {
    const currentMarkers: any = {};
    layout.globalMarkers.forEach((v, k) => {
      if (k.startsWith('var.')) {
        currentMarkers[k.substring(4)] = v;
      }
    });
    markers.value = currentMarkers;
  }, 500);
});

onUnmounted(() => {
  clearInterval(timer);
});
</script>

<style scoped>
.inspector-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-sidebar);
  color: var(--text-main);
  border-left: 1px solid var(--border-dark);
}

/* Tab 样式 */
.view-tabs {
  display: flex;
  background: var(--bg-header);
  border-bottom: 1px solid var(--border-dark);
  padding: 0 4px;
}

.view-tab {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-dim);
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0.7;
  transition: all 0.2s;
}

.view-tab:hover:not(.disabled) {
  opacity: 1;
  color: var(--text-bright);
}

.view-tab.active {
  opacity: 1;
  color: var(--accent-primary);
  box-shadow: inset 0 -2px 0 var(--accent-primary);
}

.view-tab.disabled {
  cursor: not-allowed;
  opacity: 0.2;
}

.tab-icon {
  font-size: 14px;
}

/* 内容区域 */
.scroll-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

/* 极客风格控件组 */
.kmd-group {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border-main);
  border-radius: 4px;
  padding: 12px;
  margin-bottom: 16px;
}

.kmd-group-header {
  font-size: 9px;
  font-weight: 900;
  color: var(--accent-secondary);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.kmd-group-header::after {
  content: '';
  flex: 1;
  height: 1px;
  background: linear-gradient(to right, var(--border-main), transparent);
}

.kmd-field {
  margin-bottom: 12px;
}

.prop-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* 颜色选择器美化 */
.color-preview-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-input);
  padding: 2px 2px 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--border-light);
}

.hex-code {
  font-family: 'Fira Code', monospace;
  font-size: 10px;
  color: var(--text-dim);
}

.kmd-color-pick {
  -webkit-appearance: none;
  border: none;
  width: 20px;
  height: 20px;
  border-radius: 3px;
  cursor: pointer;
  background: none;
}
.kmd-color-pick::-webkit-color-swatch-wrapper { padding: 0; }
.kmd-color-pick::-webkit-color-swatch { border: none; border-radius: 2px; }

/* 网格输入 */
.input-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 8px;
}

.preset-row {
  display: flex;
  gap: 4px;
}

.kmd-chip {
  background: var(--bg-active);
  border: 1px solid var(--border-light);
  color: var(--text-dim);
  font-size: 9px;
  padding: 2px 8px;
  border-radius: 10px;
  cursor: pointer;
}
.kmd-chip:hover {
  border-color: var(--accent-secondary);
  color: var(--text-bright);
}

/* 变量列表美化 */
.var-table {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.var-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}

.var-info {
  font-family: 'Fira Code', monospace;
  font-size: 11px;
}
.var-info .prefix { color: var(--text-dim); }
.var-info .name { color: #9cdcfe; }

.var-value-box {
  background: var(--bg-active);
  color: #b5cea8;
  padding: 2px 8px;
  border-radius: 4px;
  min-width: 40px;
  text-align: right;
  font-family: 'Fira Code', monospace;
}

.empty-hint {
  text-align: center;
  padding: 30px 0;
  color: var(--text-dim);
}
.empty-hint .icon { font-size: 24px; margin-bottom: 10px; opacity: 0.3; }
</style>