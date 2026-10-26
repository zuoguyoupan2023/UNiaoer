<script setup lang="ts">
/**
 * 关于 UNiaoer（2026-10-26 改版）
 *
 * 改版原因：原实现直接把 README.md 用 `?raw` + marked 整篇渲染，读起来是仓库文档
 * 而不是站点页面；也没法往里加站点特有的东西（许可证明细、更新日志入口）。
 *
 * 现在改为**结构化的 Vue 页面**：内容与 README 中英版保持一致（项目定位、玩法、
 * 数据来源与许可、隐私、技术栈、联系方式），但按站点的信息层级重排。
 * README 仍是仓库侧的权威来源，页面底部保留出处链接。
 *
 * 许可证明细是**逐条列出的结构化数据**（见下方 LICENSE_GROUPS），
 * 因为「哪些数据用哪个许可、有什么义务」是最需要一眼看清的部分。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { History, Info } from 'lucide-vue-next'
import { GITHUB_REPO } from '@/core/social'
import { currentLocale } from '@/i18n'

const { t } = useI18n()
const isEn = computed(() => String(currentLocale()).startsWith('en'))
const readmeFile = computed(() => (isEn.value ? 'README.en.md' : 'README.md'))
const readmeUrl = computed(() => `${GITHUB_REPO}/blob/main/${readmeFile.value}`)

interface LicenseRow {
  name: string
  use: string
  license: string
  /** 外链（可选） */
  url?: string
}

/** 媒体素材：逐条许可，页面每条素材都带署名 */
const MEDIA_ROWS = computed<LicenseRow[]>(() => [
  {
    name: 'iNaturalist',
    url: 'https://www.inaturalist.org/',
    use: t('about.lic.media.inat'),
    license: t('about.lic.media.inatLic'),
  },
  {
    name: 'Xeno-canto',
    url: 'https://xeno-canto.org/',
    use: t('about.lic.media.xc'),
    license: t('about.lic.media.xcLic'),
  },
  {
    name: 'whitenoise.earthtrip.online',
    use: t('about.lic.media.wn'),
    license: t('about.lic.media.wnLic'),
  },
])

/** 开放数据集与分类骨架 */
const DATA_ROWS = computed<LicenseRow[]>(() => [
  {
    name: 'AviList v2025b',
    url: 'https://www.avilist.org/',
    use: t('about.lic.data.avilist'),
    license: 'CC BY 4.0',
  },
  {
    name: 'GBIF',
    url: 'https://www.gbif.org/',
    use: t('about.lic.data.gbif'),
    license: t('about.lic.data.gbifLic'),
  },
  {
    name: 'eBird',
    url: 'https://ebird.org/',
    use: t('about.lic.data.ebird'),
    license: t('about.lic.data.ebirdLic'),
  },
  {
    name: 'ISO 3166-2',
    url: 'https://github.com/alexander-schranz/iso-3166-2',
    use: t('about.lic.data.iso'),
    license: 'MIT',
  },
  {
    name: 'IUCN Red List',
    url: 'https://www.iucnredlist.org/',
    use: t('about.lic.data.iucn'),
    license: t('about.lic.data.iucnLic'),
  },
  {
    name: 'AVONET',
    url: 'https://doi.org/10.1111/ele.13898',
    use: t('about.lic.data.avonet'),
    license: 'CC BY 4.0',
  },
  {
    name: 'EltonTraits 1.0',
    url: 'https://doi.org/10.1890/13-1917.1',
    use: t('about.lic.data.elton'),
    license: t('about.lic.data.eltonLic'),
  },
  {
    name: 'Dunning et al. 2025',
    url: 'https://doi.org/10.5061/dryad.jq2bvq8jg',
    use: t('about.lic.data.dunning'),
    license: 'CC0-1.0',
  },
  {
    name: 'Wikidata',
    url: 'https://www.wikidata.org/',
    use: t('about.lic.data.wikidata'),
    license: 'CC0 1.0',
  },
  {
    name: 'Wikipedia (zh / en)',
    use: t('about.lic.data.wikipedia'),
    license: 'CC BY-SA 4.0',
  },
])

/** 识别模型（浏览器本地推理） */
const MODEL_ROWS = computed<LicenseRow[]>(() => [
  {
    name: 'BirdNET v2.4',
    url: 'https://github.com/kahst/BirdNET-Analyzer',
    use: t('about.lic.model.birdnet'),
    license: 'CC BY-NC-SA 4.0',
  },
  {
    name: 'OSEA',
    url: 'https://huggingface.co/sunjiao/osea',
    use: t('about.lic.model.osea'),
    license: t('about.lic.model.oseaLic'),
  },
])

const techStack = ['Vue 3', 'TypeScript', 'Vite', 'Vue Router', 'Pinia', 'Vitest', 'Cloudflare Workers / D1 / R2']
</script>

