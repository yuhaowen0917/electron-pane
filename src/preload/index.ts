import { contextBridge, ipcRenderer } from 'electron'

// 通过 contextBridge 白名单暴露给渲染进程的原生能力
// 后续按需扩展：通知、文件对话框、剪贴板等（走 IPC，不在渲染进程直接碰 Node）
// 类型约束来自 global.d.ts 的全局声明，实现与声明不一致会在此处报错
const api: NativeShellApi = {
  platform: process.platform,
  versions: process.versions,
  /** 查询壳子当前视图状态（home / loading / offline / remote） */
  getAppState: () => ipcRenderer.invoke('shell:get-state'),
  /** 订阅主进程推送的视图状态（壳子界面常驻，靠推送切换视图） */
  onViewChange: (callback) => {
    ipcRenderer.on('shell:view', (_event, state: ShellViewState) => callback(state))
  },
  /** 顶部工具栏：刷新（离线重试 / 远程页刷新 / 地址页刷新） */
  reloadPage: () => ipcRenderer.invoke('shell:reload'),
  /** 离线页点击重试 */
  retryLoad: () => ipcRenderer.invoke('shell:retry-load'),
  /** 地址输入页确认跳转：校验并加载目标地址，非法地址返回 false */
  openUrl: (url) => ipcRenderer.invoke('shell:open-url', url),
  /** 返回地址输入页 */
  backHome: () => ipcRenderer.invoke('shell:back-home'),
  /** 历史地址列表（最近打开的排在最前） */
  getHistory: () => ipcRenderer.invoke('shell:list-history'),
  /** 删除单条历史，返回删除后的列表 */
  removeHistory: (url) => ipcRenderer.invoke('shell:remove-history', url),
  /** 清空历史，返回空列表 */
  clearHistory: () => ipcRenderer.invoke('shell:clear-history')
}

contextBridge.exposeInMainWorld('nativeShell', api)
