<script setup lang="ts">
/**
 * 029 数据透明度:全量名录目录（/catalog）。
 * 2026-10-31 起：名录内容抽成 `CatalogPanel.vue` 共享组件——/birding 第三标签「名录」
 * 与本页共用同一份逻辑与模板；本页只剩卡片壳（标题 + 说明 + 面板）。
 */
import { Library } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import CatalogPanel from '@/components/CatalogPanel.vue'

const { t } = useI18n()
</script>

<template>
  <section class="card catalog">
    <h2 class="cat-head"><Library class="ic" :size="22" /> {{ t('catalog.title') }}</h2>
    <p class="muted lead">{{ t('catalog.lead') }}</p>
    <CatalogPanel />
  </section>
</template>

<style scoped>
.catalog {
  text-align: center;
}
.cat-head {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}
.cat-head .ic {
  color: var(--primary);
}
.lead {
  font-size: 0.85rem;
  margin-bottom: 10px;
}
</style>
