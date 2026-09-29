import { defineConfig } from 'vite';

// base: './' 让打包产物可以直接用 file:// 打开（Electron / Steam 桌面版需要）
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
  server: { host: true },
});
