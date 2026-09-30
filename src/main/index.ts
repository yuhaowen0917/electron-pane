import { app, BrowserWindow, ipcMain, nativeImage, session, shell } from 'electron'
import { join, resolve } from 'path'
import appIconUrl from './assets/icon.png'
import { AppConfig, isAllowedOrigin, loadConfig } from './config'
import { addHistory, clearHistory, loadHistory, removeHistory } from './history'
import { createTray } from './tray'
import { loadWindowState, saveWindowState } from './windowState'

type AppState = 'loading' | 'ready' | 'offline'

/** 应用显示名：窗口标题、托盘提示、userData 目录都取它 */
const APP_NAME = 'Pane'
/** 自定义协议默认名（可被 config.json 的 protocol 覆盖） */
const DEFAULT_PROTOCOL = 'pane'

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

/** 自定义协议名（config.json 的 protocol 字段） */
function protocolScheme(): string {
  return config?.protocol || DEFAULT_PROTOCOL
}

/**
 * 解析协议链接里的目标地址，支持三种写法：
 * - pane://open?url=<encodeURIComponent 后的完整地址>  （推荐，避免地址里的 ? & 冲突）
 * - pane://open/<地址>
 * - pane://<地址>
 */
function parseProtocolTarget(raw: string): string | null {
  const scheme = protocolScheme()
  if (!raw.toLowerCase().startsWith(`${scheme.toLowerCase()}://`)) return null

  let rest = raw.slice(scheme.length + 3)
  const lower = rest.toLowerCase()
  if (lower.startsWith('open?url=')) rest = rest.slice('open?url='.length)
  else if (lower.startsWith('open/')) rest = rest.slice('open/'.length)

  let decoded = rest
  try {
    decoded = decodeURIComponent(rest)
  } catch {
    // 未编码或含非法转义字符时按原样处理
  }
  return normalizeUrl(decoded)
}

/** 从进程参数中找出协议链接（Windows / Linux 下协议 URL 由命令行传入） */
function findProtocolTarget(argv: readonly string[]): string | null {
  for (const arg of argv) {
    const target = parseProtocolTarget(arg)
    if (target) return target
  }
  return null
}

