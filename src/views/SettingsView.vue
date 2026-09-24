<script setup lang="ts">
import { useSettingsStore } from '@/stores/settings'
import type { LicensePolicy } from '@/types'

const settings = useSettingsStore()

const policies: { value: LicensePolicy; label: string; hint: string }[] = [
  {
    value: 'relaxed',
    label: '宽松（含 CC-BY-NC）',
    hint: '非商业项目可用，素材最全。NC 素材不转码。',
  },
  {
    value: 'strict',
    label: '严格（仅 CC0 / BY / BY-SA）',
    hint: '保证下游也可商用；素材相对少。',
  },
]
</script>

<template>
  <section class="card">
    <h2 class="sec">⚙️ 设置</h2>

    <div class="setting">
      <h3>素材许可策略</h3>
      <p class="muted">决定抓取/出题时放行哪些许可证的素材。</p>
      <div class="choices">
        <button
          v-for="p in policies"
          :key="p.value"
          class="choice"
          :class="{ on: settings.licensePolicy === p.value }"
          @click="settings.licensePolicy = p.value"
        >
          <strong>{{ p.label }}</strong>
          <span>{{ p.hint }}</span>
        </button>
      </div>
    </div>

    <div class="setting">
      <h3>音频自动播放</h3>
      <label class="switch">
        <input v-model="settings.autoplayAudio" type="checkbox" />
        <span>开启后，从第 2 题起、切题后延迟自动播放鸟鸣</span>
      </label>

      <label class="delay">
        延迟
        <input
          v-model.number="settings.autoplayDelayMs"
          type="number"
          min="1000"
          max="3000"
          step="500"
        />
        ms
      </label>
    </div>

    <p class="muted" style="margin-top: 8px">
      设置保存在浏览器本地。自动播放将在 <strong>P5</strong> 阶段接入答题流程。
    </p>
  </section>
</template>

<style scoped>
h2.sec {
  font-size: 1.1rem;
  margin-bottom: 16px;
}
.setting {
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
}
.setting:last-of-type {
  border-bottom: none;
}
.setting h3 {
  font-size: 0.95rem;
  margin-bottom: 6px;
}
.choices {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}
.choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  text-align: left;
  padding: 12px 16px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  cursor: pointer;
  transition: all 0.18s ease;
}
.choice:hover {
  border-color: var(--primary-light);
}
.choice.on {
  border-color: var(--primary);
  background: #f3fbf7;
}
.choice strong {
  font-size: 0.9rem;
}
.choice span {
  font-size: 0.76rem;
  color: var(--text-light);
}
.switch {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  font-size: 0.85rem;
  cursor: pointer;
}
.delay {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: 0.85rem;
}
.delay input {
  width: 90px;
  padding: 7px 10px;
  border: 2px solid var(--border);
  border-radius: 10px;
  font-family: inherit;
}
</style>
