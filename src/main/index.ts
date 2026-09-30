import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { join } from 'path'
import { AppConfig, isAllowedOrigin, loadConfig } from './config'
import { createTray } from './tray'
import { loadWindowState, saveWindowState } from './windowState'

type AppState = 'loading' | 'ready' | 'offline'

let win: BrowserWindow | null = null
let quitting = false
let appState: AppState = 'loading'
let lastError: string | null = null
let config: AppConfig
/** 当前目标地址：初始为 config.url，可由用户在地址输入页修改 */
let currentUrl = ''
/** 当前本地页视图：home = 地址输入页；null = 显示远程页面 */
let localPage: LocalPageState | null = 'home'

/** 本地壳子页面状态：home = 地址输入页 */
type LocalPageState = AppState | 'home'

/** 补全协议：无 scheme 时默认按 http 处理（局域网地址常见形态） */
function normalizeUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

/** 加载本地壳子页面（home / loading / offline 由渲染层按状态渲染） */
function showLocalPage(state: LocalPageState): Promise<void> {
  if (!win) return Promise.resolve()
  localPage = state
  if (state !== 'home') appState = state
  const hash = state
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) return win.loadURL(`${devUrl}/#${hash}`)
  return win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
}

/** 加载远程 Web 应用（不 await：本地 loading 页会一直显示到远程页面提交） */
function loadTarget(): void {
  if (!win || !currentUrl) return
  localPage = null
  appState = 'loading'
  lastError = null
  win.loadURL(currentUrl).catch(() => {
    // 失败会走 did-fail-load，这里只吞掉 unhandled rejection
  })
}

/** 允许导航的来源列表：当前目标地址 + 配置的额外白名单 */
function allowedOrigins(): string[] {
  return [currentUrl, ...config.originAllowList]
}

/** 返回地址输入页（中断进行中的加载，保留 currentUrl 供下次重试/预填） */
function backToHome(): void {
  if (!win) return
  win.webContents.stop()
  showLocalPage('home').catch(() => {})
}

/**
 * 向远程页面注入右上角悬浮控制按钮（刷新 / 返回地址页）
 * executeJavaScript 走 devtools 通道执行，不受页面 CSP 限制；
 * 按钮通过 preload 暴露的 nativeShell 调用壳子能力。
 */
function injectFloatingControls(wc: Electron.WebContents): void {
  const script = `(() => {
    const ID = 'shell-floating-controls'
    if (document.getElementById(ID)) return
    const bar = document.createElement('div')
    bar.id = ID
    bar.style.cssText = [
      'position:fixed', 'top:10px', 'right:10px', 'z-index:2147483647',
      'display:flex', 'gap:6px', 'opacity:0.35', 'transition:opacity 0.2s',
      'user-select:none'
    ].join(';')
    bar.addEventListener('mouseenter', () => { bar.style.opacity = '1' })
    bar.addEventListener('mouseleave', () => { bar.style.opacity = '0.35' })
    const mkBtn = (label, title, onClick) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = label
      btn.title = title
      btn.style.cssText = [
        'width:32px', 'height:32px', 'border:none', 'border-radius:50%',
        'background:rgba(15,23,42,0.65)', 'color:#fff', 'font-size:15px',
        'line-height:1', 'cursor:pointer', 'padding:0'
      ].join(';')
      btn.addEventListener('click', onClick)
      return btn
    }
    bar.appendChild(mkBtn('\\u21BB', '刷新页面 (F5)', () => location.reload()))
    bar.appendChild(mkBtn('\\u2302', '返回地址输入页 (Alt+Left)', () => {
      window.nativeShell && window.nativeShell.backHome()
    }))
    document.documentElement.appendChild(bar)
  })()`
  wc.executeJavaScript(script).catch(() => {
    // 注入失败（如页面跳转中）不影响主流程
  })
}

