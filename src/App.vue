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
        <RouterLink to="/wrong">错题本</RouterLink>
        <RouterLink to="/profile">我的</RouterLink>
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
