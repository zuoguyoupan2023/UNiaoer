<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'

const route = useRoute()
/** 答题模式沉浸式：隐藏顶部标题与导航（页脚保留） */
const immersive = computed(() => String(route.name ?? '').startsWith('quiz'))
</script>

<template>
  <header v-if="!immersive" class="app-header">
    <h1>🐦 UNiaoer</h1>
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
