<script setup lang="ts">
  import ReaderCanvas from "./components/ReaderCanvas.vue";
</script>

<template>
  <ReaderCanvas />
</template>

<style>
  /* 重置默认样式，保证全屏 */
  body,
  html,
  #app {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
</style>
