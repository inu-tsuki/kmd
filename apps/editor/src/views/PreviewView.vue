<template>
  <div class="view-container preview-view">
    <ReaderCanvas />
  </div>
</template>

<script setup lang="ts">
import ReaderCanvas from '../components/ReaderCanvas.vue';
</script>

<style scoped>
.view-container {
  width: 100%;
  height: 100%;
  background: #000;
  display: flex;
}
</style>
