# Electron 伪桌面应用壳子 —— 设计方案

## 1. 目标与定位

用 Electron 做一个极简"壳"，加载指定 URL 的 Web 应用，让它像原生桌面软件一样运行。

核心原则：

- **壳子不含业务逻辑**：只负责窗口、托盘、更新、安全、少量系统能力桥接
- **配置驱动**：URL、窗口行为全部走 config.json，换环境改配置不改代码
- **Web 端改版零发版**：业务迭代全在服务端，壳子只在升级 Electron 或新增桥能力时才发版

## 2. 总体架构

见会话中的架构图。链路：双击 exe → 主进程创建窗口 → loadURL 远程 Web → preload 桥（可选）暴露原生能力。

## 3. 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 框架 | Electron（锁定精确稳定版） | 生态成熟，BrowserWindow.loadURL 开箱即用 |
| 语言 | TypeScript + 原生 JS | 壳子无 UI 复杂度，不需要引入 Vue/React |
| 打包 | electron-builder | NSIS/dmg 一站式，配置简单 |
| 更新 | electron-updater | 与 builder 同族，支持静态文件服务器通道 |
| 窗口状态 | electron-window-state | 记住尺寸/位置，少造轮子 |
| 日志 | electron-log | 主/渲染进程统一落盘 |

## 4. 目录结构

```
shell/
├── src/
│   ├── main.ts          # 主进程：窗口/托盘/更新/生命周期
│   ├── preload.ts       # contextBridge 白名单桥（可选）
│   └── config.ts        # 读取并校验 config.json
├── renderer/
│   ├── loading.html     # 启动 loading 页（避免白屏）
│   └── offline.html     # 断网/加载失败页（含重试按钮）
├── build/               # 图标、安装包资源
├── config.json          # url / devUrl / 窗口参数 / 行为开关
└── package.json         # 含 electron-builder 配置
```

## 5. 核心模块设计

### 5.1 配置驱动（config.json）

```json
{
  "url": "https://your-app.example.com",
  "devUrl": "http://192.168.1.100:5173",
  "window": { "width": 1280, "height": 800, "minWidth": 960, "minHeight": 600 },
  "behavior": { "closeToTray": true, "autoUpdate": true, "devtools": false }
}
```

支持环境变量覆盖（如 `SHELL_URL`），dev/staging/prod 只换配置。

### 5.2 窗口管理

- **单实例锁** `app.requestSingleInstanceLock()`：二次双击唤起已有窗口而非再开一个
- **窗口记忆**：electron-window-state 恢复上次尺寸/位置
- **防白屏**：先隐藏窗口，`ready-to-show` 再显示；启动期显示本地 loading.html
- **关闭行为**：点 X → 隐藏到托盘（`closeToTray` 可关）；托盘菜单里提供真正退出

### 5.3 系统托盘

托盘图标 + 右键菜单（显示主窗口 / 退出），可选关闭时气泡提示"已最小化到托盘"。

### 5.4 导航与外链治理（重点）

- `setWindowOpenHandler`：拦截 `window.open` / `target=_blank`——站内地址允许，外部 http(s) 交给系统默认浏览器（`shell.openExternal`）
- `will-navigate`：阻止页面导航逃逸到非配置域名
- 权限白名单：`setPermissionRequestHandler` 只放行 notifications、clipboard 等按需权限
- 下载行为：`will-download` 统一转给系统下载或指定目录

### 5.5 preload 桥（可选，按需启用）

```ts
contextBridge.exposeInMainWorld('nativeShell', {
  notify: (title: string, body: string) => ipcRenderer.invoke('notify', { title, body }),
  pickFile: () => ipcRenderer.invoke('pick-file'),
})
```

- 白名单暴露：桌面通知、文件对话框、剪贴板、开机自启，逐个开关
- Web 端用 `window.nativeShell?.notify(...)` 特性检测——**同一套代码在纯浏览器里也能跑**，与 PWA demo 完全兼容

### 5.6 安全策略

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`
- 生产环境禁用 devtools（behavior.devtools 控制）
- URL 白名单：只允许导航到配置的源
- 远程页面的 CSP、登录态、cookie 由 Web 端自理，壳子不碰业务会话

### 5.7 加载与离线体验

- 启动：本地 loading.html → `did-finish-load` 切换到远程页
- 失败：`did-fail-load` → offline.html（错误码 + 手动重试按钮）
- 可选：监听网络恢复自动 reload

### 5.8 自动更新与日志

- electron-updater：静态文件服务器通道（放一个 latest.yml + 安装包即可），启动后台静默检查，下载完提示重启
- electron-log 记录主进程崩溃、渲染进程 crash、加载失败，方便区分"壳子问题还是 Web 问题"

## 6. 打包与分发

electron-builder：Windows 用 NSIS（可选自定义安装目录），配置 appId / productName / 图标；后续可扩展 mac dmg。内网分发可暂不做代码签名（注意 SmartScreen 提示），对外分发建议购买签名证书。

## 7. 与现有项目的衔接

- **短期**：url 指向 WMS PWA demo 的部署地址（局域网或静态托管即可验证）
- **长期**：NestJS 后端上线后指向正式 Web 端，壳子零改动
- PWA 在 Electron（Chromium）内 service worker 正常工作，两套载体可并行

## 8. 实施里程碑

| 阶段 | 内容 | 产出 |
|---|---|---|
| M1 最小壳 | 窗口 + loadURL + loading 页 + 单实例锁 | 可运行的 exe |
| M2 体验完善 | 托盘、窗口记忆、外链拦截、离线页 | 日常可用 |
| M3 能力桥 | preload IPC：通知/文件等按需启用 | Web 端可调用系统能力 |
| M4 发布 | electron-builder 打包 + electron-updater + 日志 | 可分发安装包 |

## 9. 主进程骨架（关键代码）

```ts
import { app, BrowserWindow, Tray, Menu, shell } from 'electron'
import path from 'path'
import { loadConfig } from './config'

const CONFIG = loadConfig()
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let win: BrowserWindow | null = null
let tray: Tray | null = null

function createWindow() {
  win = new BrowserWindow({
    ...CONFIG.window,
    show: false,
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win!.show())
  win.loadURL(process.env.SHELL_URL ?? CONFIG.url)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(CONFIG.url)) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(CONFIG.url)) e.preventDefault()
  })

  win.webContents.on('did-fail-load', (_e, _c, _d, _u, isMain) => {
    if (isMain) win!.loadFile('../renderer/offline.html')
  })

  win.on('close', (e) => {
    if (CONFIG.behavior.closeToTray && !(app as any).isQuiting) {
      e.preventDefault()
      win!.hide()
    }
  })
}

app.whenReady().then(() => {
  createWindow()
  tray = new Tray(path.join(__dirname, '../build/tray.png'))
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { win!.show() } },
    { label: '退出', click: () => { (app as any).isQuiting = true; app.quit() } },
  ]))
})

app.on('second-instance', () => { if (win) { win.show(); win.focus() } })
```
