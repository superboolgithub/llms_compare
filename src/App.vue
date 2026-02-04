<script setup lang="ts">
import { RouterView, RouterLink } from 'vue-router'
</script>

<template>
  <div class="app">
    <nav class="nav">
      <div class="nav-content">
        <RouterLink to="/" class="nav-brand">
          <span class="brand-icon">⚡</span>
          <span class="brand-text">LLMs Compare</span>
        </RouterLink>

        <div class="nav-links">
          <RouterLink to="/" class="nav-link">
            <span class="link-icon">💬</span>
            <span class="link-text">对话</span>
          </RouterLink>
          <RouterLink to="/settings" class="nav-link">
            <span class="link-icon">⚙️</span>
            <span class="link-text">配置</span>
          </RouterLink>
        </div>
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
  position: relative;
}

/* 导航栏 */
.nav {
  position: relative;
  z-index: 100;
  background: var(--glass-bg);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--glass-border);
}

.nav-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  height: 56px;
  max-width: 1800px;
  margin: 0 auto;
}

/* 品牌标识 */
.nav-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  transition: opacity 0.2s ease;
}

.nav-brand:hover {
  opacity: 0.85;
}

.brand-icon {
  font-size: 22px;
}

.brand-text {
  font-weight: 600;
  font-size: 18px;
  background: var(--gradient-primary);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* 导航链接 */
.nav-links {
  display: flex;
  gap: 6px;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 10px;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.nav-link:hover {
  color: var(--text-primary);
  background: var(--glass-bg-light);
}

.link-icon {
  font-size: 15px;
}

/* 激活状态 */
.nav-link.router-link-active {
  color: var(--text-primary);
  background: var(--gradient-subtle);
  border: 1px solid var(--border-hover);
}

/* 主内容区 */
.main {
  flex: 1;
  overflow: hidden;
  position: relative;
}
</style>
