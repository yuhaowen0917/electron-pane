/**
 * 壳子暴露给渲染层的 API 全局类型声明。
 *
 * 注意：
 * 1. 本文件不能命名为 index.d.ts —— tsconfig.node.json 为 composite 项目，
 *    会为 index.ts 生成同名声明文件，导致 TS5055（输出覆盖输入）。
 * 2. 本文件不使用 import/export（保持全局脚本形态），
 *    避免把 preload 源码拉进渲染层工程的文件清单。
 * 3. 字段需与 src/preload/index.ts 中的 api 实现保持一致（实现侧用 NativeShellApi 约束）。
 */

interface NativeShellApi {
  platform: string
  versions: Record<string, string | undefined>
  /** 查询壳子当前状态（loading / ready / offline） */
  getAppState: () => Promise<{
    state: 'loading' | 'ready' | 'offline'
    url: string
    lastError: string | null
  }>
  /** 离线页点击重试 */
  retryLoad: () => Promise<void>
  /** 地址输入页确认跳转：校验并加载目标地址，非法地址返回 false */
  openUrl: (url: string) => Promise<boolean>
  /** 返回地址输入页 */
  backHome: () => Promise<void>
  /** 历史地址列表（最近打开的排在最前） */
  getHistory: () => Promise<string[]>
  /** 删除单条历史，返回删除后的列表 */
  removeHistory: (url: string) => Promise<string[]>
  /** 清空历史，返回空列表 */
  clearHistory: () => Promise<string[]>
}

interface Window {
  nativeShell: NativeShellApi
}
