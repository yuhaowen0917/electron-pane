import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import defaultConfig from '../../config.json'

export interface AppConfig {
  /** 远程 Web 应用地址（壳子加载的 URL） */
  url: string
  /** 自定义协议名：通过 pane:// 链接唤起桌面应用本体（不需带 ://） */
  protocol: string
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

/**
 * 常见二级公共后缀：命中时主域取三段（如 a.example.co.uk 的主域是 example.co.uk），
 * 避免把 co.uk 当成主域导致不同站点被误判为同一家。
 */
const SECOND_LEVEL_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'gov.uk',
  'ac.uk',
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'edu.cn',
  'com.hk',
  'com.tw',
  'com.au',
  'co.jp',
  'co.kr',
  'com.sg',
  'com.br'
])

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * 取 host 的主域（注册域的近似值）：
 * www.example.com → example.com；a.sso.example.com → example.com；a.example.co.uk → example.co.uk。
 * localhost、IP、单段内网名不做归并，按原样返回。
 */
function primaryDomain(host: string): string {
  const h = host.toLowerCase()
  if (!h || h === 'localhost' || IPV4_PATTERN.test(h) || h.includes(':')) return h
  const parts = h.split('.')
  if (parts.length <= 2) return h
  const lastTwo = parts.slice(-2).join('.')
  return SECOND_LEVEL_SUFFIXES.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo
}

/** 端口归一：显式 :443 / :80 与默认端口视为等价 */
function effectivePort(url: URL): string {
  if (url.port) return url.port
  if (url.protocol === 'https:') return '443'
  if (url.protocol === 'http:') return '80'
  return ''
}

/**
 * 是否属于同一站点：协议与端口一致，且 host 相同或同属一个主域。
 * 例：app.example.com 与 sso.example.com 视为站内（SSO/子应用跳转不会被甩到浏览器）。
 */
function isSameSite(target: URL, base: URL): boolean {
  if (target.protocol !== base.protocol) return false
  if (effectivePort(target) !== effectivePort(base)) return false
  if (target.hostname === base.hostname) return true
  return primaryDomain(target.hostname) === primaryDomain(base.hostname)
}

/**
 * 判断目标 URL 是否属于允许导航的来源（allowedOrigins：当前目标地址 + 额外白名单）。
 * 匹配规则：同 origin，或同一主域下的子域（协议、端口需一致）。
 */
export function isAllowedOrigin(targetUrl: string, allowedOrigins: string[]): boolean {
  let target: URL
  try {
    target = new URL(targetUrl)
  } catch {
    return false
  }
  return allowedOrigins.some((base) => {
    try {
      return isSameSite(target, new URL(base))
    } catch {
      return false
    }
  })
}
