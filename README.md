# Electron + Vite + Vue3 伪桌面应用壳子

按《Electron 壳子设计方案》实现的 M1 + M2 阶段：配置驱动加载远程 URL、本地 loading/离线页、托盘、窗口记忆、外链拦截。

## 目录结构

```
electron-vue3-app/
├── electron.vite.config.ts   # electron-vite 配置（main / preload / renderer 三段）
├── electron-builder.yml      # 打包配置（NSIS + 图标 + extraResources）
├── config.json               # 壳子默认配置（URL、窗口尺寸、行为开关）
├── scripts/gen_icons.py      # 图标生成脚本（纯标准库，可重新生成）
├── src/
│   ├── main/                 # 主进程
│   │   ├── index.ts          # 窗口/生命周期/事件/IPC/权限白名单
│   │   ├── config.ts         # 配置加载（默认 → resources → exe 同目录 → userData）
│   │   ├── windowState.ts    # 窗口尺寸/位置记忆
│   │   ├── tray.ts           # 系统托盘
│   │   └── assets/tray.png   # 托盘图标
│   ├── preload/              # contextBridge 白名单桥（window.nativeShell）
│   └── renderer/             # Vue3 渲染层：loading / offline 两态页面
└── build/                    # 打包图标（icon.ico / icon.png）
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式（热更新） |
| `npm run build` | 构建产物到 out/ |
| `npm run dist` | 构建 + 打 NSIS 安装包（release/） |
| `npm run typecheck` | 主进程/渲染层 TS 类型检查 |

## 已实现能力（M1 + M2）

- **配置驱动 URL**：改 `config.json` 的 `url` 即可指向任意 Web 应用；生产环境支持三级覆盖（resources 目录 → exe 同目录 → userData）
- **启动体验**：先渲染本地 loading 页（旋转指示器），远程页面提交后自动切换；`ready-to-show` 防白屏
- **离线兜底**：主框架加载失败自动切本地离线页，显示错误码 + 「重新加载」按钮（IPC 触发重试）
- **窗口管理**：单实例锁（二次启动唤起已有窗口）、尺寸/位置记忆（含最大化状态、多屏越界校验）
- **托盘**：右键菜单（显示主窗口/退出）、双击唤起、点 X 隐藏到托盘（`closeToTray` 可关）
- **导航治理**：站外链接/新窗口一律交系统浏览器；`will-navigate` 防导航逃逸；权限白名单（notifications 等）
- **安全基线**：`contextIsolation: true`、`nodeIntegration: false`，渲染进程只能通过 `window.nativeShell` 白名单桥访问原生能力

## 改 URL 的方式

开发/演示：直接改项目根目录 `config.json` 的 `url` 字段（或建 `config.local.json`，git 可忽略）。

打包后：安装目录 `resources/config.json` 或 exe 同目录放一份 `config.json` 即可覆盖，壳子不用重新打包。

## 下一步（M3 / M4）

- M3 能力桥：按需扩展 preload 暴露桌面通知、文件对话框、剪贴板、开机自启
- M4 发布链路：`npm run dist` 打 NSIS 包；接入 electron-updater 自动更新与 electron-log 日志
