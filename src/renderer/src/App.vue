<script setup lang="ts">
import { onMounted, ref } from 'vue'
import logoUrl from './assets/logo.svg'

type ViewState = 'home' | 'loading' | 'offline'

const view = ref<ViewState>(
  location.hash.includes('offline') ? 'offline' : location.hash.includes('home') ? 'home' : 'loading'
)
const error = ref<string | null>(null)
const url = ref('')
const addressInput = ref('')
const addressError = ref('')
/** 历史打开过的地址，最近的在最前 */
const history = ref<string[]>([])

onMounted(async () => {
  const shellApi = window.nativeShell
  if (!shellApi) return
  try {
    const state = await shellApi.getAppState()
    if (state.state === 'offline') view.value = 'offline'
    else if (view.value !== 'home') view.value = 'loading'
    error.value = state.lastError
    url.value = state.url
    // 地址输入页默认带出配置地址
    if (!addressInput.value) addressInput.value = state.url
  } catch {
    // IPC 不可用时保持默认视图
  }
  try {
    history.value = await shellApi.getHistory()
  } catch {
    // 历史读取失败不影响地址输入
  }
})

/** 一键清空输入框（也支持在输入框内按 Esc） */
function clearInput(): void {
  addressInput.value = ''
  addressError.value = ''
}

/** 地址输入页：确认后跳转（非法地址在主进程侧校验，返回 false 提示） */
async function openAddress(): Promise<void> {
  const shellApi = window.nativeShell
  if (!shellApi) return
  const target = addressInput.value.trim()
  if (!target) {
    addressError.value = '请输入应用地址'
    return
  }
  addressError.value = ''
  const ok = await shellApi.openUrl(target)
  if (!ok) {
    addressError.value = '地址无效，请输入 http(s):// 开头的合法地址'
    return
  }
  url.value = target
  view.value = 'loading'
}

/** 点击历史条目：填入并直接打开 */
function openFromHistory(item: string): void {
  addressInput.value = item
  addressError.value = ''
  void openAddress()
}

/** 删除单条历史 */
async function removeFromHistory(item: string): Promise<void> {
  const shellApi = window.nativeShell
  if (!shellApi) return
  try {
    history.value = await shellApi.removeHistory(item)
  } catch {
    // 删除失败保持原列表
  }
}

/** 清空全部历史 */
async function clearAllHistory(): Promise<void> {
  const shellApi = window.nativeShell
  if (!shellApi) return
  try {
    history.value = await shellApi.clearHistory()
  } catch {
    // 清空失败保持原列表
  }
}

async function retry(): Promise<void> {
  view.value = 'loading'
  await window.nativeShell?.retryLoad()
}

/** 返回地址输入页（快捷键 Alt+Left / 离线页按钮） */
function backHome(): void {
  view.value = 'home'
  window.nativeShell?.backHome()
}
</script>

<template>
  <main class="container">
    <template v-if="view === 'home'">
      <img class="logo" :src="logoUrl" alt="应用 logo" />
      <h1 class="title">输入应用地址</h1>
      <form class="address-form" @submit.prevent="openAddress">
        <div class="input-wrap">
          <input
            v-model="addressInput"
            class="address-input"
            type="text"
            placeholder="http://192.168.1.100:5173"
            spellcheck="false"
            autofocus
            @keydown.esc="clearInput"
          />
          <button
            v-if="addressInput"
            class="clear-btn"
            type="button"
            title="清空输入（Esc）"
            @click="clearInput"
          >
            ✕
          </button>
        </div>
        <button class="open-btn" type="submit">打开</button>
      </form>
      <p class="error" v-if="addressError">{{ addressError }}</p>

      <section class="history" v-if="history.length">
        <div class="history-head">
          <span class="history-title">历史记录（{{ history.length }}）</span>
          <button class="history-clear-all" type="button" @click="clearAllHistory">清空全部</button>
        </div>
        <ul class="history-list">
          <li v-for="item in history" :key="item" class="history-item">
            <button class="history-link" type="button" :title="item" @click="openFromHistory(item)">
              {{ item }}
            </button>
            <button
              class="history-del"
              type="button"
              title="删除这条记录"
              @click="removeFromHistory(item)"
            >
              ✕
            </button>
          </li>
        </ul>
      </section>
    </template>

    <template v-else-if="view === 'loading'">
      <img class="logo logo-sm" :src="logoUrl" alt="应用 logo" />
      <div class="spinner" aria-hidden="true"></div>
      <p class="title">正在加载应用…</p>
      <p class="hint">{{ url }}</p>
    </template>

    <template v-else>
      <h1 class="title">网络连接失败</h1>
      <p class="error" v-if="error">{{ error }}</p>
      <p class="hint">请检查网络连接后重试</p>
      <div class="btn-row">
        <button class="retry-btn" type="button" @click="retry">重新加载</button>
        <button class="back-btn" type="button" @click="backHome">返回地址页</button>
      </div>
    </template>
  </main>
</template>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 12px;
  padding: 24px;
}

.logo {
  width: 72px;
  height: 72px;
  user-select: none;
  -webkit-user-drag: none;
}

.logo-sm {
  width: 56px;
  height: 56px;
  margin-bottom: 4px;
}

.title {
  font-size: 18px;
  font-weight: 500;
  margin: 8px 0 0;
  color: #334155;
}

.hint {
  font-size: 13px;
  color: #94a3b8;
  margin: 0;
}

.error {
  font-size: 13px;
  color: #e24b4a;
  margin: 0;
}

.address-form {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  width: 100%;
  max-width: 460px;
}

.input-wrap {
  position: relative;
  flex: 1;
  display: flex;
}

.address-input {
  flex: 1;
  padding: 9px 32px 9px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 14px;
  color: #334155;
  outline: none;
}

.address-input:focus {
  border-color: #534ab7;
}

.clear-btn {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.clear-btn:hover {
  background: #e2e8f0;
  color: #475569;
}

.open-btn {
  padding: 8px 24px;
  border: none;
  border-radius: 8px;
  background: #534ab7;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}

.open-btn:hover {
  background: #3c3489;
}

.history {
  width: 100%;
  max-width: 460px;
  margin-top: 8px;
}

.history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.history-title {
  font-size: 12px;
  color: #94a3b8;
}

.history-clear-all {
  border: none;
  background: transparent;
  color: #94a3b8;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
}

.history-clear-all:hover {
  color: #e24b4a;
}

.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px 0 10px;
}

.history-item + .history-item {
  border-top: 1px solid #eef2f7;
}

.history-link {
  flex: 1;
  min-width: 0;
  padding: 8px 0;
  border: none;
  background: transparent;
  color: #334155;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-link:hover {
  color: #534ab7;
}

.history-del {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #cbd5e1;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  flex: 0 0 auto;
}

.history-del:hover {
  background: #fee2e2;
  color: #e24b4a;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e2e8f0;
  border-top-color: #534ab7;
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.retry-btn {
  padding: 8px 28px;
  border: none;
  border-radius: 8px;
  background: #534ab7;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}

.retry-btn:hover {
  background: #3c3489;
}

.btn-row {
  display: flex;
  gap: 12px;
  margin-top: 12px;
}

.back-btn {
  padding: 8px 28px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: transparent;
  color: #475569;
  font-size: 14px;
  cursor: pointer;
}

.back-btn:hover {
  border-color: #94a3b8;
  color: #1e293b;
}
</style>
