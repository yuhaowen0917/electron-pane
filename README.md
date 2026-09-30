# Pane（窗格）

一扇「窗格」——把 Web 应用装进原生窗口的那层玻璃。英文名简短好记，中文名「窗格」直接点出「壳」的本质，也和 Electron（电子）的极客气质相配。

按《Electron 壳子设计方案》实现：配置驱动加载远程 URL、地址输入页与历史记录、本地 loading/离线页、托盘、窗口记忆、导航治理、`pane://` 协议唤起。

## Logo

靛蓝渐变的 squircle 底（`#4F46E5` → `#1E1B4B`，左上带柔光），前景是三层叠起的玻璃窗格：最前面一张白色窗口卡片，带 macOS 红绿灯标题栏和模拟的正文内容线；身后两张半透明卡片渐次右上偏移、隐没——寓意「网页套进桌面壳，层层封装」。

矢量源文件在 `src/renderer/src/assets/logo.svg`，图标源图在 `build/icon-source.png`。

## 目录结构

```
pane/
├── electron.vite.config.ts   # electron-vite 配置（main / preload / renderer 三段）
├── electron-builder.yml      # 打包配置（NSIS + 图标 + extraResources）
├── config.json               # 壳子默认配置（URL、协议名、窗口尺寸、行为开关）
├── scripts/make_icons.ps1    # 图标生成脚本（源图 → 各尺寸图标）
├── src/
│   ├── main/                 # 主进程
│   │   ├── index.ts          # 窗口/生命周期/事件/IPC/权限白名单
│   │   ├── config.ts         # 配置加载（默认 → resources → exe 同目录 → userData）
│   │   ├── windowState.ts    # 窗口尺寸/位置记忆
│   │   ├── tray.ts           # 系统托盘
│   │   └── assets/           # 运行时图标（icon.png 窗口 / tray.png 托盘）
│   ├── preload/              # contextBridge 白名单桥（window.nativeShell）
│   └── renderer/             # Vue3 渲染层：地址输入 / loading / offline 页面
│       └── src/assets/logo.svg   # 界面 logo（地址输入页、加载页）
└── build/                    # 打包资源（icon-source.png 源图、icon.ico / icon.png）
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式（热更新） |
| `npm run build` | 构建产物到 out/ |
| `npm run dist` | 构建 + 打 NSIS 安装包（release/） |
| `npm run typecheck` | 主进程/渲染层 TS 类型检查 |

## 图标与 Logo

| 文件 | 用途 |
|------|------|
| `build/icon-source.png` | 设计源图（1024×1024），所有图标的来源 |
| `build/icon.ico` | Windows 打包图标（16/32/48/64/128/256 多尺寸） |
| `build/icon.png` | 非 Windows 平台打包图标（256） |
| `src/main/assets/icon.png` | 运行时窗口 / 任务栏图标（256） |
| `src/main/assets/tray.png` | 系统托盘图标（32） |
| `src/renderer/src/assets/logo.svg` | 界面 logo（地址输入页、加载页） |

替换图标：用新的方形源图覆盖 `build/icon-source.png`，然后执行

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make_icons.ps1
```

脚本基于 System.Drawing 做高质量缩放，并把 6 个尺寸以 PNG 载荷写入 `icon.ico`（Vista 及以上支持）。界面 logo 直接替换 `src/renderer/src/assets/logo.svg` 即可，Vite 会把它内联进渲染层产物。

## 已实现能力（M1 + M2）