<template>
  <div class="about-page">
    <section class="card">
      <h2 class="head"><Info class="ic" :size="22" /> {{ t('about.title') }}</h2>
      <p class="lead">{{ t('about.intro') }}</p>

      <ul class="badges">
        <li>{{ t('about.badgeNonCommercial') }}</li>
        <li>{{ t('about.badgeOpenSource') }}</li>
        <li>{{ t('about.badgeLocalData') }}</li>
      </ul>

      <h3 class="sub">{{ t('about.whatTitle') }}</h3>
      <p>{{ t('about.whatBody') }}</p>

      <h3 class="sub">{{ t('about.playTitle') }}</h3>
      <ul class="plain">
        <li>{{ t('about.playL1') }}</li>
        <li>{{ t('about.playL67') }}</li>
        <li>{{ t('about.playRegion') }}</li>
      </ul>

      <h3 class="sub">{{ t('about.techTitle') }}</h3>
      <ul class="chips">
        <li v-for="s in techStack" :key="s">{{ s }}</li>
      </ul>
    </section>

    <section class="card">
      <h3 class="sub first">{{ t('about.licTitle') }}</h3>
      <p class="muted small">{{ t('about.licLead') }}</p>

      <h4 class="group">{{ t('about.lic.mediaTitle') }}</h4>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ t('about.lic.colSource') }}</th>
              <th>{{ t('about.lic.colUse') }}</th>
              <th>{{ t('about.lic.colLicense') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in MEDIA_ROWS" :key="row.name">
              <td>
                <a v-if="row.url" :href="row.url" target="_blank" rel="noopener noreferrer">{{ row.name }}</a>
                <span v-else>{{ row.name }}</span>
              </td>
              <td>{{ row.use }}</td>
              <td>{{ row.license }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h4 class="group">{{ t('about.lic.dataTitle') }}</h4>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ t('about.lic.colSource') }}</th>
              <th>{{ t('about.lic.colUse') }}</th>
              <th>{{ t('about.lic.colLicense') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in DATA_ROWS" :key="row.name">
              <td>
                <a v-if="row.url" :href="row.url" target="_blank" rel="noopener noreferrer">{{ row.name }}</a>
                <span v-else>{{ row.name }}</span>
              </td>
              <td>{{ row.use }}</td>
              <td>{{ row.license }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h4 class="group">{{ t('about.lic.modelTitle') }}</h4>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ t('about.lic.colModel') }}</th>
              <th>{{ t('about.lic.colUse') }}</th>
              <th>{{ t('about.lic.colLicense') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in MODEL_ROWS" :key="row.name">
              <td>
                <a v-if="row.url" :href="row.url" target="_blank" rel="noopener noreferrer">{{ row.name }}</a>
                <span v-else>{{ row.name }}</span>
              </td>
              <td>{{ row.use }}</td>
              <td>{{ row.license }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <ul class="notes">
        <li>{{ t('about.lic.note1') }}</li>
        <li>{{ t('about.lic.note2') }}</li>
        <li>{{ t('about.lic.note3') }}</li>
      </ul>
    </section>

    <section class="card">
      <h3 class="sub first">{{ t('about.privacyTitle') }}</h3>
      <ul class="plain">
        <li>{{ t('about.privacyLocal') }}</li>
        <li>{{ t('about.privacyMetrics') }}</li>
        <li>{{ t('about.privacyShare') }}</li>
      </ul>

      <h3 class="sub">{{ t('about.contactTitle') }}</h3>
      <ul class="plain">
        <li>
          GitHub：
          <a :href="GITHUB_REPO" target="_blank" rel="noopener noreferrer">{{ t('about.contactRepo') }}</a>
        </li>
        <li>{{ t('about.contactXhs') }}</li>
      </ul>
    </section>

    <p class="muted small foot">
      <RouterLink to="/changelog" class="log-link">
        <History class="ic" :size="14" /> {{ t('about.changelogLink') }}
      </RouterLink>
      <span class="sep">·</span>
      {{ t('about.source') }}
      <a :href="readmeUrl" target="_blank" rel="noopener noreferrer">{{ readmeFile }}</a>
    </p>
  </div>
</template>

<style scoped>
.about-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.15rem;
  margin: 0;
}
.lead {
  margin: 10px 0 12px;
  line-height: 1.75;
}
.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  list-style: none;
  padding: 0;
  margin: 0 0 6px;
}
.badges li {
  padding: 3px 10px;
  border-radius: 999px;
  background: #eaf4ef;
  color: var(--primary-dark);
  font-size: 0.74rem;
  font-weight: 600;
}
.sub {
  margin: 20px 0 8px;
  font-size: 0.98rem;
}
.sub.first {
  margin-top: 0;
}
.group {
  margin: 18px 0 8px;
  font-size: 0.9rem;
  color: var(--primary-dark);
}
.plain {
  margin: 0;
  padding-left: 20px;
  font-size: 0.88rem;
  line-height: 1.8;
}
.plain li {
  margin: 4px 0;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  list-style: none;
  padding: 0;
  margin: 0;
}
.chips li {
  padding: 3px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 0.76rem;
  color: var(--text-light);
}
/* 窄屏可横向滚动，避免表格把整页撑宽 */
.table-wrap {
  overflow-x: auto;
  margin-bottom: 4px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}
th,
td {
  border: 1px solid var(--border);
  padding: 7px 9px;
  text-align: left;
  vertical-align: top;
  line-height: 1.6;
}
th {
  background: var(--surface-2, #f9fafb);
  font-weight: 600;
  white-space: nowrap;
}
td:first-child {
  white-space: nowrap;
}
.notes {
  margin: 12px 0 0;
  padding-left: 20px;
  font-size: 0.82rem;
  line-height: 1.75;
  color: var(--text-light);
}
.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 0 2px;
}
.foot a {
  color: var(--primary);
  text-decoration: underline;
}
.log-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
}
.sep {
  opacity: 0.5;
}
</style>
