import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    server: {
      watch: {
        // 轮询监听：IDE/agent 层写入的文件不触发文件系统变更事件，
        // 默认的 ReadDirectoryChangesW 监听会漏检，改用 mtime 轮询保证 HMR 生效
        usePolling: true,
        interval: 300
      }
    },
    plugins: [vue()]
  }
})
