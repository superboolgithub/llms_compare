<script setup lang="ts">
import { RouterView, RouterLink } from 'vue-router'
</script>

<template>
  <div class="app">
    <nav class="nav">
      <div class="nav-brand">LLMs Compare</div>
      <div class="nav-links">
        <RouterLink to="/" class="nav-link">对话</RouterLink>
        <RouterLink to="/settings" class="nav-link">配置</RouterLink>
      </div>
    </nav>
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
}

.nav {
  display: flex;
  align-items: center;
  padding: 0 20px;
  height: 50px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.nav-brand {
  font-weight: 700;
  font-size: 18px;
  color: var(--primary-color);
  margin-right: 30px;
}

.nav-links {
  display: flex;
  gap: 5px;
}

.nav-link {
  padding: 8px 16px;
  border-radius: 6px;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 14px;
  transition: all 0.2s;
}

.nav-link:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.nav-link.router-link-active {
  background: var(--primary-color);
  color: white;
}

.main {
  flex: 1;
  overflow: hidden;
}
</style>