/** 注册协议处理程序，使系统能把 pane:// 链接路由到本应用 */
function registerProtocolClient(): void {
  const scheme = protocolScheme()
  if (process.defaultApp) {
    // 开发态：electron.exe 直接运行项目，必须显式带上入口参数，
    // 否则注册的是 electron.exe 本身（不带项目路径，唤起后是空白应用）
    app.setAsDefaultProtocolClient(scheme, process.execPath, [resolve(process.argv[1] ?? '.')])
  } else {
    // 打包后：指向应用可执行文件
    app.setAsDefaultProtocolClient(scheme)
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

/** 记录为当前目标、写入历史并加载（用户输入、协议链接、历史选择都走这里） */
function openTarget(url: string): void {
  currentUrl = url
  addHistory(url)
  loadTarget()
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
 * 生成悬浮控件注入脚本。
 * 主窗口：刷新 + 返回地址输入页；子窗口：刷新 + 关闭窗口。
 * 脚本带自愈能力——页面若移除控件、或后插入同层级元素盖住控件，
 * MutationObserver 会重新挂载并把控件移回最后一位（保证绘制在最上层）。
 */
function floatingControlsScript(mode: 'main' | 'child'): string {
  const secondButton =
    mode === 'main'
      ? `mkBtn('\\u2302', '返回地址输入页 (Alt+Left)', () => {
      window.nativeShell && window.nativeShell.backHome()
    })`
      : `mkBtn('\\u2715', '关闭窗口', () => window.close())`

  return `(() => {
    const ID = 'shell-floating-controls'
    const mount = () => {
      if (document.getElementById(ID)) return
      const bar = document.createElement('div')
      bar.id = ID
      bar.style.cssText = [
        'position:fixed', 'top:10px', 'right:10px', 'z-index:2147483647',
        'display:flex', 'gap:6px', 'opacity:0.6', 'transition:opacity 0.15s',
        'user-select:none'
      ].join(';')
      bar.addEventListener('mouseenter', () => { bar.style.opacity = '1' })
      bar.addEventListener('mouseleave', () => { bar.style.opacity = '0.6' })
      const mkBtn = (label, title, onClick) => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.textContent = label
        btn.title = title
        btn.style.cssText = [
          'width:32px', 'height:32px', 'border:none', 'border-radius:50%',
          'background:rgba(15,23,42,0.78)', 'color:#fff', 'font-size:15px',
          'line-height:1', 'cursor:pointer', 'padding:0',
          'box-shadow:0 1px 4px rgba(0,0,0,0.4)',
          'outline:1px solid rgba(255,255,255,0.75)'
        ].join(';')
        btn.addEventListener('click', onClick)
        return btn
      }
      bar.appendChild(mkBtn('\\u21BB', '刷新页面 (F5)', () => location.reload()))
      bar.appendChild(${secondButton})
      document.documentElement.appendChild(bar)
    }
    mount()
    if (!window.__shellControlsObserver) {
      window.__shellControlsObserver = new MutationObserver(() => {
        const el = document.getElementById(ID)
        if (!el) { mount(); return }
        // 同层级、同 z-index 时 DOM 顺序靠后的绘制在上层，控件必须保持最后一位
        if (el !== document.documentElement.lastElementChild) {
          document.documentElement.appendChild(el)
        }
      })
      window.__shellControlsObserver.observe(document.documentElement, { childList: true })
    }
  })()`
}

function injectFloatingControls(wc: Electron.WebContents, mode: 'main' | 'child'): void {
  wc.executeJavaScript(floatingControlsScript(mode)).catch(() => {
    // 注入失败（如页面跳转中）不影响主流程
  })
}

/** 子窗口集合：主进程退出时依托 Electron 生命周期自动关闭，这里仅做引用管理 */
const childWindows = new Set<BrowserWindow>()

/** 所有窗口共用的 webPreferences（主窗口与子窗口保持同一安全基线） */
function sharedWebPreferences(): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    spellcheck: false
  }
}

/** 窗口/任务栏图标（资源被 electron-vite 内联为 data URL） */
function windowIcon(): Electron.NativeImage {
  return nativeImage.createFromDataURL(appIconUrl)
}

/** 解析 window.open 的 features 字符串里的宽高（如 "width=480,height=640"） */
function parsePopupSize(features: string): { width?: number; height?: number } {
  const size: { width?: number; height?: number } = {}
  for (const part of features.split(',')) {
    const [key, value] = part.split('=').map((piece) => piece.trim())
    const num = Number(value)
    if (!Number.isFinite(num) || num <= 0) continue
    if (key === 'width') size.width = num
    if (key === 'height') size.height = num
  }
  return size
}

/**
 * 导航治理（主窗口与子窗口共用）：
 * - 站内 / about:blank 的 window.open → 创建真正的子窗口
 * - 站外 http(s) / mailto / tel → 交系统默认浏览器
 * - 页面内导航逃逸出白名单来源 → 阻断并转系统浏览器
 */
function registerNavigationGuards(target: BrowserWindow): void {
  target.webContents.setWindowOpenHandler(({ url, features }) => {
    if (isAllowedOrigin(url, allowedOrigins()) || url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          ...parsePopupSize(features),
          minWidth: 400,
          minHeight: 300,
          show: false,
          autoHideMenuBar: true,
          icon: windowIcon(),
          webPreferences: sharedWebPreferences()
        }
      }
    }
    if (/^https?:/i.test(url) || /^(mailto|tel):/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Electron 创建子窗口后：纳入管理、就绪再显示，并同样施加导航守卫、快捷键、悬浮控件
  target.webContents.on('did-create-window', (child) => {
    childWindows.add(child)
    child.on('closed', () => childWindows.delete(child))
    child.once('ready-to-show', () => child.show())
    registerNavigationGuards(child)
    registerShortcuts(child)
    child.webContents.on('did-finish-load', () => {
      const current = child.webContents.getURL()
      if (current && isAllowedOrigin(current, allowedOrigins())) {
        injectFloatingControls(child.webContents, 'child')
      }
    })
  })

  target.webContents.on('will-navigate', (e, url) => {
    if (!isAllowedOrigin(url, allowedOrigins())) {
      e.preventDefault()
      if (/^https?:/i.test(url)) shell.openExternal(url)
    }
  })
}

/**
 * 快捷键（主窗口与子窗口共用）：
 * - Alt+Left：主窗口回地址输入页；子窗口关闭自身
 * - F12 / Ctrl+Shift+I：切换开发者工具
 * - F5 / Ctrl+R：刷新当前窗口
 */
function registerShortcuts(target: BrowserWindow): void {
  target.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    if (input.alt && input.key === 'ArrowLeft') {
      // 主窗口已经停在地址输入页时无需处理
      if (target === win && localPage === 'home') return
      e.preventDefault()
      if (target !== win) target.close()
      else backToHome()
    } else if (input.key === 'F12' || (input.control && input.shift && key === 'i')) {
      e.preventDefault()
      target.webContents.toggleDevTools()
    } else if (input.key === 'F5' || (input.control && key === 'r')) {
      e.preventDefault()
      target.webContents.reload()
    }
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
      injectFloatingControls(target.webContents, 'main')
    }
  })

  registerNavigationGuards(target)
  registerShortcuts(target)

  // 关闭行为：隐藏到托盘（可配置）
  target.on('close', (e) => {
    saveWindowState(target)
    if (!quitting && config.closeToTray) {
      e.preventDefault()
      target.hide()
    }
  })
}

