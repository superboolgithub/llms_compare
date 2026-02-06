import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
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
