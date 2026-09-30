import { contextBridge, ipcRenderer } from 'electron'

// 通过 contextBridge 白名单暴露给渲染进程的原生能力
// 后续按需扩展：通知、文件对话框、剪贴板等（走 IPC，不在渲染进程直接碰 Node）
// 类型约束来自 global.d.ts 的全局声明，实现与声明不一致会在此处报错
const api: NativeShellApi = {
  platform: process.platform,
  versions: process.versions,
  /** 查询壳子当前状态（loading / ready / offline） */
  getAppState: () => ipcRenderer.invoke('shell:get-state'),
  /** 离线页点击重试 */
  retryLoad: () => ipcRenderer.invoke('shell:retry-load'),
  /** 地址输入页确认跳转：校验并加载目标地址，非法地址返回 false */
  openUrl: (url) => ipcRenderer.invoke('shell:open-url', url),
  /** 返回地址输入页 */
  backHome: () => ipcRenderer.invoke('shell:back-home')
}

contextBridge.exposeInMainWorld('nativeShell', api)
