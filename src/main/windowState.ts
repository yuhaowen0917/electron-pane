import { app, screen, Rectangle, BrowserWindow } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

interface WindowState extends Partial<Rectangle> {
  maximized?: boolean
}

const stateFile = (): string => join(app.getPath('userData'), 'window-state.json')

/** 读取上次窗口状态，并校验仍落在可见屏幕内 */
export function loadWindowState(): WindowState {
  try {
    const file = stateFile()
    if (!existsSync(file)) return {}
    const state = JSON.parse(readFileSync(file, 'utf-8')) as WindowState

    if (typeof state.x === 'number' && typeof state.y === 'number') {
      const visible = screen.getAllDisplays().some((display) => {
        const { x, y, width, height } = display.workArea
        return state.x! >= x - 40 && state.x! < x + width && state.y! >= y - 40 && state.y! < y + height
      })
      if (!visible) {
        return { width: state.width, height: state.height, maximized: state.maximized }
      }
    }
    return state
  } catch {
    return {}
  }
}

export function saveWindowState(win: BrowserWindow): void {
  try {
    const state: WindowState = win.isMaximized()
      ? { ...loadWindowState(), maximized: true }
      : { ...win.getBounds(), maximized: false }
    writeFileSync(stateFile(), JSON.stringify(state, null, 2), 'utf-8')
  } catch {
    // 状态保存失败不影响主流程
  }
}
