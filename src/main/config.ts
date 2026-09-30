import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import defaultConfig from '../../config.json'

export interface AppConfig {
  /** 远程 Web 应用地址（壳子加载的 URL） */
  url: string
  width: number
  height: number
  minWidth: number
  minHeight: number
  /** 点击关闭按钮时是否隐藏到托盘（false = 直接退出） */
  closeToTray: boolean
  /** 额外允许的导航来源（除 config.url 的 origin 外） */
  originAllowList: string[]
}

/**
 * 配置加载优先级（后者覆盖前者）：
 * 1. 打包进应用的默认 config.json
 * 2. 便携模式：exe 同目录下的 config.json（生产环境）
 * 3. 用户配置：%APPDATA%/<appName>/config.json
 */
export function loadConfig(): AppConfig {
  const tryRead = (file: string): Record<string, unknown> | null => {
    try {
      if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf-8'))
    } catch {
      // 配置文件损坏时静默忽略，回落到默认配置
    }
    return null
  }

  const overrides: Record<string, unknown>[] = []

  if (!app.isPackaged) {
    const devOverride = tryRead(join(app.getAppPath(), 'config.local.json'))
    if (devOverride) overrides.push(devOverride)
  } else {
    // NSIS 安装版：resources 目录（electron-builder extraResources）
    const resourcesOverride = tryRead(join(process.resourcesPath, 'config.json'))
    if (resourcesOverride) overrides.push(resourcesOverride)
    // 便携模式：exe 同目录
    const portableOverride = tryRead(join(dirname(app.getPath('exe')), 'config.json'))
    if (portableOverride) overrides.push(portableOverride)
  }

  const userOverride = tryRead(join(app.getPath('userData'), 'config.json'))
  if (userOverride) overrides.push(userOverride)

  return { ...defaultConfig, ...Object.assign({}, ...overrides) } as AppConfig
}

/** 判断目标 URL 是否属于允许导航的来源（allowedOrigins：当前目标地址 + 额外白名单） */
export function isAllowedOrigin(targetUrl: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.some((base) => {
    try {
      return new URL(targetUrl).origin === new URL(base).origin
    } catch {
      return false
    }
  })
}
