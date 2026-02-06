<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <div class="app">
    <main class="main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  position: relative;
}

.main {
  flex: 1;
  overflow: hidden;
  position: relative;
}
</style>
