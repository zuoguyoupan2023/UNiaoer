<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Bird, Volume2, VolumeX } from 'lucide-vue-next'
import { useQuizStore } from '@/stores/quiz'
import { useSettingsStore } from '@/stores/settings'
import { ambiencePlayer, getAmbienceState, subscribeAmbience } from '@/core/ambience'

const route = useRoute()
const quiz = useQuizStore()
const settings = useSettingsStore()
const { t } = useI18n()

// 环境鸟鸣：播放范围来自设置页勾选（默认全部）
ambiencePlayer.configure({ getExcluded: () => settings.ambienceExcluded })
const ambienceOn = ref(false)
onMounted(() => {
  subscribeAmbience((s) => {
    ambienceOn.value = s.playing
  })
  // R30/R37/R38：默认开启。以「静音待命」起步——所有浏览器都允许静音自动播放，
  // 于是按钮立即显示为开；首个用户手势后取消静音正式出声。若目录加载失败则等手势重试。
  if (settings.ambienceEnabled) {
    void ambiencePlayer.start({ muted: true }).catch(() => {})
    armFirstGesture()
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

/**
 * 首个用户手势：静音待命中则取消静音出声；若尚未播放（如目录加载失败）则重试启动（R37/R38）。
 * 移动端首次触屏可能仍未获授权，失败则继续等下一次交互。
 */
let gestureArmed = false
function armFirstGesture() {
  if (gestureArmed) return
  gestureArmed = true
  const events = ['pointerdown', 'touchend', 'keydown', 'click'] as const
  const once = () => {
    for (const e of events) document.removeEventListener(e, once)
    gestureArmed = false
    if (!settings.ambienceEnabled) return
    const st = getAmbienceState()
    if (st.playing && st.muted) {
      ambiencePlayer.unmute() // 解除静音，环境音正式出声
      return
    }
    if (!st.playing) {
      void tryStartAmbience().then((ok) => {
        if (!ok) armFirstGesture() // 这次交互仍未获授权，等下一次
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
    <RouterLink to="/" class="brand" :aria-label="t('nav.brandHome')">
      <Bird class="brand-icon" :size="26" />
      <h1 class="brand-name">UNiaoer</h1>
    </RouterLink>
    <nav class="app-nav" :aria-label="t('nav.mainNav')">
      <span class="nav-group nav-primary">
        <RouterLink to="/quiz/image">{{ t('nav.imageQuiz') }}</RouterLink>
        <RouterLink to="/quiz/audio">{{ t('nav.audioQuiz') }}</RouterLink>
      </span>
      <span class="nav-group nav-utility">
        <RouterLink to="/profile">{{ t('nav.profile') }}</RouterLink>
        <RouterLink to="/settings">{{ t('nav.settings') }}</RouterLink>
        <button
          class="ambience-btn"
          type="button"
          :class="{ on: ambienceOn }"
          :title="ambienceOn ? t('nav.ambienceStop') : t('nav.ambiencePlay')"
          :aria-label="ambienceOn ? t('nav.ambienceStop') : t('nav.ambiencePlay')"
          :aria-pressed="ambienceOn"
          @click="toggleAmbience"
        >
          <Volume2 v-if="ambienceOn" :size="16" />
          <VolumeX v-else :size="16" />
        </button>
      </span>
    </nav>
  </div>

  <main class="app-main">
    <RouterView />
  </main>

  <footer class="app-footer">
    <p>{{ t('footer.source') }}</p>
    <!-- 标语：左「有鸟儿」/ 右「友鸟儿」夹 UNiaoer（015 #6）；窄屏分三行、UNiaoer 居中 -->
    <p class="tagline">
      <span class="tag-side">{{ t('footer.taglineLeft') }}</span>
      <span class="tag-sep" aria-hidden="true">·</span>
      <strong class="tag-brand">UNiaoer</strong>
      <span class="tag-sep" aria-hidden="true">·</span>
      <span class="tag-side">{{ t('footer.taglineRight') }}</span>
    </p>
    <!-- 答疑专栏入口：宽屏靠右下、窄屏居中居下（与 UNiaoer 同字号） -->
    <RouterLink class="faq-entry" to="/faq">{{ t('faq.title') }}</RouterLink>
  </footer>
</template>
