<script setup lang="ts">
/**
 * 更新日志（2026-10-26）：按日期倒序列出每次发布改了什么。
 *
 * 数据在 `src/data/changelog.ts`（TS 而非 JSON：字段写错在 build 就红）。
 * 这里只做渲染与本地化取词，不引入 marked / v-html——全是受控文案。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { History } from 'lucide-vue-next'
import { CHANGELOG } from '@/data/changelog'
import { currentLocale } from '@/i18n'

const { t } = useI18n()

const isEn = computed(() => String(currentLocale()).startsWith('en'))
/** 按数据里的顺序渲染（数组本身已是最新在前，见 changelog.ts 维护规则） */
const entries = computed(() => CHANGELOG)
</script>

<template>
  <section class="card changelog">
    <h2 class="head"><History class="ic" :size="22" /> {{ t('changelog.title') }}</h2>
    <p class="muted lead">{{ t('changelog.lead') }}</p>

    <p v-if="!entries.length" class="muted empty">{{ t('changelog.empty') }}</p>

    <ol v-else class="entries">
      <li v-for="entry in entries" :key="entry.date" class="entry">
        <div class="entry-head">
          <time class="date" :datetime="entry.date">{{ entry.date }}</time>
          <h3 class="entry-title">{{ (isEn ? entry.en : entry.zh).title }}</h3>
        </div>
        <ul class="items">
          <li v-for="(item, i) in (isEn ? entry.en : entry.zh).items" :key="i">{{ item }}</li>
        </ul>
      </li>
    </ol>

    <p class="muted small src">
      {{ t('changelog.source') }}
      <RouterLink to="/about">{{ t('changelog.aboutLink') }}</RouterLink>
    </p>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.15rem;
}
.lead {
  margin-top: 6px;
  margin-bottom: 18px;
}
.empty {
  padding: 20px 0;
}
.entries {
  list-style: none;
  margin: 0;
  padding: 0;
  position: relative;
}
/* 时间轴：左侧一条竖线串起各次发布 */
.entries::before {
  content: '';
  position: absolute;
  left: 5px;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: var(--border);
}
.entry {
  position: relative;
  padding-left: 24px;
  margin-bottom: 22px;
}
.entry::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 0 3px #fff;
}
.entry-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 6px;
}
.date {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.82rem;
  color: var(--primary);
  font-weight: 700;
}
.entry-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
}
.items {
  margin: 0;
  padding-left: 18px;
  font-size: 0.88rem;
  line-height: 1.75;
}
.items li {
  margin: 3px 0;
}
.src {
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}
.src a {
  color: var(--primary);
  text-decoration: underline;
}
</style>
