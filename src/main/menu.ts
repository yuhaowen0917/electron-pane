import { BaseWindow, BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron'

/** 菜单动作：都支持传入目标窗口，未指定时取当前聚焦窗口（子窗口同样适用） */
export interface MenuActions {
  reload: (target: BrowserWindow | null, ignoreCache?: boolean) => void
  backHome: (target: BrowserWindow | null) => void
  toggleDevTools: (target: BrowserWindow | null) => void
}

/** 菜单回调给的是 BaseWindow，这里收窄成 BrowserWindow；拿不到就退回当前聚焦窗口 */
const focused = (win?: BaseWindow | null): BrowserWindow | null => {
  if (win instanceof BrowserWindow && !win.isDestroyed()) return win
  const current = BrowserWindow.getFocusedWindow()
  return current && !current.isDestroyed() ? current : null
}

/**
 * 应用菜单（窗口顶部原生菜单栏）。
 * 刷新 / 返回首页等导航操作放在这里，处于窗口原生层，
 * 不受页面样式、z-index、遮罩影响，任何页面状态下都能用。
 */
export function createAppMenu(actions: MenuActions): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '导航',
      submenu: [
        {
          label: '刷新页面',
          accelerator: 'F5',
          click: (_item, win) => actions.reload(focused(win))
        },
        {
          label: '强制刷新（忽略缓存）',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: (_item, win) => actions.reload(focused(win), true)
        },
        { type: 'separator' },
        {
          label: '返回地址输入页',
          accelerator: 'Alt+Left',
          click: (_item, win) => actions.backHome(focused(win))
        },
        { type: 'separator' },
        {
          label: '开发者工具',
          accelerator: 'F12',
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
