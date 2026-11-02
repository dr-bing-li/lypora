import { defineConfig } from 'vite'
import pkg from './package.json'

// base: './' 是为了让构建产物在 Electron 的 file:// 协议和 Android WebView
// 的本地资源协议下都能正确加载（绝对路径会 404）。
export default defineConfig({
  base: './',
  // 版本号只有一个真源（package.json）：界面「关于」、桌面壳、APK 都从这里取，
  // 免得改版本时漏掉某一处，出现 0.4.1 的包里写着 0.4.0。
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
