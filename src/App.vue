<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <header class="app-header">
    <h1>🐦 UNiaoer</h1>
    <p>开源 · 非商业 · 看图找鸟 / 听音找鸟</p>
  </header>

  <nav class="app-nav">
    <RouterLink to="/">首页</RouterLink>
    <RouterLink to="/quiz/image">看图找鸟</RouterLink>
    <RouterLink to="/quiz/audio">听音找鸟</RouterLink>
    <RouterLink to="/wrong">错题本</RouterLink>
    <RouterLink to="/profile">我的</RouterLink>
    <RouterLink to="/settings">设置</RouterLink>
  </nav>

  <main class="app-main">
    <RouterView />
  </main>

  <footer class="app-footer">
    <p>数据来源：Xeno-canto · iNaturalist（遵循各自 CC 许可，均保留署名）</p>
    <p>UNiaoer · 开源非商业项目</p>
  </footer>
</template>
