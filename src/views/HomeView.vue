<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <section class="card center">
    <h2 style="font-size: 1.2rem; margin-bottom: 8px">选择玩法</h2>
    <p class="muted" style="margin-bottom: 20px">
      用真实的鸟类照片与鸟鸣，练习辨识能力。每轮 10 题。
    </p>

    <div class="modes">
      <RouterLink to="/quiz/image" class="mode-card">
        <span class="mode-emoji">🖼️</span>
        <span class="mode-title">看图找鸟</span>
        <span class="mode-sub">来自 iNaturalist 的开放许可照片</span>
      </RouterLink>
      <RouterLink to="/quiz/audio" class="mode-card">
        <span class="mode-emoji">🔊</span>
        <span class="mode-title">听音找鸟</span>
        <span class="mode-sub">来自 Xeno-canto 的真实鸟鸣</span>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.modes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
@media (max-width: 520px) {
  .modes {
    grid-template-columns: 1fr;
  }
}
.mode-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 26px 16px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text);
  transition: all 0.2s ease;
  box-shadow: var(--shadow-sm);
}
.mode-card:hover {
  transform: translateY(-3px);
  border-color: var(--primary-light);
  box-shadow: var(--shadow);
  text-decoration: none;
}
.mode-emoji {
  font-size: 2.4rem;
}
.mode-title {
  font-size: 1.05rem;
  font-weight: 800;
}
.mode-sub {
  font-size: 0.76rem;
  color: var(--text-light);
}
</style>
