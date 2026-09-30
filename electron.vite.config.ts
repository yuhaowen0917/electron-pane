import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

/**
 * 轮询监听配置。
 * IDE / agent 层写入的文件不触发文件系统变更事件（ReadDirectoryChangesW 漏检），
 * 默认的事件监听会感知不到代码改动，改用 mtime 轮询保证改动一定被发现。
 */
const pollingWatch = {
  usePolling: true,
  interval: 300
}

export default defineConfig(({ command }) => {
  // 仅开发模式（serve）开启 main / preload 的 watch：
  // 改动后 electron-vite 会重建并自动重启 Electron（preload 则触发渲染层 full-reload）。
  // 打包（build）时不能带上 watch，否则 vite 会一直挂着不退出。
  const devBuildWatch = command === 'serve' ? { watch: { chokidar: pollingWatch } } : {}

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      build: devBuildWatch
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: devBuildWatch
    },
    renderer: {
      resolve: {
        alias: {
          '@': resolve('src/renderer/src')
        }
      },
      server: {
        watch: pollingWatch
      },
      plugins: [vue()]
    }
  }
})
