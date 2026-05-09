<template>
  <div class="view-container editor-view">
    <KmdEditor v-model="store.kmdContent" />
  </div>
</template>

<script setup lang="ts">
import KmdEditor from '../components/KmdEditor.vue';
import { useEditorStore } from '../store/editorStore';

const store = useEditorStore();
</script>

<style scoped>
.view-container {
  width: 100%;
  height: 100%;
  background: #1e1e1e;
}
</style>
