<script setup lang="ts">
import { onMounted, ref } from 'vue'

type ViewState = 'home' | 'loading' | 'offline'

const view = ref<ViewState>(
  location.hash.includes('offline') ? 'offline' : location.hash.includes('home') ? 'home' : 'loading'
)
const error = ref<string | null>(null)
const url = ref('')
const addressInput = ref('')
const addressError = ref('')

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
})

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
      <h1 class="title">输入应用地址 HMR-PROBE</h1>
      <form class="address-form" @submit.prevent="openAddress">
        <input
          v-model="addressInput"
          class="address-input"
          type="text"
          placeholder="http://192.168.1.100:5173"
          spellcheck="false"
          autofocus
        />
        <button class="open-btn" type="submit">打开</button>
      </form>
      <p class="error" v-if="addressError">{{ addressError }}</p>
    </template>

    <template v-else-if="view === 'loading'">
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

.address-input {
  flex: 1;
  padding: 9px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 14px;
  color: #334155;
  outline: none;
}

.address-input:focus {
  border-color: #534ab7;
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
