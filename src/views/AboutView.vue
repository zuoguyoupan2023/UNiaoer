<script setup lang="ts">
/**
 * 关于 UNiaoer（2026-10-21）
 *
 * 内容直接取仓库根目录的 `README.md`（Vite `?raw`），用 marked 渲染：
 * README 是公开仓库里唯一的「完整说明」，About 页不再维护第二份副本，
 * 避免两边说法不一致（许可、数据源、计划题型都以 README 为准）。
 *
 * 这是静态、可信内容，`v-html` 不存在用户输入；链接统一加 `target=_blank`。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Info } from 'lucide-vue-next'
import { marked } from 'marked'
import readmeZh from '../../README.md?raw'
import readmeEn from '../../README.en.md?raw'
import { GITHUB_REPO } from '@/core/social'
import { currentLocale } from '@/i18n'

const { t } = useI18n()

/** 英文界面用 README.en.md；其余用 README.md（两份内容对照维护） */
const isEn = computed(() => String(currentLocale()).startsWith('en'))
const doc = computed(() => (isEn.value ? readmeEn : readmeZh))
const sourceFile = computed(() => (isEn.value ? 'README.en.md' : 'README.md'))

const html = computed(() => {
  // 去掉 H1：页面自己有标题；其余按 README 原样渲染
  const md = doc.value.replace(/^#\s+.*\r?\n+/, '')
  const raw = marked.parse(md) as string
  return (
    raw
      // README 的相对链接（如 ./LICENSE）在站内没有对应文件 → 指到 GitHub
      .replace(/href="\.\/([^"]+)"/g, `href="${GITHUB_REPO}/blob/main/$1"`)
      .replace(/<a href="(https?:[^"]+)"/g, '<a target="_blank" rel="noopener noreferrer" href="$1"')
  )
})

const readmeUrl = computed(() => `${GITHUB_REPO}/blob/main/${sourceFile.value}`)
</script>

<template>
  <section class="card about">
    <h2 class="head"><Info class="ic" :size="22" /> {{ t('about.title') }}</h2>
    <p class="muted lead">{{ t('about.lead') }}</p>
    <!-- README 是可信静态内容（仓库文件），不是用户输入 -->
    <article class="md" v-html="html" />
    <p class="muted small src">
      {{ t('about.source') }}
      <a :href="readmeUrl" target="_blank" rel="noopener noreferrer">{{ sourceFile }}</a>
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
  margin-bottom: 14px;
}
.src {
  margin-top: 18px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}
.src a {
  color: var(--primary);
  text-decoration: underline;
}
/* README 渲染样式：只覆盖必要元素，保持站点字体与间距 */
.md {
  font-size: 0.9rem;
  line-height: 1.75;
  overflow-wrap: anywhere;
}
.md :deep(h2) {
  margin: 22px 0 8px;
  font-size: 1.05rem;
}
.md :deep(h3) {
  margin: 16px 0 6px;
  font-size: 0.95rem;
}
.md :deep(p) {
  margin: 8px 0;
}
.md :deep(ul),
.md :deep(ol) {
  margin: 8px 0;
  padding-left: 20px;
}
.md :deep(li) {
  margin: 3px 0;
}
.md :deep(a) {
  color: var(--primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.md :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.82em;
  background: var(--surface-2, #f3f4f6);
  padding: 1px 4px;
  border-radius: 4px;
}
.md :deep(pre) {
  background: var(--surface-2, #f3f4f6);
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
}
.md :deep(pre code) {
  background: none;
  padding: 0;
}
.md :deep(blockquote) {
  margin: 10px 0;
  padding: 8px 12px;
  border-left: 3px solid var(--primary);
  background: var(--surface-2, #f9fafb);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  color: var(--text-light);
}
.md :deep(table) {
  display: block;
  width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 0.82rem;
}
.md :deep(th),
.md :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
  white-space: normal;
}
.md :deep(th) {
  background: var(--surface-2, #f9fafb);
  font-weight: 600;
}
.md :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 20px 0;
}
</style>
