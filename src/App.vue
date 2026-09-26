<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { Bird } from 'lucide-vue-next'
import { useQuizStore } from '@/stores/quiz'

const route = useRoute()
const quiz = useQuizStore()
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
  <header v-if="!immersive" class="app-header">
    <h1><Bird class="brand-icon" :size="30" /> UNiaoer</h1>
  </header>

  <nav v-if="!immersive" class="app-nav">
    <RouterLink to="/">首页</RouterLink>
    <RouterLink to="/quiz/image">看图认鸟</RouterLink>
    <RouterLink to="/quiz/audio">听音认鸟</RouterLink>
    <RouterLink to="/wrong">错题本</RouterLink>
    <RouterLink to="/profile">我的</RouterLink>
    <RouterLink to="/settings">设置</RouterLink>
  </nav>

  <main class="app-main">
    <RouterView />
  </main>

  <footer class="app-footer">
    <p>数据来源：Xeno-canto · iNaturalist</p>
    <p>有鸟儿 · UNiaoer · 友鸟儿</p>
  </footer>
</template>
