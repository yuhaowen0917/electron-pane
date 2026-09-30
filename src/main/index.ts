import { app, BrowserWindow, ipcMain, nativeImage, nativeTheme, session, shell } from 'electron'
import { join, resolve } from 'path'
import appIconUrl from './assets/icon.png'
import menuDevtoolsDark from './assets/menu/devtools-dark.png'
import menuDevtoolsLight from './assets/menu/devtools-light.png'
import menuHomeDark from './assets/menu/home-dark.png'
import menuHomeLight from './assets/menu/home-light.png'
import menuRefreshDark from './assets/menu/refresh-dark.png'
import menuRefreshLight from './assets/menu/refresh-light.png'
import { AppConfig, isAllowedOrigin, loadConfig } from './config'
import { addHistory, clearHistory, loadHistory, removeHistory } from './history'
import { createAppMenu, MenuActions, MenuIconName } from './menu'
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
 *
 * 按钮：主窗口为「刷新 + 返回地址输入页」，子窗口为「刷新 + 关闭窗口」。
 *
 * 层级策略（保证控件永远在最上层、不被页面遮挡）：
 * 1. 常态下挂在 documentElement 末尾 + z-index 拉满 —— 同层级时 DOM 靠后者绘制在上层；
 * 2. 页面出现原生 dialog 模态框或全屏元素时，改挂到这些「顶层元素」内部 ——
 *    它们位于浏览器 top layer，任何 z-index 都压不过，只有作为其子节点才能一起渲染在顶层；
 * 3. MutationObserver 负责控件被移除 / 被同层元素插队时自动复位，定时器负责深层变化兜底。
 */
function floatingControlsScript(mode: 'main' | 'child', expectedOrigin: string): string {
  const secondButton =
    mode === 'main'
      ? `mkBtn('\\u2302', '返回地址输入页 (Alt+Left)', () => {
      window.nativeShell && window.nativeShell.backHome()
    })`
      : `mkBtn('\\u2715', '关闭窗口', () => window.close())`

  return `(() => {
    const ID = 'shell-floating-controls'
    // executeJavaScript 是异步的，排队期间页面可能已经跳转：
    // 若当前文档不是预期来源（例如已切到本地 loading/offline 页），直接跳过，避免把控件注到错误的页面上
    if (location.origin !== ${JSON.stringify(expectedOrigin)}) return 'SKIP:' + location.origin
    // 控件应挂载的宿主：全屏元素 / 原生 dialog 模态框都位于浏览器顶层，
    // 任何 z-index 都压不过它们，只有作为它们的子节点才能一起渲染在顶层，且排在最后（最上）
    const hostOf = () =>
      document.fullscreenElement || document.querySelector('dialog[open]') || document.documentElement
    const place = () => {
      const el = document.getElementById(ID)
      if (!el) return
      const host = hostOf()
      if (el.parentElement !== host || el !== host.lastElementChild) host.appendChild(el)
    }
    const mount = () => {
      if (document.getElementById(ID)) { place(); return }
      const bar = document.createElement('div')
      bar.id = ID
      bar.style.cssText = [
        'position:fixed', 'inset:auto', 'margin:0', 'border:0', 'padding:0',
        'background:transparent', 'overflow:visible', 'width:auto', 'height:auto',
        'top:10px', 'right:10px', 'z-index:2147483647', 'display:flex', 'gap:6px',
        'opacity:0.6', 'transition:opacity 0.15s', 'user-select:none'
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
      const host = hostOf()
      host.appendChild(bar)
      // 模态框关闭后宿主会隐藏，立即把控件挂回文档根，避免被一起隐藏
      if (host instanceof HTMLDialogElement) host.addEventListener('close', () => place())
    }
    const watchTopLayer = () => {
      if (window.__shellHostWatcher) return
      document.addEventListener('fullscreenchange', () => place(), true)
      window.__shellHostWatcher = setInterval(place, 600)
    }
    mount()
    watchTopLayer()
    if (!window.__shellControlsObserver) {
      window.__shellControlsObserver = new MutationObserver(() => {
        const el = document.getElementById(ID)
        if (!el) { mount(); return }
        place()
      })
      // 只监听根节点的直接子节点变化（开销极小）；模态框/全屏等深层变化由 600ms 的定时器兜底
      window.__shellControlsObserver.observe(document.documentElement, { childList: true })
    }
  })()`
}

