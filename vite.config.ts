import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const basePath =
  process.env.VITE_BASE_PATH ??
  (process.env.GITHUB_ACTIONS && repoName ? `/${repoName}/` : '/')

export default defineConfig({
  base: basePath,
  plugins: [vue()],
  server: {
    proxy: {
      // 代理 SearXNG 请求以绕过 CORS
      '/api/searxng': {
        target: 'https://railwaysearxng-production.up.railway.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/searxng/, ''),
        secure: true
      }
    }
  }
})
