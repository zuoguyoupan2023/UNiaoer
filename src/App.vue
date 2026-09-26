<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { Bird, Volume2, VolumeX } from 'lucide-vue-next'
import { useQuizStore } from '@/stores/quiz'
import { useSettingsStore } from '@/stores/settings'
import { ambiencePlayer, getAmbienceState, subscribeAmbience } from '@/core/ambience'

const route = useRoute()
const quiz = useQuizStore()
const settings = useSettingsStore()

// 环境鸟鸣：播放范围来自设置页勾选（默认全部）
ambiencePlayer.configure({ getExcluded: () => settings.ambienceExcluded })
const ambienceOn = ref(false)
onMounted(() => {
  subscribeAmbience((s) => {
    ambienceOn.value = s.playing
  })
  // R30/R37：默认自动播放。被浏览器拦截（无手势/无痕模式）时，持续监听用户交互重试直到成功；
  // 用户手动关闭过（ambienceEnabled=false）则不自动播
  if (settings.ambienceEnabled) {
    void tryStartAmbience().then((ok) => {
      if (!ok) armGestureRetry()
    })
  }
})

async function tryStartAmbience() {
  try {
    await ambiencePlayer.start()
    // start() 内部把连续失败的自动播放自行 stop（如无手势被拦截）——以实际状态为准
    return getAmbienceState().playing
  } catch {
    return false // 目录加载失败
  }
}

/** 持续监听用户交互重试自动播放（R37）：移动端首次触屏可能仍未获播放授权，直到成功为止 */
let gestureRetryArmed = false
function armGestureRetry() {
  if (gestureRetryArmed) return
  gestureRetryArmed = true
  const events = ['pointerdown', 'touchend', 'keydown', 'click'] as const
  const once = () => {
    for (const e of events) document.removeEventListener(e, once)
    gestureRetryArmed = false
    if (settings.ambienceEnabled && !getAmbienceState().playing) {
      void tryStartAmbience().then((ok) => {
        if (!ok) armGestureRetry() // 这次交互仍未获授权，等下一次
      })
    }
  }
  for (const e of events) document.addEventListener(e, once, { once: true, passive: true })
}

async function toggleAmbience() {
  if (ambienceOn.value) {
    ambiencePlayer.stop()
    settings.ambienceEnabled = false // 手动关闭后记住，不再自动播放
  } else {
    settings.ambienceEnabled = true
    await tryStartAmbience()
  }
}
/**
 * 答题模式沉浸式：仅在"正式答题中"（本轮题目已就绪或加载中；介绍页/选难度除外）
 * 隐藏顶部标题与导航。介绍页 questions 为空且未在加载，顶部正常显示。
 */
const immersive = computed(
  () =>
    String(route.name ?? '').startsWith('quiz') && (quiz.questions.length > 0 || quiz.loading),
)
</script>

<template>
  <!-- 顶部：品牌（=首页链接）+ 导航同一行，节约高度（R21） -->
  <div v-if="!immersive" class="app-topbar">
    <RouterLink to="/" class="brand" aria-label="UNiaoer 首页">
      <Bird class="brand-icon" :size="26" />
      <h1 class="brand-name">UNiaoer</h1>
    </RouterLink>
    <nav class="app-nav" aria-label="主导航">
      <span class="nav-group nav-primary">
        <RouterLink to="/quiz/image">看图认鸟</RouterLink>
        <RouterLink to="/quiz/audio">听音认鸟</RouterLink>
      </span>
      <span class="nav-group nav-utility">
        <RouterLink to="/profile">我的</RouterLink>
        <button
          class="ambience-btn"
          type="button"
          :class="{ on: ambienceOn }"
          :title="ambienceOn ? '停止环境鸟鸣' : '播放环境鸟鸣'"
          :aria-label="ambienceOn ? '停止环境鸟鸣' : '播放环境鸟鸣'"
          :aria-pressed="ambienceOn"
          @click="toggleAmbience"
        >
          <Volume2 v-if="ambienceOn" :size="16" />
          <VolumeX v-else :size="16" />
        </button>
        <RouterLink to="/settings">设置</RouterLink>
      </span>
    </nav>
  </div>

  <main class="app-main">
    <RouterView />
  </main>

  <footer class="app-footer">
    <p>数据来源：Xeno-canto · iNaturalist</p>
    <p>有鸟儿 · UNiaoer · 友鸟儿</p>
  </footer>
</template>