- **配置驱动 URL**：改 `config.json` 的 `url` 即可指向任意 Web 应用；生产环境支持三级覆盖（resources 目录 → exe 同目录 → userData）
- **启动体验**：先渲染本地 loading 页（旋转指示器），远程页面提交后自动切换；`ready-to-show` 防白屏
- **离线兜底**：主框架加载失败自动切本地离线页，显示错误码 + 「重新加载」按钮（IPC 触发重试）
- **窗口管理**：单实例锁（二次启动唤起已有窗口）、尺寸/位置记忆（含最大化状态、多屏越界校验）
- **托盘**：右键菜单（显示主窗口/退出）、双击唤起、点 X 隐藏到托盘（`closeToTray` 可关）
- **导航治理**：站内链接（含同一主域的子域，如 `app.example.com` ↔ `sso.example.com`）在应用内开新窗口；跨主域链接交系统浏览器；`will-navigate` 防导航逃逸；权限白名单（notifications 等）。判定要求协议与端口一致，`co.uk` 这类二级后缀已做归并处理
- **悬浮控件**：远程页面右上角注入刷新 / 返回按钮（主窗口为「返回地址输入页」，子窗口为「关闭窗口」）；带自愈能力——被页面移除或被高 z-index 顶栏、原生模态框、全屏遮罩遮挡时，自动复位到最上层（模态框/全屏场景会挂进其顶层元素内部）
- **顶部菜单栏**：窗口原生菜单「导航」提供刷新页面（`F5`）、强制刷新（`Ctrl+Shift+R`）、返回地址输入页（`Alt+←`）、开发者工具（`F12`）；另有「编辑」「窗口」菜单。原生层入口，不受页面遮挡影响
- **快捷键**：除菜单快捷键外，页面内还支持 `Ctrl+R` 刷新、`Ctrl+Shift+I` 开发者工具；`Alt+←` 在子窗口中等价于关闭该子窗口
- **安全基线**：`contextIsolation: true`、`nodeIntegration: false`，渲染进程只能通过 `window.nativeShell` 白名单桥访问原生能力

## 改 URL 的方式

日常使用：应用启动后停在本地「地址输入页」，输入地址点「打开」即可跳转；`Alt+←` 或远程页右上角悬浮按钮可回到输入页换地址。

输入框内可一键清空（右侧 ✕ 或按 `Esc`）；下方「历史记录」列出最近打开过的地址，点条目直接打开，可单条删除（✕）或「清空全部」。历史最多保留 20 条，存于 `%APPDATA%/<应用名>/url-history.json`。

开发/演示：直接改项目根目录 `config.json` 的 `url` 字段（或建 `config.local.json`，git 可忽略）作为输入页的预填默认值。

打包后：安装目录 `resources/config.json` 或 exe 同目录放一份 `config.json` 即可覆盖，壳子不用重新打包。

## 用链接直接唤起应用本体（自定义协议）

Pane 注册了 `pane://` 协议（协议名由 `config.json` 的 `protocol` 字段控制），可以在浏览器、文档或「运行」窗口里用链接直接打开桌面应用并指定加载地址：

| 写法 | 说明 |
|------|------|
| `pane://open?url=https%3A%2F%2Fexample.com` | 推荐：地址需 `encodeURIComponent`，避免 `?` `&` 被解析成协议参数 |
| `pane://open/example.com` | 路径写法，地址可省略协议（自动补 `http://`） |
| `pane://example.com` | 最简写法 |

行为：

- 应用**未启动** → 冷启动并直接加载链接里的地址（跳过地址输入页）
- 应用**已启动** → 单实例锁唤起已有窗口，并切换到链接里的地址
- 非 http(s) 协议、或地址非法的链接会被忽略，应用不做任何跳转

注册方式：

- 开发态：主进程启动时调用 `setAsDefaultProtocolClient`，写入 `HKCU\Software\Classes\pane`，命令行形如 `electron.exe "<项目路径>" "%1"`
- 打包后：由 `electron-builder.yml` 的 `protocols` 在安装时注册到系统
- 移除注册（开发态）：`reg delete HKCU\Software\Classes\pane /f`

## 下一步（M3 / M4）

- M3 能力桥：按需扩展 preload 暴露桌面通知、文件对话框、剪贴板、开机自启
- M4 发布链路：`npm run dist` 打 NSIS 包；接入 electron-updater 自动更新与 electron-log 日志
