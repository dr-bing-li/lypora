import { defineConfig } from 'vite'

// base: './' 是为了让构建产物在 Electron 的 file:// 协议和 Android WebView
// 的本地资源协议下都能正确加载（绝对路径会 404）。
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: '127.0.0.1',
    port: 5183,
  },
})
