<script setup lang="ts">
// P2 实现出题与播放；P5 实现「第 2 题起、延迟 2s 自动播放」
</script>

<template>
  <section class="card center placeholder">
    <div class="emoji">🔊</div>
    <h2>听音找鸟</h2>
    <p class="muted">
      该玩法将在 <strong>P2</strong> 阶段实现：<br />
      加载 Xeno-canto 真实鸟鸣、生成选项、判定与科普反馈。<br />
      <strong>P5</strong> 将加入「第 2 题起、延迟 2s 自动播放」。
    </p>
    <p style="margin-top: 18px">
      <RouterLink class="btn btn-secondary" to="/">返回首页</RouterLink>
    </p>
  </section>
</template>