function registerWindowEvents(target: BrowserWindow): void {
  // 主框架加载失败 → 切到本地离线页（-3 是主动中断，忽略）
  target.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      lastError = `错误码 ${code}：${desc}`
      showLocalPage('offline').catch(() => {})
    }
  })

  // 远程页面加载成功
  target.webContents.on('did-finish-load', () => {
    const current = target.webContents.getURL()
    if (current && isAllowedOrigin(current, allowedOrigins())) {
      appState = 'ready'
      lastError = null
      injectFloatingControls(target.webContents)
    }
  })

  // 站内新窗口 → 主窗口内打开；站外链接 → 系统默认浏览器
  target.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedOrigin(url, allowedOrigins())) {
      loadTarget()
    } else if (/^https?:/i.test(url)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // 阻止页面内导航逃逸出允许的来源
  target.webContents.on('will-navigate', (e, url) => {
    if (!isAllowedOrigin(url, allowedOrigins())) {
      e.preventDefault()
      if (/^https?:/i.test(url)) shell.openExternal(url)
    }
  })

  // 快捷键：Alt+Left 返回地址页；F12 / Ctrl+Shift+I 切换开发者工具；F5 / Ctrl+R 刷新
  target.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    if (input.alt && input.key === 'ArrowLeft' && localPage !== 'home') {
      e.preventDefault()
      backToHome()
    } else if (input.key === 'F12' || (input.control && input.shift && key === 'i')) {
      e.preventDefault()
      target.webContents.toggleDevTools()
    } else if (input.key === 'F5' || (input.control && key === 'r')) {
      e.preventDefault()
      target.webContents.reload()
    }
  })

  // 关闭行为：隐藏到托盘（可配置）
  target.on('close', (e) => {
    saveWindowState(target)
    if (!quitting && config.closeToTray) {
      e.preventDefault()
      target.hide()
    }
  })
}

function createWindow(): void {
  const state = loadWindowState()
  const newWin = new BrowserWindow({
    width: state.width ?? config.width,
    height: state.height ?? config.height,
    x: state.x,
    y: state.y,
    minWidth: config.minWidth,
    minHeight: config.minHeight,
    show: false,
    autoHideMenuBar: true,
    title: app.getName(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  win = newWin
  if (state.maximized) newWin.maximize()
  newWin.once('ready-to-show', () => newWin.show())
  registerWindowEvents(newWin)
  // 启动先停留在本地地址输入页，由用户确认后再加载远程 URL
  showLocalPage('home').catch(() => {})
}

function registerIpc(): void {
  ipcMain.handle('shell:get-state', () => ({
    state: appState,
    url: currentUrl,
    lastError
  }))
  ipcMain.handle('shell:retry-load', () => {
    if (win) loadTarget()
  })
  // 地址输入页确认跳转：校验 → 记录为当前目标 → 加载
  ipcMain.handle('shell:open-url', (_e, input: unknown) => {
    const normalized = normalizeUrl(typeof input === 'string' ? input : '')
    if (!normalized) return false
    currentUrl = normalized
    loadTarget()
    return true
  })
  // 返回地址输入页
  ipcMain.handle('shell:back-home', () => {
    backToHome()
  })
}

function registerPermissions(): void {
  // 权限白名单：按需放行，其余默认拒绝
  const allowList = new Set(['notifications', 'clipboard-sanitized-write'])
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowList.has(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowList.has(permission))
}

function quitApp(): void {
  quitting = true
  app.quit()
}

function bootstrap(): void {
  // 单实例锁：二次启动唤起已有窗口
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    config = loadConfig()
    currentUrl = config.url
    app.setName('ElectronApp')

    registerPermissions()
    registerIpc()
    createWindow()
    createTray(
      () => {
        win?.show()
        win?.focus()
      },
      quitApp
    )
  })

  app.on('before-quit', () => {
    quitting = true
    if (win) saveWindowState(win)
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('activate', () => {
    win?.show()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  bootstrap()
}
