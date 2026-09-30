import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/** 历史记录上限：超出后丢弃最旧的 */
const MAX_ITEMS = 20

const historyFile = (): string => join(app.getPath('userData'), 'url-history.json')

/** 读取历史地址（最近打开的排在最前） */
export function loadHistory(): string[] {
  try {
    const file = historyFile()
    if (!existsSync(file)) return []
    const data: unknown = JSON.parse(readFileSync(file, 'utf-8'))
    if (!Array.isArray(data)) return []
    return data.filter((item): item is string => typeof item === 'string')
  } catch {
    // 文件损坏或不可读时按空历史处理
    return []
  }
}

function save(history: string[]): string[] {
  try {
    writeFileSync(historyFile(), JSON.stringify(history, null, 2), 'utf-8')
  } catch {
    // 落盘失败不影响主流程
  }
  return history
}

/** 记录一条历史：去重后置顶，超出上限截断 */
export function addHistory(url: string): string[] {
  const trimmed = url.trim()
  if (!trimmed) return loadHistory()
  const rest = loadHistory().filter((item) => item !== trimmed)
  return save([trimmed, ...rest].slice(0, MAX_ITEMS))
}

/** 删除单条历史 */
export function removeHistory(url: string): string[] {
  return save(loadHistory().filter((item) => item !== url))
}

/** 清空历史 */
export function clearHistory(): string[] {
  return save([])
}
