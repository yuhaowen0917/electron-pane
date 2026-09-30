import { app, Menu, Tray, nativeImage } from 'electron'
import { join } from 'path'
import trayIconUrl from './assets/tray.png'

let tray: Tray | null = null

export function createTray(showMainWindow: () => void, quitApp: () => void): Tray {
  const icon = nativeImage.createFromDataURL(trayIconUrl)
  tray = new Tray(icon)
  tray.setToolTip(app.getName())
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: showMainWindow },
      { type: 'separator' },
      { label: '退出', click: quitApp }
    ])
  )
  tray.on('double-click', showMainWindow)
  return tray
}