function createWindow(autoLoad: boolean): void {
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
    icon: windowIcon(),
    webPreferences: sharedWebPreferences()
  })

  win = newWin
  if (state.maximized) newWin.maximize()
  newWin.once('ready-to-show', () => newWin.show())
  registerWindowEvents(newWin)
  if (autoLoad) {
    // 由 pane:// 链接唤起：跳过地址输入页，直接加载链接里的目标地址
    loadTarget()
  } else {
    // 正常启动：先停留在本地地址输入页，由用户确认后再加载远程 URL
    showLocalPage('home').catch(() => {})
  }
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
    openTarget(normalized)
    return true
  })
  // 返回地址输入页（子窗口调用时关闭自身）
  ipcMain.handle('shell:back-home', (event) => {
    const sender = BrowserWindow.fromWebContents(event.sender)
    if (sender && sender !== win) {
      sender.close()
      return
    }
    backToHome()
  })
  // 历史地址：查看 / 删除单条 / 清空
  ipcMain.handle('shell:list-history', () => loadHistory())
  ipcMain.handle('shell:remove-history', (_e, url: unknown) =>
    removeHistory(typeof url === 'string' ? url : '')
  )
  ipcMain.handle('shell:clear-history', () => clearHistory())
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
  // 单实例锁：二次启动唤起已有窗口；若由 pane:// 链接唤起则顺带加载链接里的地址
  app.on('second-instance', (_event, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    const target = findProtocolTarget(argv)
    if (target) openTarget(target)
  })

  // macOS 下协议链接通过 open-url 事件送达（Windows/Linux 走命令行参数）
  app.on('open-url', (event, url) => {
    event.preventDefault()
    const target = parseProtocolTarget(url)
    if (!target) return
    win?.show()
    openTarget(target)
  })

  app.whenReady().then(() => {
    // 必须先定应用名再读配置：userData 目录（配置覆盖、窗口状态、历史记录）都依赖它
    app.setName(APP_NAME)
    config = loadConfig()
    registerProtocolClient()
    // 冷启动时若带着协议链接，直接加载其中的地址（跳过地址输入页）
    const protocolTarget = findProtocolTarget(process.argv)
    currentUrl = protocolTarget ?? config.url
    if (protocolTarget) addHistory(protocolTarget)

    registerPermissions()
    registerIpc()
    createWindow(Boolean(protocolTarget))
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
