import { BaseWindow, BrowserWindow, Menu, MenuItemConstructorOptions, NativeImage } from 'electron'

/** 菜单项可用的图标名 */
export type MenuIconName = 'refresh' | 'home' | 'devtools'

/** 菜单动作：都支持传入目标窗口，未指定时取当前聚焦窗口（子窗口同样适用） */
export interface MenuActions {
  reload: (target: BrowserWindow | null, ignoreCache?: boolean) => void
  backHome: (target: BrowserWindow | null) => void
  toggleDevTools: (target: BrowserWindow | null) => void
  /** 取菜单项图标（由调用方按当前系统主题给出对应的一套） */
  icon: (name: MenuIconName) => NativeImage
}

/** 菜单回调给的是 BaseWindow，这里收窄成 BrowserWindow；拿不到就退回当前聚焦窗口 */
const focused = (win?: BaseWindow | null): BrowserWindow | null => {
  if (win instanceof BrowserWindow && !win.isDestroyed()) return win
  const current = BrowserWindow.getFocusedWindow()
  return current && !current.isDestroyed() ? current : null
}

/**
 * 应用菜单（窗口顶部原生菜单栏）。
 *
 * 结构：
 * - 一级条目「刷新」「首页」：带图标，点一下即触发（最接近把按钮放进菜单栏的形态）
 * - 「导航」子菜单：刷新 / 强制刷新 / 返回地址输入页 / 开发者工具，带图标与快捷键
 * - 「编辑」「窗口」：常规角色项
 *
 * 注意：原生菜单栏的外观（背景色、透明度、字体）由 Chromium/系统绘制，Electron 无接口可改，
 * 能自定义的只有条目的文字、图标、结构与快捷键。
 */
export function createAppMenu(actions: MenuActions): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '刷新',
      icon: actions.icon('refresh'),
      click: (_item, win) => actions.reload(focused(win))
    },
    {
      label: '首页',
      icon: actions.icon('home'),
      click: (_item, win) => actions.backHome(focused(win))
    },
    {
      label: '导航',
      submenu: [
        {
          label: '刷新页面',
          accelerator: 'F5',
          icon: actions.icon('refresh'),
          click: (_item, win) => actions.reload(focused(win))
        },
        {
          label: '强制刷新（忽略缓存）',
          accelerator: 'CmdOrCtrl+Shift+R',
          icon: actions.icon('refresh'),
          click: (_item, win) => actions.reload(focused(win), true)
        },
        { type: 'separator' },
        {
          label: '返回地址输入页',
          accelerator: 'Alt+Left',
          icon: actions.icon('home'),
          click: (_item, win) => actions.backHome(focused(win))
        },
        { type: 'separator' },
        {
          label: '开发者工具',
          accelerator: 'F12',
          icon: actions.icon('devtools'),
          click: (_item, win) => actions.toggleDevTools(focused(win))
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '关闭窗口', role: 'close' }
      ]
    }
  ]

  if (process.platform === 'darwin') {
    template.unshift({ role: 'appMenu' })
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