function injectFloatingControls(wc: Electron.WebContents, mode: 'main' | 'child'): void {
  // 以调用时刻的文档来源为准，注入前在页面内二次校验，避免竞态注错页面
  let expectedOrigin = ''
  try {
    expectedOrigin = new URL(wc.getURL()).origin
  } catch {
    return
  }
  wc.executeJavaScript(floatingControlsScript(mode, expectedOrigin)).catch(() => {
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

/** 菜单项图标：浅色主题用深灰描边、深色主题用浅灰描边，由脚本生成两套 */
const MENU_ICONS: Record<'light' | 'dark', Record<MenuIconName, string>> = {
  light: { refresh: menuRefreshLight, home: menuHomeLight, devtools: menuDevtoolsLight },
  dark: { refresh: menuRefreshDark, home: menuHomeDark, devtools: menuDevtoolsDark }
}

function menuIcon(name: MenuIconName): Electron.NativeImage {
  const set = nativeTheme.shouldUseDarkColors ? MENU_ICONS.dark : MENU_ICONS.light
  return nativeImage.createFromDataURL(set[name])
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
          autoHideMenuBar: false,
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

/** 菜单动作：刷新指定窗口（ignoreCache = 强制刷新，忽略缓存） */
function reloadWindow(target: BrowserWindow | null, ignoreCache = false): void {
  if (!target || target.isDestroyed()) return
  if (ignoreCache) target.webContents.reloadIgnoringCache()
  else target.webContents.reload()
}

/** 菜单动作：返回地址输入页（从子窗口触发则关闭该子窗口） */
function backHomeFrom(target: BrowserWindow | null): void {
  if (target && target !== win && !target.isDestroyed()) {
    target.close()
    return
  }
  if (localPage === 'home') return
  backToHome()
}

/** 菜单动作：切换开发者工具 */
function toggleDevToolsFrom(target: BrowserWindow | null): void {
  if (!target || target.isDestroyed()) return
  target.webContents.toggleDevTools()
}

const menuActions: MenuActions = {
  reload: reloadWindow,
  backHome: backHomeFrom,
  toggleDevTools: toggleDevToolsFrom,
  icon: menuIcon
}

/** 建菜单，并跟随系统深浅色主题变化重建以切换图标配色 */
function setupAppMenu(): void {
  createAppMenu(menuActions)
  nativeTheme.on('updated', () => createAppMenu(menuActions))
}

/**
 * 补充快捷键。
 * 主快捷键走菜单（见 menu.ts）：F5 刷新、Ctrl+Shift+R 强制刷新、Alt+Left 返回地址页、F12 开发者工具。
 * 这里只处理菜单未覆盖的组合键，避免与菜单加速度重复触发。
 */
function registerShortcuts(target: BrowserWindow): void {
  target.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !input.control) return
    const key = input.key.toLowerCase()
    if (input.shift && key === 'i') {
      e.preventDefault()
      target.webContents.toggleDevTools()
    } else if (!input.shift && key === 'r') {
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
    // 站点重定向（补 www、http→https、跳路径）会落到另一个 origin，
    // 若不接管最终地址，导航白名单与悬浮控件注入都会以旧地址为基准而失效
    if (localPage === null && /^https?:/i.test(current) && current !== currentUrl) {
      currentUrl = current
      addHistory(current)
    }
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
    // 顶部常显原生菜单栏（刷新 / 返回地址输入页等）
    autoHideMenuBar: false,
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
    // 顶部菜单栏：刷新 / 首页等入口（原生层，不受页面遮挡影响）
    setupAppMenu()
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
