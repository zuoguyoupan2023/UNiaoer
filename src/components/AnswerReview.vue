<script setup lang="ts">
/**
 * 作答后的「选项对照 + 图片来源」集中展示（铁律 11，2026-11-03 用户定）。
 *
 * 背景：
 * - S1 看名选图（name-stem）的选项是**纯图片**，`alt` 为空、图下不放名字——作答前这是
 *   防泄题的必要设计（docs/099 §3.2）；作答后必须补上「A 是什么鸟」，否则做题人只知道错了，
 *   不知道错在哪、别人是什么鸟。
 * - 最高原则是「帮助做题人辨识各种鸟」：一道题的 4 个选项就是 4 只鸟的对照样本，
 *   必须让做题人能顺带记住「A 是这个鸟、B 是那个鸟」。
 * - 同时 CC BY / BY-NC 等许可证要求署名。作答前不显示（泄题），作答后**必须**显示。
 *
 * 两块集中显示（不逐图挂小字，那样拥挤且信息不全）：
 *   ① 选项对照：A → 鸟名（标注「正确」/「你选的」）
 *   ② 图片来源：A → 作者 · 许可证（仅当该选项确有图时；看图选名的选项是名字，无图）
 *
 * 只渲染一次（父组件用 v-if="answered" 控制），本身不做显示判断。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, X } from 'lucide-vue-next'
import type { MediaAsset } from '@/types'

const props = defineProps<{
  /** 选项名（已按当前 locale 解析） */
  options: string[]
  /** 每项对应的媒体（看名选图有；看图选名通常没有） */
  optionsMedia?: MediaAsset[]
  /** 正确答案名 */
  answer: string
  /** 用户所选（超时/未选为 null） */
  chosen: string | null
}>()

const { t } = useI18n()

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

interface Row {
  letter: string
  name: string
  isAnswer: boolean
  isChosen: boolean
  /** 该选项有图时才有署名 */
  author?: string
  license?: string
  source?: string
  sourceUrl?: string
  licenseUrl?: string
}

const rows = computed<Row[]>(() =>
  props.options.map((name, i) => {
    const m = props.optionsMedia?.[i]
    return {
      letter: LETTERS[i] ?? String(i + 1),
      name,
      isAnswer: name === props.answer,
      isChosen: props.chosen !== null && name === props.chosen,
      // 只有「名字 → 图」的选项才有该项的署名；看图选名的选项是纯文本，无图
      author: m?.author,
      license: m?.license,
      source: m?.source,
      sourceUrl: m?.sourceUrl,
      licenseUrl: m?.licenseUrl,
    }
  }),
)

/** 是否有任一选项带图（决定是否渲染第二块） */
const hasAnyMedia = computed(() => rows.value.some((r) => r.author || r.license))
</script>

<template>
  <section class="answer-review" aria-live="polite">
    <!-- ① 选项对照：A → 鸟名（2×2 网格，2026-11-03 用户定） -->
    <div class="block">
      <p class="cap">{{ t('quiz.review.optionsCap') }}</p>
      <ul class="grid">
        <li v-for="r in rows" :key="r.letter" class="row" :class="{ ok: r.isAnswer, bad: r.isChosen && !r.isAnswer }">
          <span class="letter">{{ r.letter }}</span>
          <span class="name">{{ r.name }}</span>
          <span v-if="r.isAnswer" class="tag ok"><Check class="ic" :size="12" />{{ t('quiz.review.answerTag') }}</span>
          <span v-else-if="r.isChosen" class="tag bad"><X class="ic" :size="12" />{{ t('quiz.review.chosenTag') }}</span>
        </li>
      </ul>
    </div>

    <!-- ② 图片来源：A → 作者 · 许可证（仅当选项本身是图片时；同样 2×2） -->
    <div v-if="hasAnyMedia" class="block">
      <p class="cap">{{ t('quiz.review.creditsCap') }}</p>
      <ul class="grid credits">
        <li v-for="r in rows" :key="r.letter" class="credit">
          <span class="letter">{{ r.letter }}</span>
          <span class="credit-body">
            <a v-if="r.sourceUrl" :href="r.sourceUrl" target="_blank" rel="noopener noreferrer">{{
              r.source || 'iNaturalist'
            }}</a>
            <span v-else>{{ r.source || 'iNaturalist' }}</span>
            <template v-if="r.author"> · {{ r.author }}</template>
            <template v-if="r.license">
              ·
              <a v-if="r.licenseUrl" :href="r.licenseUrl" target="_blank" rel="noopener noreferrer">{{
                r.license
              }}</a>
              <span v-else>{{ r.license }}</span>
            </template>
          </span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.answer-review {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
}
.block + .block {
  margin-top: 10px;
}
.cap {
  margin: 0 0 6px;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-light);
  letter-spacing: 0.02em;
}
/* 两块都用 2×2 网格（2026-11-03 用户定：两行两列）。
   手机窄屏退回一列，避免长鸟名/长作者名被压成两行以上。 */
.grid {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 10px;
}
@media (max-width: 600px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
.row,
.credit {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 8px;
  border-radius: var(--radius-xs);
  font-size: 0.82rem;
  line-height: 1.5;
}
.row.ok {
  background: #eafaf1;
}
.row.bad {
  background: #fdecee;
}
.letter {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-xs);
  background: #eaf4ef;
  color: var(--primary);
  font-size: 0.7rem;
  font-weight: 800;
}
.row.ok .letter {
  background: var(--correct);
  color: #fff;
}
.row.bad .letter {
  background: var(--wrong);
  color: #fff;
}
.name {
  flex: 1;
  font-weight: 600;
  color: var(--text);
}
.tag {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.7rem;
  font-weight: 700;
}
.tag.ok {
  color: var(--correct);
}
.tag.bad {
  color: var(--wrong);
}
/* 图片来源：小一号、弱色、允许换行 */
.credits .credit {
  font-size: 0.72rem;
  color: var(--text-light);
  padding: 2px 8px;
}
.credit-body {
  flex: 1;
  word-break: break-word;
}
.answer-review a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
