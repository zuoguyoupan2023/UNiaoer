<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { TIMEOUT, useQuizStore, type RegimeCounts } from '@/stores/quiz'
import { useSettingsStore } from '@/stores/settings'
import { preloadQuestions } from '@/core/mediaLoader'
import { listRounds, setActiveArchiveNickname, setProfileNickname } from '@/core/historyDb'
import { ambiencePlayer, interferencePlayer } from '@/core/ambience'
import { AUTO_NEXT_DELAY_WRONG_MS, secondsUntilReveal } from '@/core/pacing'
import { isLeftSwipe } from '@/core/swipe'
import { diagInputSummary, diagMarkAdvance, diagMarkAnswer, isDiag } from '@/core/diag'
import { L8_ENABLED, TIER_LIST, TIERS } from '@/core/difficulty'
import { useMediaGate } from '@/composables/useMediaGate'
import type { TierSuggestion } from '@/core/adaptive'
import {
  AlarmClock,
  ArrowRight,
  AudioLines,
  CircleCheck,
  CircleX,
  Flag,
  Hourglass,
  Image as ImageIcon,
  Keyboard,
  LogOut,
  Play,
  Smartphone,
  Sparkles,
  Timer,
  X,
} from 'lucide-vue-next'
import type { MediaAsset, MediaType, NameMode, QuizRegime, Tier } from '@/types'
import { loadSpeciesAssets, cachedSpeciesAssets } from '@/core/bank'
import { currentLocale } from '@/i18n'
import { loadSpeciesDistribution } from '@/core/speciesIndex'
import { loadProvincesIndex, provinceSecondLevelEnabled, provincesOf, type ProvinceIndex } from '@/core/provinces'
import {
  CONTINENTS,
  CONTINENT_LABEL_KEY,
  continentClickAction,
  COUNTRIES_BY_CONTINENT,
  REGION_LABEL_KEY,
  SUBREGION_OF_CN,
  continentCodeOf,
  continentOf,
  countriesOfContinent,
  isContinentCode,
  type Continent,
  type ContinentCode,
} from '@/core/region'
import { familyDisplay } from '@/i18n/data/family'
import { useDialogA11y } from '@/composables/useDialogA11y'
import AttributionLine from './AttributionLine.vue'
import MediaCard from './MediaCard.vue'
import OptionList from './OptionList.vue'
import QuizPlayMemory from './QuizPlayMemory.vue'
import QuizPlayName from './QuizPlayName.vue'
import QuizPlayInput from './QuizPlayInput.vue'
import ProgressBar from './ProgressBar.vue'
import ReportDialog from './ReportDialog.vue'
import SpeciesGallery from './SpeciesGallery.vue'

const props = defineProps<{ type: MediaType }>()
const router = useRouter()
const quiz = useQuizStore()
const settings = useSettingsStore()
const { t } = useI18n()

/** A2 赛制（013 §4）：与难度正交——赛制定"考哪些鸟"，L1–L5 定"怎么考" */
const REGIMES: { id: QuizRegime; labelKey: string; hintKey: string }[] = [
  { id: 'standard', labelKey: 'regime.standard.label', hintKey: 'regime.standard.hint' },
  { id: 'review', labelKey: 'regime.review.label', hintKey: 'regime.review.hint' },
  { id: 'reinforce', labelKey: 'regime.reinforce.label', hintKey: 'regime.reinforce.hint' },
  { id: 'revival', labelKey: 'regime.revival.label', hintKey: 'regime.revival.hint' },
  { id: 'random', labelKey: 'regime.random.label', hintKey: 'regime.random.hint' },
]

/** 当前模式的已存赛制（013 §4：图/声分离记忆） */
const savedRegime = computed<QuizRegime | undefined>(() =>
  props.type === 'audio' ? settings.regimeAudio : settings.regimeImage,
)
function persistRegime(r: QuizRegime) {
  if (props.type === 'audio') settings.regimeAudio = r
  else settings.regimeImage = r
}
/** 当前模式的已存难度（与赛制一致，图/声分离记忆） */
const savedTier = computed<Tier | undefined>(() =>
  props.type === 'audio' ? settings.tierAudio : settings.tierImage,
)
function persistTier(v: Tier) {
  if (props.type === 'audio') settings.tierAudio = v
  else settings.tierImage = v
}

/**
 * 2026-10-25 用户要求：L6/L7 的说明**只写当前模式**（看图版就只写图、听音版只写音），
 * 与 L1–L5 同规格，不要「图 15s / 音 20s」并列。L6/L7 因此提供 `descKey + 'Audio'` 变体。
 */
function tierDescOf(cfg: (typeof TIER_LIST)[number]): string {
  if (props.type === 'audio') {
    const audioKey = `${cfg.descKey}Audio`
    const text = t(audioKey)
    if (text && text !== audioKey) return text
  }
  return t(cfg.descKey)
}

// ---- 089 §6.1/6.2 + 092：L6/L7/L8 作答模式（语言名 ↔ 学名，图/声 × 档位分别记忆） ----
const nameMode67 = computed<'default' | 'sci'>({
  get: () => {
    const t = tier.value
    if (props.type === 'audio')
      return t === 6
        ? (settings.nameMode6Audio ?? 'default')
        : t === 7
          ? (settings.nameMode7Audio ?? 'default')
          : (settings.nameMode8Audio ?? 'default')
    return t === 6
      ? (settings.nameMode6Image ?? 'default')
      : t === 7
        ? (settings.nameMode7Image ?? 'default')
        : (settings.nameMode8Image ?? 'default')
  },
  set: (v) => {
    const t = tier.value
    if (props.type === 'audio') {
      if (t === 6) settings.nameMode6Audio = v
      else if (t === 7) settings.nameMode7Audio = v
      else settings.nameMode8Audio = v
    } else {
      if (t === 6) settings.nameMode6Image = v
      else if (t === 7) settings.nameMode7Image = v
      else settings.nameMode8Image = v
    }
  },
})
/** 开轮用的 L6/L7/L8 卷别：default → 界面语言（D-1）；sci → 学名卷（D-2） */
function resolvedNameMode67(): NameMode {
  if (nameMode67.value === 'sci') return 'sci'
  return currentLocale() === 'en' ? 'en' : 'zh'
}

/** 卷别提示文案按档位取（L6 选图/选音、L7 输入、L8 记忆翻牌，措辞各不同） */
const modeHintTier = computed<'L6' | 'L7' | 'L8'>(() =>
  tier.value === 7 ? 'L7' : tier.value === 8 ? 'L8' : 'L6',
)

/**
 * 092 + 2026-10-27 用户加：L8 盘面二选一（选中「记忆挑战鸟」档后出现）。
 * standard = 12 对（桌面 6×4 / 手机 4×6，正式阈值）；compact = 6 对 3×4 **实验性缩小盘**
 * （试玩"是否应该降级"，结论后可能移除）。选择持久化在 settings，开轮时 quiz.start 读取。
 */
const memoryBoard = computed<'standard' | 'compact'>({
  get: () => settings.memoryBoardSize ?? 'standard',
  set: (v) => {
    settings.memoryBoardSize = v
  },
})

// ---- 第 1 步：昵称浮窗（013 §3.1；仅此步用浮窗，第 2/3 步落回主界面） ----
const showNameModal = ref(false)
// 无 onClose：昵称浮窗只能「开始 / 直接开始」二选一，ESC 不跳过
const { panelRef: namePanelRef } = useDialogA11y(() => showNameModal.value)
const wizardDraft = ref('')
const wizardStartEnabled = computed(() => {
  const v = wizardDraft.value.trim()
  return v.length >= 2 && v.length <= 12
})

async function wizardSaveNickname() {
  if (!wizardStartEnabled.value) return
  const v = wizardDraft.value.trim()
  settings.nickname = v
  try {
    // 首次向导：同时定名「用户」与当前（首个）档案快照
    await setProfileNickname(v)
    await setActiveArchiveNickname(v)
  } catch {
    /* IndexedDB 不可用时仍保留设备级昵称 */
  }
  showNameModal.value = false
}

/** 「直接开始」：跳过昵称，且不再提示 */
function wizardSkip() {
  settings.nicknameGuideDismissed = true
  showNameModal.value = false
}

// ---- G1 报错按钮：本地记录「图/音/答案有问题」（浮窗见 ReportDialog） ----
const showReport = ref(false)
/** 打开浮窗时锁定当前题面素材（浮窗内不再跟随切换） */
const reportTarget = ref<{
  speciesId: string
  speciesName: string
  sci: string
  questionType: MediaType
  mediaUrl: string
} | null>(null)
function openReport() {
  const q = quiz.current
  if (!q) return
  const media = displayMedia.value ?? q.media
  reportTarget.value = {
    speciesId: media?.speciesId ?? q.media.speciesId,
    speciesName: q.answer,
    sci: q.sci,
    questionType: q.type,
    mediaUrl: media?.url ?? q.media.url,
  }
  showReport.value = true
}
/** 科名「拉丁名+本地名」组合，随 locale 切换（015 #2） */
const familyOf = (fam: string) => familyDisplay(fam, currentLocale())

// 从结果页「再来一轮」进入时，跳过介绍页直接续答（D4）
const started = ref(quiz.pendingContinue && quiz.questions.length > 0)
// L8 未上线（difficulty.L8_ENABLED）时忽略已存的第八档：介绍页没有该按钮，
// 不回退会直接出现 L8 盘面选择并可开轮。2 = quiz store 默认档。
const restoredTier = savedTier.value ?? quiz.tier
const tier = ref<Tier>(restoredTier === 8 && !L8_ENABLED ? 2 : restoredTier)
/** D5：介绍页的档位推荐提示（用户手动改档后清除） */
const adaptiveHint = ref<TierSuggestion | null>(null)
// 赛制：介绍页用已存赛制作为初始值（向导/切换都会写入）
if (savedRegime.value) quiz.regime = savedRegime.value

const intro = computed(() =>
  props.type === 'audio'
    ? { title: t('nav.audioQuiz'), lead: t('quiz.introAudioLead') }
    : { title: t('nav.imageQuiz'), lead: t('quiz.introImageLead') },
)

// ---- 第 2/3 步：水平、形式（主界面完整显示两个区域，直接切换，无「更改」步骤） ----
const regimeCountsData = ref<RegimeCounts | null>(null)
/**
 * 只显示当前可用的赛制（未练过/无错题等不显示；随机赛常驻），减少干扰。
 * 092 §4.5：记忆挑战鸟**不显示复活赛**——它不产生错题（虽然错题本可能有其它档位的记录，
 * 池子非空，这里仍显式排除；文档"复活池恒为空"的前提不成立，故保留一处特判）。
 */
const visibleRegimes = computed(() => {
  const c = regimeCountsData.value?.counts
  const base = c
    ? REGIMES.filter((r) => c[r.id] > 0)
    : REGIMES.filter((r) => r.id === 'standard' || r.id === 'random')
  return tier.value === 8 ? base.filter((r) => r.id !== 'revival') : base
})
function chooseTier(v: Tier) {
  tier.value = v
  persistTier(v)
  adaptiveHint.value = null
  // 029 M2:档位变化会改变池子(L1-L3 地区过滤 / L4-L5 全球),刷新赛制可用数
  void quiz.regimeCounts(props.type, v).then((c) => {
    regimeCountsData.value = c
    const vis = visibleRegimes.value
    if (vis.length && !vis.some((r) => r.id === quiz.regime)) {
      quiz.regime = vis[0]!.id
      persistRegime(quiz.regime)
    }
  }).catch(() => {})
}

/** 029 M2:地区偏好(L1-L4 生效;L5+ 全球开放;2026-10-24 修订)。
 * 087 P0：候选 = 「全球」+ 七大洲分组（全部 249 码），不再有 14 国快捷行。 */
/**
 * 036 省级细分数据（懒加载；失败静默 → 只显示国家级）
 * 2026-10-09 UI 重做（用户反馈）：选择器不再直接铺 14 国按钮（选完看不出选了哪儿），
 * 改为「**已选摘要**（中国·北京）+ 更改」两步流程——默认收起，点「更改」才展开。
 */
const provinceData = ref<ProvinceIndex | null>(null)
/** 087 P0：区系层原始数据（国家 → 物种短码表）。国家徽标=长度；洲徽标=成员国**去重并集**（物种跨国重复，不能直接相加） */
const distByCountry = ref<Record<string, string[]>>({})
const distCounts = computed<Record<string, number>>(() => {
  const out: Record<string, number> = {}
  for (const [cc, list] of Object.entries(distByCountry.value)) out[cc] = list.length
  return out
})
/** 087 P0：展开的大洲（手风琴，一次一个；打开面板时自动展开当前所选国所属洲） */
const openContinent = ref<Continent | null>(null)
/** 087 P0：洲 → 国家/地区分组（全部 249 码；按区系种数降序，再按码序稳定） */
const continentGroups = computed(() =>
  CONTINENTS.map((key) => ({
    key,
    countries: COUNTRIES_BY_CONTINENT[key]
      // 港澳台不再是并列的国家条目：它们的省级条目（CN-71/91/92）已在中国下面
      .filter((code) => !SUBREGION_OF_CN.has(code))
      .map((code) => ({ code, n: distCounts.value[code] ?? 0 }))
      .sort((a, b) => b.n - a.n || a.code.localeCompare(b.code)),
  })),
)
/**
 * 2026-10-25 用户定（问题 1）：**洲标题本身就是选择器**——点洲 = 选中该洲为出题范围
 * 并展开它下面的国家（与「点中国 → 下面展开省」同构）；再点一次收起（收起不改变已选洲）。
 * 原先「上面一行洲直选 + 下面又一组洲手风琴」是重复冗余，已删除。
 */
function toggleContinent(c: Continent) {
  const code = continentCodeOf(c)
  // 判定抽到 core/region.continentClickAction（可单测）：未选中 → 一次点击即选中并展开；
  // 已选中 → 只切换展开/收起（2026-10-25 修复"亚洲要点两次"）
  const act = continentClickAction(code, chosenContinent.value, openContinent.value === c)
  if (act.select) {
    regionChoice.value = code
    void quiz.regimeCounts(props.type, tier.value).then((c2) => (regimeCountsData.value = c2)).catch(() => {})
  }
  openContinent.value = act.open ? c : null
}
/** 洲的物种数徽标 = 成员国区系**去重并集**种数（简单相加会超过全球总数，见 docs/088 §6.1） */
function continentSpeciesCount(c: Continent): number {
  const code = continentCodeOf(c)
  return new Set(countriesOfContinent(code).flatMap((cc) => distByCountry.value[cc] ?? [])).size
}
/** 当前选中的洲（与 openContinent 解耦：收起后高亮仍在） */
const chosenContinent = computed<ContinentCode | null>(() =>
  isContinentCode(regionChoice.value) ? regionChoice.value : null,
)
/** 「全球」快捷项（清空地区选择） */
function chooseGlobal() {
  regionChoice.value = 'ALL'
  regionPickerOpen.value = false
  void quiz.regimeCounts(props.type, tier.value).then((c) => (regimeCountsData.value = c)).catch(() => {})
}
/** 地区选择面板是否展开（收起时只显示已选摘要） */
const regionPickerOpen = ref(false)
const regionChoice = computed({
  get: () => settings.region,
  set: (v: string) => { settings.region = v },
})
/** 固定显示名（CN/港澳台走 i18n，其余走 Intl.DisplayNames）——避免各端 CLDR 差异（见 core/region.ts） */
const displayNamesCache = new Map<string, Intl.DisplayNames>()
function regionLabel(code: string): string {
  const key = REGION_LABEL_KEY[code]
  if (key) return t(key)
  try {
    const locale = currentLocale()
    // 087 P0：洲分组一次渲染 ~250 个码，缓存 DisplayNames 实例（按 locale）
    let dn = displayNamesCache.get(locale)
    if (!dn) {
      dn = new Intl.DisplayNames([locale], { type: 'region' })
      displayNamesCache.set(locale, dn)
    }
    return dn.of(code) ?? code
  } catch {
    return code
  }
}
/** 新手福利提示（2026-10-09）：该档案尚无任何轮次 + L1 → 显示"第一轮只出最常见鸟" */
const firstRoundEver = ref(false)
onMounted(async () => {
  void listRounds()
    .then((rs) => (firstRoundEver.value = rs.length === 0))
    .catch(() => (firstRoundEver.value = false))
  // 036：省级细分（可选；失败不影响国家级选择）。P1-6：只读索引（省名 + 分片清单），不读记录数分片
  void loadProvincesIndex().then((d) => (provinceData.value = d))
  try {
    const dist = await loadSpeciesDistribution()
    // 087 P0 / 088 方案 B：区系层原始表（国家徽标与洲并集徽标共用）
    if (dist) distByCountry.value = dist.byCountry as Record<string, string[]>
  } catch {
    /* 区系层不可用:洲分组徽标显示 0（列表仍完整），全球/选择不受影响 */
  }
})
function chooseRegion(v: string) {
  regionChoice.value = v
  // 换国家时清掉省选择（省码属于原国家）
  regionProvince.value = ''
  // 2026-10-25 用户反馈：原先"无省级细分的国家直接收起面板"，导致选完菲律宾后没法接着点亚洲。
  // 现在**面板保持展开**（选择结果已在「已选摘要」实时更新），用户可继续换国家/改选洲。
  // 083 的收起名单仍生效：只是不显示省 chips，不影响面板本身。
  regionPickerOpen.value = true
  void quiz.regimeCounts(props.type, tier.value).then((c) => (regimeCountsData.value = c)).catch(() => {})
}

/**
 * 036：省级细分（可选）。选中后 region 变成省码（如 CN-11），出题走**该省**的地区档位；
 * 不选则用国家级档位（降级链：省 → 国家 → 全局 commonness）。
 * 仅在所选国家有省级数据（15 国）时显示。
 */
const regionProvince = ref(settings.region.includes('-') ? settings.region : '')
const provinceChoices = computed(() => {
  const data = provinceData.value
  const cc = selectedCountry.value
  if (!data || !cc || cc === 'ALL') return []
  // 083：镇级/微型国收起省级出题选择（与 hasProvinces 同口径）
  if (!provinceSecondLevelEnabled(data, cc)) return []
  return provincesOf(data, cc, currentLocale())
})
/**
 * regionChoice ↔ regionProvince 同步（2026-10-09 修正）：
 * `settings.region` 是**唯一真源**，省选择是它的派生视图——
 * - regionChoice 为省码（CN-11）→ 同步 regionProvince；
 * - 变为纯国家码（CN）或 ALL → 省选择跟随清空（防跨国残留）。
 * （旧实现按"country 前缀"判断，会把省码自己误判为"不属于该国"而清掉。）
 */
watch(regionChoice, (v) => {
  if (v.includes('-')) {
    regionProvince.value = v
    return
  }
  if (regionProvince.value && !regionProvince.value.startsWith(v + '-')) regionProvince.value = ''
})
/** 087 P0：展开选择面板时，自动展开当前所选国所属的洲（少一次寻找） */
watch(regionPickerOpen, (open) => {
  if (!open) return
  const c = continentOf(selectedCountry.value)
  if (c) openContinent.value = c
})
function chooseRegionProvince(code: string) {
  // 再点一次同省 = 取消省细分（回到纯国家）
  const next = regionProvince.value === code ? '' : code
  regionChoice.value = next || selectedCountry.value
  regionPickerOpen.value = false
  void quiz.regimeCounts(props.type, tier.value).then((c) => (regimeCountsData.value = c)).catch(() => {})
}
/** 当前所选国家（省选择被清空时回退到它） */
const selectedCountry = computed(() => {
  const r = regionChoice.value
  if (SUBREGION_OF_CN.has(r)) return 'CN' // 旧存档里的 HK/MO/TW → 归到中国下面
  return r.includes('-') ? r.split('-')[0]! : r
})
/**
 * 已选地区摘要（用户 2026-10-09 反馈：必须一眼看出"我选了哪儿"）。
 * 形态：「全球」/「中国」/「中国 · 北京」（英文：Beijing, China）。
 */
const regionSummary = computed(() => {
  const r = regionChoice.value
  if (!r || r === 'ALL') return t('quiz.regionAll')
  if (isContinentCode(r)) return t(CONTINENT_LABEL_KEY[r])
  const cc = selectedCountry.value
  const country = regionLabel(cc)
  const provName = regionProvince.value
    ? provinceChoices.value.find((p) => p.code === regionProvince.value)?.name
    : ''
  return provName ? `${country} · ${provName}` : country
})
/**
 * 当前赛制在**当前档位**下能出多少题（null = 尚未取到；072-a-fix-5）。
 * 097：这个数已按地区（含港澳台并集）→ 档位表 → 命名体系收窄，随 L 档位与赛制变化，
 * 不再是"省码塌成国家码"的中国全境数。
 */
const currentRegimeCount = computed<number | null>(() => {
  const c = regimeCountsData.value?.counts
  if (!c) return null
  const n = c[quiz.regime]
  return typeof n === 'number' ? n : null
})
/**
 * 括号标注用的取数比例（097 十档制）：该档的常见度档位覆盖占十档的比例。
 * L1 = 70%（7/10 档）、L2/L3 = 80%、L4/L5 = 90%、L6/L7/L8 = 100%。
 * 与出题池同源（都由 TIERS[tier].commonness 定义），数字与标注不会互相矛盾。
 * ALL/洲走「全球档位表」（同为十等分），比例与国家/省一致，无需特判。
 */
const tierCoveragePct = computed<number>(() =>
  Math.round(((TIERS[tier.value]?.commonness.length ?? 10) / 10) * 100),
)
function chooseRegime(r: QuizRegime) {
  quiz.regime = r
  persistRegime(r)
}

/** 进入介绍页：决定是否弹昵称浮窗、可用赛制（不可用则回退首个可用） */
async function initIntro() {
  if (!settings.nickname && !settings.nicknameGuideDismissed) showNameModal.value = true
  try {
    regimeCountsData.value = await quiz.regimeCounts(props.type, tier.value)
  } catch {
    regimeCountsData.value = null
  }
  const vis = visibleRegimes.value
  if (vis.length && !vis.some((r) => r.id === quiz.regime)) {
    quiz.regime = vis[0]!.id
    persistRegime(quiz.regime)
  }
  // D5 自适应难度：按最近表现推荐档位（不改用户记忆的档位以外的行为；手动可改回）
  if (settings.adaptiveTier) {
    try {
      const s = await quiz.tierSuggestion(props.type, tier.value)
      if (s.change !== 'stay') {
        tier.value = s.tier
        persistTier(s.tier)
        adaptiveHint.value = s
      }
    } catch {
      /* IndexedDB 不可用：保持当前档 */
    }
  }
}

const timedOut = computed(() => quiz.currentChoice === TIMEOUT)
const isCorrect = computed(() => quiz.answered && quiz.currentChoice === quiz.current?.answer)

// ---- 072-a 说明：本组题量不足时**明确告知**（用户 2026-10-22 定：允许不足但说明）----
const shortRoundNote = computed(() => {
  const d = quiz.lastBuild
  if (!d || d.built >= d.want) return ''
  return t('quiz.shortRound', { built: d.built, want: d.want })
})

// ---- 072-a 观测：诊断行（默认关闭，只有 ?diag=1 才渲染；普通用户零影响）----
const diagOn = isDiag()
const diagHead = computed(() => {
  const d = quiz.lastBuild
  if (!d) return ''
  return t('quiz.diagHead', {
    tier: t(TIERS[d.tier].labelKey),
    region: d.region && d.region !== 'ALL' ? ` · ${d.region}` : '',
    regime: t(`regime.${d.regime}.label`),
  })
})
/** 选项残留观测摘要（切题/作答后重算；非 diag 恒空） */
const diagInput = computed(() => {
  // 依赖：题号与已答数量变化 → 重算
  void quiz.index
  void quiz.answeredCount
  return diagOn ? diagInputSummary() : ''
})
const diagBody = computed(() => {
  const d = quiz.lastBuild
  if (!d) return ''
  const path =
    d.path === 'online'
      ? t('quiz.diagPathOnline', {
          from: d.onlineFrom === 'client' ? t('quiz.diagFromCache') : t('quiz.diagFromNet'),
          hits: d.onlineHits ?? 0,
          total: d.onlineTotal ?? 0,
        })
      : d.path === 'online-fallback'
        ? t('quiz.diagPathFallback', { hits: d.onlineHits ?? 0, total: d.onlineTotal ?? 0 })
        : t('quiz.diagPathLocal')
  return t('quiz.diagBody', {
    pool: d.regimePool ?? '-',
    cand: d.candidates,
    after: d.afterFilter,
    drop: d.dropped,
    path,
    built: d.built,
    want: d.want,
  })
})

// ---- C3 同种多素材查看（R8）：可切换该鸟的其它图/音，并支持跨类型 ----
/** 用户手动选择的素材（null = 用题目默认题面） */
const selected = ref<MediaAsset | null>(null)
watch(
  () => quiz.current?.id,
  () => {
    selected.value = null
  },
)
/** 同类型全部素材（buildQuestions 提供，不按档位裁剪，L1 也全给）；缺省回退当前题面 */
const samePool = computed<MediaAsset[]>(() => {
  const q = quiz.current
  if (!q) return []
  return q.assets && q.assets.length ? q.assets : [q.media]
})
/** 另一类型池（跨类型：看图题听鸟鸣 / 听音题看图） */
const crossPool = computed<MediaAsset[]>(() => quiz.current?.crossAssets ?? [])

/**
 * 029 M1:core 层只带首图首音；画廊的「同种多素材」(C3) 按需从 assets 分片补齐。
 * 当前题物种的分片加载完成后（按桶缓存，一次请求）合并进两池；
 * 加载中先用 core 的首图首音，不阻塞答题。
 */
const lazyPool = computed<{ images: MediaAsset[]; audios: MediaAsset[] }>(() => {
  const id = quiz.current?.media?.speciesId
  const hit = cachedSpeciesAssets(id)
  return { images: hit?.images ?? [], audios: hit?.audios ?? [] }
})
watch(
  () => quiz.current?.media?.speciesId,
  (id) => {
    if (id) void loadSpeciesAssets(id)
  },
  { immediate: true },
)
/** 合并去重（以 url 为键；core 首图在前，分片补齐其余） */
function mergePool(base: MediaAsset[], extra: MediaAsset[]): MediaAsset[] {
  if (!extra.length) return base
  const seen = new Set(base.map((m) => m.url))
  return [...base, ...extra.filter((m) => !seen.has(m.url))]
}
/** 当前真正展示的素材 */
const displayMedia = computed<MediaAsset | null>(
  () => selected.value ?? quiz.current?.media ?? samePool.value[0] ?? null,
)
/** 当前展示类型（跨类型切换时会变） */
const displayType = computed<MediaType>(
  () => displayMedia.value?.type ?? quiz.current?.type ?? props.type,
)
const galleryImages = computed<MediaAsset[]>(() =>
  quiz.current?.type === 'image'
    ? mergePool(samePool.value, lazyPool.value.images)
    : mergePool(crossPool.value, lazyPool.value.images),
)
const galleryAudios = computed<MediaAsset[]>(() =>
  quiz.current?.type === 'audio'
    ? mergePool(samePool.value, lazyPool.value.audios)
    : mergePool(crossPool.value, lazyPool.value.audios),
)

/** 「下一题」；最后一题改为「查看结果」（没有第 11 题） */
const nextLabel = computed(() =>
  quiz.index + 1 >= quiz.total ? t('quiz.viewResult') : t('quiz.next'),
)

// ---- 计时 ----
const timeLeft = ref<number | null>(null)
/** 本题计时是否已真正开始（媒体就绪后才开始，2026-10-26） */
const timerBegun = ref(false)
let tick: number | undefined

/**
 * 媒体就绪门：图等 `<img>` load（慢则 1s 兜底），音等真正开播。
 * 网络造成的等待不计入答题时间。
 */
const gate = useMediaGate()

/** D1：限时题前段隐藏选项（缺省 1/3；L1 固定前 5s），revealInSec 为出现前倒计时秒数 */
const revealInSec = computed(() => {
  if (quiz.answered || !quiz.current) return null
  const q = quiz.current
  return secondsUntilReveal(q.timeLimitSec, timeLeft.value, TIERS[q.tier]?.optionRevealSec)
})
const optionsHidden = computed(() => revealInSec.value !== null)

function stopTimer() {
  if (tick !== undefined) {
    clearInterval(tick)
    tick = undefined
  }
}

/** 把计时冻结在满值显示（听音版音频未开播时不倒数，R24） */
function resetTimer() {
  stopTimer()
  const q = quiz.current
  timeLeft.value = q?.timeLimitSec ?? null
}

/** 真正开始倒数：看图=切题即开始；听音=考题音频开播后（R24） */
function startTimer() {
  resetTimer()
  if (timeLeft.value === null || quiz.answered) return
  tick = window.setInterval(() => {
    if (timeLeft.value === null) return
    timeLeft.value -= 1
    if (timeLeft.value <= 0) {
      stopTimer()
      quiz.timeUp()
    }
  }, 1000)
}

// ---- D2 自动下一题 / R43 浮窗与取消 ----
const autoPending = ref(false)
/** 本题是否被用户点了「取消切换」（只影响这一次） */
const cancelledThisQuestion = ref(false)
let autoNextTimer: number | undefined
/** 浮窗倒计时（秒，015 #4：精确到 0.1s 实时递减） */
const autoNextRemaining = ref<number | null>(null)
let autoNextTicker: number | undefined

/** 是否处于"会自动切换"的情形：「都自动」=任意；「答对自动」=仅答对 */
const willAuto = computed(() => {
  const mode = settings.autoNext
  return mode === 'all' || (mode === 'correct' && isCorrect.value)
})
/** 自动切换中：显示浮窗 */
const showToast = computed(() => quiz.answered && willAuto.value && !cancelledThisQuestion.value)
/** 其余已作答情形（手动 / 不触发自动 / 取消本次后）：下方常驻 */
const showInline = computed(() => quiz.answered && !showToast.value)
/** 常驻反馈块（作答后焦点移入，读屏播报） */
const feedbackRef = ref<HTMLElement | null>(null)
/** 「不再自动切换」仅在"取消本次"后出现 */
const showDisableBtn = computed(
  () => quiz.answered && cancelledThisQuestion.value && settings.autoNext !== 'manual',
)
/** 彻底手动时出现「自动切换」 */
const showEnableBtn = computed(() => quiz.answered && settings.autoNext === 'manual')

function stopCountdown() {
  if (autoNextTicker !== undefined) {
    clearInterval(autoNextTicker)
    autoNextTicker = undefined
  }
  autoNextRemaining.value = null
}

function clearAutoNext() {
  if (autoNextTimer !== undefined) {
    clearTimeout(autoNextTimer)
    autoNextTimer = undefined
  }
  stopCountdown()
  autoPending.value = false
}

function scheduleAutoNext() {
  clearAutoNext()
  if (!willAuto.value) return
  autoPending.value = true
  // 答对：用户设置的 0.5/1/2/3s（默认 3s，072-h）；「都自动」时的错题/超时固定 4s
  // （错题要留足时间看正确答案，不跟答对走同一档）
  const delay = isCorrect.value
    ? Math.round(settings.autoNextDelaySec * 1000)
    : AUTO_NEXT_DELAY_WRONG_MS
  // 浮窗实时倒计时（0.1s 步进，015 #4）
  const deadline = Date.now() + delay
  autoNextRemaining.value = delay / 1000
  autoNextTicker = window.setInterval(() => {
    const left = (deadline - Date.now()) / 1000
    autoNextRemaining.value = left > 0 ? left : 0
    if (left <= 0) stopCountdown()
  }, 100)
  autoNextTimer = window.setTimeout(() => {
    autoNextTimer = undefined
    autoPending.value = false
    quiz.next()
  }, delay)
}

function goNext() {
  clearAutoNext()
  quiz.next()
}

/** 取消切换：只停"本次"自动切换 → 回落下方常驻，并出现「不再自动切换」（R43） */
function cancelAutoOnce() {
  clearAutoNext()
  cancelledThisQuestion.value = true
}

/** 不再自动切换：与设置互通，后续一律手动（R43） */
function disableAuto() {
  clearAutoNext()
  settings.autoNext = 'manual'
  cancelledThisQuestion.value = false
}

/** 手动模式点「自动切换」：恢复默认"答对自动"，并在本题已答对时立即开始倒计时（R43） */
function enableAuto() {
  settings.autoNext = 'correct'
  scheduleAutoNext()
}

/** 计时变红的最后秒数：L4/L5 为 3s，其余 5s（R30） */
const warnThreshold = computed(() => (quiz.current && quiz.current.tier >= 4 ? 3 : 5))

/** 中途退出测试：已作答部分按"截至成绩"落库（错题本/统计同步），未答题目不计 */
function quitRound() {
  const n = quiz.answeredCount
  const msg =
    n > 0
      ? t('quiz.quitConfirmDetail', { n, total: quiz.total })
      : t('quiz.quitConfirmEmpty')
  if (!confirm(msg)) {
    // 隐藏徽章"浪子回头"：点了取消留下来继续答（R28）
    quiz.escapedQuit = true
    return
  }
  stopTimer()
  clearAutoNext()
  interferencePlayer.stop()
  if (n === 0) {
    quiz.reset()
    router.push('/')
    return
  }
  quiz.truncateTo(n)
  router.push('/result') // ResultView 落库：截断后的轮次 + 错题本 + 徽章
}

async function begin() {
  started.value = true
  // 环境鸟鸣是全局功能，但测试开始后不播放（选难度阶段不算开始，见 R23）
  ambiencePlayer.stop()
  // 087 §4.8 + 089 §6.2 + 092：L6/L7/L8 也是普通开轮——store 内按档位分支到对应构建器；
  // 计时/作答交互由嵌入的各答题组件自管，经典链路零改动。卷别按模式选择传入。
  await quiz.start(props.type, {
    tier: tier.value,
    ...(tier.value >= 6 ? { nameMode: resolvedNameMode67() } : {}),
  })
  if (quiz.error || !quiz.questions.length) return // 错误区接管
  if (quiz.tier === 8) return // 记忆挑战鸟：盘面素材由 QuizPlayMemory 自预热（缩略图）
  preloadQuestions(quiz.questions, 0, quiz.tier >= 6 ? 2 : 4)
  if (quiz.tier >= 6) return // L6/L7 的计时起点由各自答题组件挂载时启动
  beginQuestionTiming()
  updateInterference()
}

/**
 * 2026-10-25（问题 3）：选项作答的唯一入口——写答案前先留一条诊断轨迹（仅 ?diag=1 生效）。
 * 观测目标：手机上「下一题第一个选项莫名已被选中」；来源 click/key 且距切题 <600ms 视为可疑
 * （幽灵点击/DOM 复用残留），console.warn 里带 UA 与毫秒数，便于复现定位。
 */
/**
 * 2026-10-25（问题 3）：移动端「幽灵点击」防护。
 *
 * 成因：切题瞬间手指仍在屏幕上的那次触摸，其 `click`（或部分 WebKit 的延迟 click）
 * 可能补发到**新题的按钮**上 → 下一题第一个选项莫名被选中（桌面无此路径）。
 *
 * 判定（精确，不误伤手快用户）：只有在**切题之前**按下的指针（pointerdown 落在旧题），
 * 其后续 click 落到新题才算幽灵点击。人手正常作答必然是「先 pointerdown、再 click」，
 * 且 pointerdown 一定发生在当前题显示之后，故不会被拦。
 */
let advancedAt = 0
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
/** 最近一次 pointerdown 是否发生在**上一次切题之前**（true = 该指针跨题，其 click 应忽略） */
let pointerBeforeAdvance = false

function onPointerDownCapture() {
  pointerBeforeAdvance = nowMs() < advancedAt
}

function onSelectOption(value: string, source: 'click' | 'key' = 'click') {
  const q = quiz.current
  if (!q) return
  // 幽灵点击：该次交互的 pointerdown 发生在切题之前（跨题残留）→ 忽略这次 click
  if (source === 'click' && pointerBeforeAdvance) {
    diagMarkAnswer({
      questionIndex: quiz.index,
      questionId: q.id,
      value,
      source,
      autoPending: autoPending.value,
    })
    pointerBeforeAdvance = false
    return
  }
  diagMarkAnswer({
    questionIndex: quiz.index,
    questionId: q.id,
    value,
    source,
    autoPending: autoPending.value,
  })
  quiz.answer(value)
}

/** 媒体加载失败过多时的提示（带实时网速，帮助判断是不是网络问题） */
const networkNote = computed(() => {
  const speed = gate.speedMbps.value
  return speed === null
    ? t('quiz.networkPoorUnknown')
    : t('quiz.networkPoor', { speed: speed.toFixed(1) })
})

/** 每题计时/干扰的启动点：等题面媒体就绪（图 load / 音开播），网络等待不计时 */
function beginQuestionTiming() {
  timerBegun.value = false
  // 图：等 image-settled（1s 兜底）；音：等 audio-play，缓冲多久等多久（不设兜底）
  gate.reset(1, props.type === 'image', quiz.current?.media?.url)
  // 听音：音频可能永远播不出来（文件坏/解码失败），10s 后放行并记为失败
  if (props.type === 'audio') gate.armStall()
  resetTimer() // 冻结在满值，等就绪信号
  // reset 可能已同步放行（ready 从 false→true 在同一 tick，watch 看不到）；这里补一次
  if (gate.ready.value) onGateReady()
}

/** 题面媒体就绪（图片 load / 1s 兜底 / 音频开播）：开始倒数 */
function onGateReady() {
  if (quiz.answered || timerBegun.value) return
  timerBegun.value = true
  startTimer()
  updateInterference()
}

/** 听音版考题音频开播：计时开始；L5 地狱此时才启动干扰音 */
function onQuestionAudioPlay() {
  gate.release()
}

/** 图片加载成功/失败：交给门禁计数（失败达 1/3 时门禁自行测速） */
function onImageSettled(ok: boolean) {
  if (ok) gate.markLoaded()
  else gate.markFailed()
}

// 门禁放行即开始计时（图片慢/失败兜底、音频开播都在这里汇合）
watch(
  () => gate.ready.value,
  (ok) => {
    if (ok) onGateReady()
  },
)

/** L5 地狱干扰：看图 2 条切题即启；听音 1 条等考题音频开播；作答即停 */
function updateInterference() {
  const q = quiz.current
  if (quiz.tier !== 5 || !q || quiz.answered || !timerBegun.value) {
    interferencePlayer.stop()
    return
  }
  void interferencePlayer.start(q.type === 'image' ? 2 : 1, q.type === 'image' ? 0.35 : 0.25)
}

onMounted(() => {
  document.addEventListener('keydown', onKey)
  if (quiz.pendingContinue && quiz.questions.length > 0 && quiz.tier >= 6) {
    // 087 §4.8：L6 的「再来一轮」——started 跳过介绍页，pendingContinue 留给嵌入的
    // QuizPlayName 消费（计时/预载由它做），经典链路不碰。
    started.value = true
    return
  }
  if (quiz.pendingContinue) {
    quiz.pendingContinue = false
    // 从结果页续轮也是"测试开始"：环境鸟鸣停播
    ambiencePlayer.stop()
    preloadQuestions(quiz.questions, 0, 4)
    beginQuestionTiming()
    updateInterference()
  } else {
    // 清掉上一轮残留（结果页/切模式后再进入时），让介绍页回到"非答题中"状态
    quiz.questions = []
    quiz.chosen = []
    quiz.index = 0
    void initIntro() // 决定昵称浮窗 / 可用赛制 / 新档分步
  }
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  stopTimer()
  clearAutoNext()
  interferencePlayer.stop()
})

watch(
  () => quiz.index,
  (i) => {
    if (quiz.tier >= 6) return // 087 §4.8/089：L6/L7 由各自答题组件自管（计时/预载）
    clearAutoNext()
    cancelledThisQuestion.value = false
    advancedAt = nowMs() // 幽灵点击静默期起点
    diagMarkAdvance() // 诊断：记录切题时刻（?diag=1 才生效）
    preloadQuestions(quiz.questions, i + 1, 3) // 之后 3 题
    beginQuestionTiming() // 计时起点：看图立即 / 听音等音频开播（R24）
    updateInterference()
  },
)
watch(
  () => quiz.answered,
  (a) => {
    if (quiz.tier >= 6) return // 089：L6/L7 的作答反馈/自动切题由各自答题组件管
    if (a) {
      stopTimer()
      scheduleAutoNext()
      // 作答后选项全部 disabled、焦点脱落：手动场景把焦点移到反馈块（role=status 同步播报）
      void nextTick(() => {
        if (showInline.value) feedbackRef.value?.focus()
      })
    } else {
      clearAutoNext()
      cancelledThisQuestion.value = false
    }
    updateInterference() // 作答后停止干扰；进入下一题（未作答）再开启
  },
)
watch(
  () => quiz.finished,
  (f) => {
    // 087 §4.8：L6 的完成跳转由 QuizPlayName 自己做（避免双跳）
    if (f && quiz.tier < 6) router.push('/result')
  },
)

function onKey(e: KeyboardEvent) {
  // 087 §4.8：L6 答题中快捷键由 QuizPlayName 处理（它的选项是媒体，键位语义不同）
  if (quiz.current && quiz.current.tier >= 6) return
  // 弹层打开时答题快捷键让位；带修饰键的组合（如 Cmd/Ctrl+A）不是答题意图
  if (showNameModal.value || showReport.value) return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const el = e.target
  if (
    el instanceof HTMLElement &&
    (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))
  ) {
    return
  }
  const q = quiz.current
  if (!q) return

  // 已作答：→ / 空格 = 下一题
  if (quiz.answered) {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.code === 'Space') {
      e.preventDefault()
      goNext()
    }
    return
  }

  if (optionsHidden.value) return
  const map: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3, a: 0, b: 1, c: 2, d: 3 }
  const idx = map[e.key.toLowerCase()]
  if (idx !== undefined) {
    const opt = q.options[idx]
    if (opt) onSelectOption(opt, 'key')
  }
}

// ---- D3 触屏左滑 = 下一题 ----
let touchStart: { x: number; y: number } | null = null

function onTouchStart(e: TouchEvent) {
  const t = e.changedTouches?.[0]
  touchStart = t ? { x: t.clientX, y: t.clientY } : null
}

function onTouchEnd(e: TouchEvent) {
  const start = touchStart
  touchStart = null
  const t = e.changedTouches?.[0]
  if (!start || !t || !quiz.answered) return
  if (isLeftSwipe(t.clientX - start.x, t.clientY - start.y)) goNext()
}
</script>

<template>
  <!-- 第 1 步：昵称浮窗（仅此步用浮窗；第 2/3 步在主界面） -->
  <Teleport to="body">
    <div
      v-if="showNameModal"
      class="wizard-overlay"
      role="dialog"
      aria-modal="true"
      :aria-label="t('quiz.wizardTitle')"
    >
      <div ref="namePanelRef" class="wizard-panel">
        <h3 class="wizard-title">{{ t('quiz.wizardWelcome') }}</h3>
        <input
          v-model="wizardDraft"
          class="wizard-input"
          maxlength="12"
          :aria-label="t('profile.nicknameLabel')"
          :placeholder="t('profile.nicknamePlaceholder')"
          @keyup.enter="wizardSaveNickname"
        />
        <!-- 028/076：首次建身份时当场告知匿名统计（默认开，可取消；设置页同一开关） -->
        <label class="wizard-metrics">
          <input v-model="settings.metricsEnabled" type="checkbox" />
          <span class="wizard-metrics-text">
            <strong>{{ t('settings.metricsTitle') }}</strong>
            <span class="muted">{{ t('profile.metricsHint') }}</span>
          </span>
        </label>
        <div class="wizard-actions">
          <button
            class="btn btn-primary"
            :disabled="!wizardStartEnabled"
            @click="wizardSaveNickname"
          >
            {{ t('quiz.wizardStart') }}
          </button>
          <button class="btn btn-secondary" @click="wizardSkip">{{ t('quiz.wizardSkip') }}</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- G1 报错浮窗（本地记录 + 可选昵称） -->
  <ReportDialog
    v-if="reportTarget"
    v-model:open="showReport"
    :species-id="reportTarget.speciesId"
    :species-name="reportTarget.speciesName"
    :sci="reportTarget.sci"
    :question-type="reportTarget.questionType"
    :media-url="reportTarget.mediaUrl"
  />

  <!-- 介绍页：第 2 步 水平（L1–L6）→ 第 3 步 地区 → 第 4 步 形式（087 §4.8：L6 是第六档） -->
  <section v-if="!started" class="card intro">
    <div class="intro-head">
      <div class="intro-icon">
        <AudioLines v-if="type === 'audio'" :size="30" />
        <ImageIcon v-else :size="30" />
      </div>
      <h2>{{ intro.title }}</h2>
    </div>
    <p class="lead muted">{{ intro.lead }}</p>

    <p v-if="quiz.regime === 'revival'" class="wrong-hint">
      <CircleX class="ic" :size="15" /> {{ t('quiz.wrongPoolHint') }}
    </p>

    <!-- 第 1 步 水平（087 §4.8：L1–L6，L6 就是第六档，不做独立题型） -->
    <p class="step-cap"><i class="step-no">1</i>{{ t('quiz.stepLevel') }}</p>
    <div class="tiers">
      <button
        v-for="cfg in TIER_LIST"
        :key="cfg.tier"
        class="tier"
        :class="{ on: tier === cfg.tier }"
        @click="chooseTier(cfg.tier)"
      >
        <strong>{{ t(cfg.labelKey) }}</strong>
        <span>{{ tierDescOf(cfg) }}</span>
      </button>
    </div>
    <!-- 089 §6.1/6.2 + 092：L6/L7/L8 作答模式（语言名/学名）——高两档+记忆档显示，不计步骤号 -->
    <template v-if="tier >= 6">
      <p class="step-cap l6-mode-cap">{{ t('quiz6.modeCap') }}</p>
      <div class="tiers l6-mode">
        <button type="button" class="tier" :class="{ on: nameMode67 === 'default' }" @click="nameMode67 = 'default'">
          <strong>{{ t('quiz6.modeLang') }}</strong>
          <span>{{ t(`quiz6.modeLangHint${modeHintTier}`) }}</span>
        </button>
        <button type="button" class="tier" :class="{ on: nameMode67 === 'sci' }" @click="nameMode67 = 'sci'">
          <strong>{{ t('quiz6.modeSci') }}</strong>
          <span>{{ t(`quiz6.modeSciHint${modeHintTier}`) }}</span>
        </button>
      </div>
    </template>
    <!-- 092 + 2026-10-27：L8 盘面二选一——只在「记忆挑战鸟」被选中后出现（缩小盘为实验档） -->
    <template v-if="tier === 8">
      <p class="step-cap l6-mode-cap">{{ t('memory.boardCap') }}</p>
      <div class="tiers l6-mode">
        <button
          type="button"
          class="tier"
          :class="{ on: memoryBoard === 'standard' }"
          @click="memoryBoard = 'standard'"
        >
          <strong>{{ t('memory.boardStd') }}</strong>
          <span>{{ t('memory.boardStdHint') }}</span>
        </button>
        <button
          type="button"
          class="tier"
          :class="{ on: memoryBoard === 'compact' }"
          @click="memoryBoard = 'compact'"
        >
          <strong>{{ t('memory.boardMini') }}</strong>
          <span>{{ t('memory.boardMiniHint') }}</span>
        </button>
      </div>
    </template>
    <!-- 第 2 步 区域（2026-10-25 全档统一：任何档位任选 省/国家/洲/全球） -->
    <p class="step-cap"><i class="step-no">2</i>{{ t('quiz.stepRegion') }}</p>
      <!-- 087 P0-4：一句简洁的提问，替代干巴巴的步骤名 -->
      <p class="region-ask">{{ t('quiz.regionAsk') }}</p>
      <p v-if="tier === 1 && firstRoundEver" class="beginner-hint">
        <Sparkles class="ic" :size="14" /> {{ t('quiz.beginnerHint') }}
      </p>
      <!-- 已选摘要（默认收起）：一眼看出"选了哪儿"；点「更改」才展开选择器 -->
      <div class="region-summary">
        <span class="region-current">
          <span class="region-cap muted small">{{ t('quiz.regionCurrent') }}</span>
          <strong class="region-value">{{ regionSummary }}</strong>
        </span>
        <button
          type="button"
          class="region-change"
          :aria-expanded="regionPickerOpen"
          @click="regionPickerOpen = !regionPickerOpen"
        >
          {{ regionPickerOpen ? t('quiz.regionDone') : t('quiz.regionChange') }}
        </button>
      </div>
      <div v-if="regionPickerOpen" class="region-picker">
        <!-- 2026-10-25（问题 1 修正）：任何档位任选 洲/国家/省/全球。
             洲标题**本身即选择器**：点洲 = 选中该洲 + 在其下展开国家（点国家再展开省）——
             与「点中国 → 下面展开省」同构；不再有「上面一行洲直选 + 下面又一组洲」的重复。 -->
        <div class="regions">
          <button
            type="button"
            class="tier region"
            :class="{ on: regionChoice === 'ALL' }"
            :title="t('quiz.regionHint')"
            @click="chooseGlobal"
          >
            <strong>{{ t('quiz.regionAll') }}</strong>
          </button>
        </div>
        <p class="continent-cap muted small">{{ t('region.continentsLabel') }}</p>
        <div class="continents">
          <div v-for="g in continentGroups" :key="g.key" class="continent">
            <button
              type="button"
              class="continent-head"
              :class="{ on: chosenContinent === continentCodeOf(g.key) }"
              :aria-expanded="openContinent === g.key"
              @click="toggleContinent(g.key)"
            >
              <span>{{ t(`region.continents.${g.key}`) }}</span>
              <span class="count">{{ continentSpeciesCount(g.key) }}</span>
              <span class="chev" aria-hidden="true">{{ openContinent === g.key ? '−' : '+' }}</span>
            </button>
            <div v-if="openContinent === g.key" class="regions continent-body">
              <template v-for="opt in g.countries" :key="opt.code">
                <button
                  type="button"
                  class="tier region"
                  :class="{ on: regionChoice === opt.code || selectedCountry === opt.code }"
                  @click="chooseRegion(opt.code)"
                >
                  <strong>{{ regionLabel(opt.code) }}</strong>
                  <span class="count">{{ opt.n }}</span>
                </button>
                <!-- 087 P0-3：省级 chips 内联在所选国家正下方（层级即所见；083 收起名单照旧生效） -->
                <div v-if="opt.code === selectedCountry && provinceChoices.length" class="provinces inline">
                  <span class="prov-cap muted small">{{ t('quiz.regionProvinceCap') }}</span>
                  <div class="prov-wrap">
                    <button
                      v-for="p in provinceChoices"
                      :key="p.code"
                      class="prov-pill"
                      :class="{ on: regionProvince === p.code }"
                      @click="chooseRegionProvince(p.code)"
                    >
                      {{ p.name }}
                    </button>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    <p v-if="adaptiveHint" class="adaptive-hint">
      {{
        t(adaptiveHint.change === 'up' ? 'quiz.adaptiveUp' : 'quiz.adaptiveDown', {
          n: adaptiveHint.sample,
          acc: adaptiveHint.accuracy,
          tier: t(TIERS[adaptiveHint.tier].labelKey),
        })
      }}
    </p>

    <!-- 第 3 步 形式（只显示当前可用赛制） -->
    <p class="step-cap"><i class="step-no">3</i>{{ t('quiz.stepForm') }}</p>
    <!-- 097：主数字 = 本档这一赛制能出多少题（随档位/赛制变化）；括号标注取数逻辑——
         该数字占该地区鸟种总数的比例（= 档位覆盖：L1/L4/L5 取最常见 40%、L2/L3 取 60%、
         L6/L7/L8 取满 100%）。比例由 TIERS[tier].commonness 的档位数/5 推导，与出题池同源。 -->
    <p v-if="currentRegimeCount !== null" class="regime-pool muted small">
      {{ t(`regime.${quiz.regime}.label`) }}：{{
        t('quiz.regimePoolTier', { n: currentRegimeCount, pct: tierCoveragePct })
      }}
    </p>
    <div class="regimes">
      <button
        v-for="r in visibleRegimes"
        :key="r.id"
        class="tier regime"
        :class="{ on: quiz.regime === r.id }"
        @click="chooseRegime(r.id)"
      >
        <strong>{{ t(r.labelKey) }}</strong>
        <span>{{ t(r.hintKey) }}</span>
      </button>
    </div>

    <button class="btn btn-primary" @click="begin">{{ t('quiz.start') }}</button>
  </section>

  <!-- 加载中（092：记忆挑战不预取后续题；图/音文案各自分开，绝不混写） -->
  <section v-else-if="quiz.loading" class="card center placeholder">
    <div class="spinner"></div>
    <h2>{{ t(quiz.tier === 8 ? 'quiz.preparingMemory' : 'quiz.preparing') }}</h2>
    <p class="muted">
      {{
        t(
          quiz.tier === 8
            ? type === 'audio'
              ? 'quiz.preparingSubMemoryAudio'
              : 'quiz.preparingSubMemoryImage'
            : 'quiz.preparingSub',
        )
      }}
    </p>
  </section>

  <!-- 出错 -->
  <section v-else-if="quiz.error" class="card center placeholder">
    <div class="emoji">🗂️</div>
    <h2>{{ t('quiz.cannotStart') }}</h2>
    <p class="muted">{{ t(`errors.${quiz.error}`) }}</p>
    <p style="margin-top: 18px">
      <RouterLink class="btn btn-secondary" to="/">{{ t('quiz.backHome') }}</RouterLink>
    </p>
  </section>

  <!-- 087 §4.8：L6 答题区——嵌入组件自管计时/预载/作答/自动切题/退出 -->
  <QuizPlayName v-else-if="quiz.tier === 6" :type="type" />
  <!-- 089：L7 答题区（输入题）——自管计时（音从开播起）/素材切换/IME/判分反馈 -->
  <QuizPlayInput v-else-if="quiz.tier === 7" :type="type" />
  <!-- 092：L8 记忆挑战鸟答题区（翻牌配对）——自管盘面/正计时/音频自动播放/退出 -->
  <QuizPlayMemory v-else-if="quiz.tier === 8" :type="type" />

  <!-- 答题 -->
  <template v-else-if="quiz.current">
    <ProgressBar :current="quiz.index + (quiz.answered ? 1 : 0)" :total="quiz.total" />
    <!-- 072-a：题量不足时明确说明原因（不再是"静默少几题"） -->
    <p v-if="shortRoundNote" class="short-round-note" role="status">{{ shortRoundNote }}</p>
    <!-- 媒体加载失败过多：明确提示换网络重开（不静默扣时间） -->
    <p v-if="gate.shouldPromptRetry.value" class="network-note" role="alert">
      {{ networkNote }}
    </p>
    <!-- 072-a 观测：诊断行（仅 ?diag=1 显示；见 core/diag.ts）+ 选项残留观测（2026-10-25） -->
    <p v-if="diagOn && diagHead" class="diag-line" data-testid="diag-line">
      {{ diagHead }}<br /><span class="diag-body">{{ diagBody }}</span>
      <template v-if="diagInput"><br /><span class="diag-input">{{ diagInput }}</span></template>
    </p>
    <!-- 状态行：左=难度 · 中=题号 · 右=计时/正确率（R24 三栏紧凑布局） -->
    <div class="status-bar">
      <span class="sb-left">
        <span class="tier-tag">{{ t(TIERS[quiz.current.tier].labelKey) }}</span>
      </span>
      <span class="sb-mid">{{ t('quiz.progress', { n: quiz.index + 1, total: quiz.total }) }}</span>
      <span class="sb-right">
        <!-- 媒体未就绪：加载期占住计时位，明确告诉用户"还没开始算时间" -->
        <span v-if="!gate.ready.value && !quiz.answered" class="timer loading">
          <span class="spin" aria-hidden="true"></span> {{ t('quiz.loadingMedia') }}
        </span>
        <span v-else-if="timeLeft !== null && !quiz.answered" class="timer" :class="{ warn: timeLeft <= warnThreshold }">
          <Timer class="ic" :size="14" /> {{ timeLeft }}s
        </span>
        <span v-else>{{
          quiz.answered || quiz.index > 0
            ? t('quiz.accuracyLabel', { acc: quiz.accuracy })
            : '--'
        }}</span>
      </span>
    </div>

    <div
      class="card"
      @touchstart.passive="onTouchStart"
      @touchend="onTouchEnd"
      @pointerdown.capture="onPointerDownCapture"
    >
      <MediaCard
        :key="quiz.current.id"
        :type="displayType"
        :media="displayMedia ?? quiz.current.media"
        :autoplay="quiz.current.type === 'audio' && quiz.index >= 1 && settings.autoplayAudio"
        :autoplay-delay="settings.autoplayDelayMs"
        :show-attribution="false"
        @audio-play="onQuestionAudioPlay"
        @image-settled="onImageSettled"
      >
        <template #media-corner>
          <button class="quit-corner" type="button" @click="quitRound">
            <LogOut class="ic" :size="13" /> {{ t('quiz.quit') }}
          </button>
        </template>
      </MediaCard>

      <!-- C3 同种多素材（R8）：查看并切换该鸟的其它图/音（含跨类型；L1 也展示全部） -->
      <SpeciesGallery
        :images="galleryImages"
        :audios="galleryAudios"
        :active-url="displayMedia?.url"
        mode="select"
        :label="t('gallery.title')"
        @select="selected = $event"
      />

      <!-- G1 报错按钮：图/音/答案有问题 → 先本地记录 -->
      <button class="report-link" type="button" @click="openReport">
        <Flag class="ic" :size="14" /> {{ t('report.button') }}
      </button>

      <OptionList
        :key="quiz.current.id"
        :options="quiz.current.options"
        :answer="quiz.current.answer"
        :chosen="quiz.currentChoice"
        :hidden="optionsHidden"
        :reveal-in-sec="revealInSec"
        :mode="quiz.current.type"
        @select="onSelectOption"
      />

      <!-- 自动切换中：浮窗（答对 3s / 都自动的错题 4s），可「取消切换」（R43） -->
      <Transition name="toast">
        <div
          v-if="showToast"
          class="correct-toast"
          :class="{ 'is-wrong': !isCorrect }"
          role="status"
          aria-live="polite"
        >
          <div class="ct-row">
            <CircleCheck v-if="isCorrect" class="ic" :size="20" />
            <CircleX v-else class="ic" :size="20" />
            <div class="ct-main">
              <strong v-if="isCorrect">{{ t('quiz.correct') }}</strong>
              <strong v-else-if="timedOut">{{ t('quiz.timeout') }}</strong>
              <strong v-else>{{ t('quiz.wrong') }}</strong>
              <span>
                {{ t('quiz.correctAnswer') }}<b>{{ quiz.current.answer }}</b>{{
                  t('quiz.answerSci', { sci: quiz.current.sci })
                }}
              </span>
            </div>
          </div>
          <div class="ct-auto">
            <span class="ct-count" aria-hidden="true">
              <Hourglass class="ic" :size="13" />
              {{ t('quiz.autoAdvancing', { sec: (autoNextRemaining ?? 0).toFixed(1) }) }}
            </span>
            <button class="btn-mini" type="button" @click="cancelAutoOnce">{{ t('quiz.cancelAuto') }}</button>
            <button class="btn-mini ct-next" type="button" @click="goNext">{{ nextLabel }}</button>
          </div>
        </div>
      </Transition>

      <!-- 下方常驻反馈：手动 / 不触发自动 / 取消了本次自动 时显示 -->
      <div
        v-if="showInline"
        ref="feedbackRef"
        class="feedback"
        :class="isCorrect ? 'ok' : 'no'"
        role="status"
        tabindex="-1"
      >
        <strong v-if="timedOut"><AlarmClock class="ic" :size="16" /> {{ t('quiz.timeout') }}</strong>
        <strong v-else-if="isCorrect"><CircleCheck class="ic" :size="16" /> {{ t('quiz.correct') }}</strong>
        <strong v-else><CircleX class="ic" :size="16" /> {{ t('quiz.wrong') }}</strong>
        {{ t('quiz.correctAnswer') }}<b>{{ quiz.current.answer }}</b>{{
          t('quiz.answerSci', { sci: quiz.current.sci })
        }}
        <span class="muted"> · {{ familyOf(quiz.current.family) }}</span>
      </div>

      <!-- 「不再自动切换」仅在取消本次后出现；彻底手动时出现「自动切换」 -->
      <div v-if="showDisableBtn || showEnableBtn" class="auto-ctrl">
        <button v-if="showDisableBtn" class="btn-mini" type="button" @click="disableAuto">
          <X class="ic" :size="12" /> {{ t('quiz.disableAuto') }}
        </button>
        <button v-else-if="showEnableBtn" class="btn-mini" type="button" @click="enableAuto">
          <Play class="ic" :size="12" /> {{ t('quiz.enableAuto') }}
        </button>
      </div>

      <!-- 自动切换浮窗期间隐藏主按钮（避免重复）；取消/手动时恢复显示 -->
      <div v-if="showInline" class="actions">
        <button class="btn btn-primary" @click="goNext">
          {{ nextLabel }}
          <ArrowRight class="ic" :size="16" />
        </button>
      </div>
      <div v-if="quiz.answered && !autoPending" class="quiz-foot">
        <span class="foot-hint">
          <Keyboard class="ic" :size="13" /> {{ t('quiz.footPress') }}
          <ArrowRight class="ic" :size="12" /> {{ t('quiz.footOrSpace') }} ·
          <Smartphone class="ic" :size="13" /> {{ t('quiz.footSwipe') }}
        </span>
      </div>

      <!-- 署名信息移到卡片最底部，避免干扰（R41）；切换素材后跟随当前素材 -->
      <AttributionLine class="quiz-attr" :media="displayMedia ?? quiz.current.media" />
    </div>
  </template>
</template>

<style scoped>
/* 072-a 观测：诊断行（默认不渲染；?diag=1 才出现）。小字、弱色、允许换行，不干扰答题。 */
.diag-line {
  font-size: 0.7rem;
  line-height: 1.45;
  color: var(--text-light);
  background: #f3f4f2;
  border: 1px dashed #d8dcd4;
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  margin: 0 0 8px;
  word-break: break-word;
  font-variant-numeric: tabular-nums;
}
.short-round-note {
  font-size: 0.75rem;
  color: #8a6d00;
  background: #fdf3d8;
  border-radius: var(--radius-sm);
  padding: 5px 10px;
  margin: 0 0 8px;
}
.network-note {
  font-size: 0.75rem;
  color: #8a3b2e;
  background: #fdeae6;
  border-radius: var(--radius-sm);
  padding: 5px 10px;
  margin: 0 0 8px;
}
.timer.loading .spin {
  display: inline-block;
  width: 9px;
  height: 9px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: gate-spin 0.8s linear infinite;
}
@keyframes gate-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .timer.loading .spin {
    animation: none;
  }
}
.diag-body {
  color: var(--text-light);
  opacity: 0.92;
}
.diag-input {
  color: #8a5a00;
}
.intro {
  text-align: center;
}
/* 图标与标题同行，压缩介绍页高度（R26） */
.intro-head {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 8px;
}
.intro-head h2 {
  margin: 0;
  font-size: 1.25rem;
}
.intro-icon {
  display: flex;
  color: var(--primary);
  animation: float 3s ease-in-out infinite;
}
.intro .lead {
  margin-bottom: 18px;
}
.wrong-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  margin-bottom: 14px;
  border-radius: var(--radius);
  background: #fdecee;
  color: var(--wrong);
  font-size: 0.82rem;
  font-weight: 600;
}
.wizard-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(10, 30, 22, 0.55);
  backdrop-filter: blur(6px);
}
.wizard-panel {
  width: min(480px, 100%);
  background: #fff;
  border-radius: var(--radius);
  padding: 24px;
  box-shadow: 0 30px 80px -30px rgba(0, 0, 0, 0.6);
}
.wizard-title {
  font-size: 1.15rem;
  font-weight: 800;
  color: var(--primary-dark);
  text-align: center;
  margin-bottom: 6px;
}
.wizard-sub {
  font-size: 0.82rem;
  color: var(--text-light);
  text-align: center;
  margin-bottom: 14px;
}
.wizard-input {
  width: 100%;
  padding: 10px 14px;
  border: 2px solid var(--primary-light);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 0.95rem;
  margin-bottom: 16px;
}
/* 028/076：首次建身份时的匿名统计告知（默认勾选，可当场取消） */
.wizard-metrics {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 11px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  font-size: 0.74rem;
  line-height: 1.45;
  text-align: left;
  cursor: pointer;
}
.wizard-metrics input {
  margin-top: 2px;
  flex-shrink: 0;
}
.wizard-metrics-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.wizard-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 16px;
}
.wizard-actions .btn {
  flex: 1;
}
.wizard-actions .btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}
/* 第 3 步 形式：与第 2 步 水平按钮同层级同风格（按钮本身复用 .tier 样式） */
.regimes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  max-width: 520px;
  margin: 0 auto 10px;
}
/* 029 M2：地区偏好（chips 自动换行；仅 L1–L3 显示） */
/* 已选摘要 + 更改（2026-10-09：选完必须一眼看出选了哪儿） */
.beginner-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0 auto 10px;
  padding: 5px 12px;
  border-radius: 999px;
  background: #fff7e6;
  color: #8a5a00;
  font-size: 0.76rem;
  font-weight: 600;
}
.region-summary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 0 auto 10px;
  max-width: 560px;
}
.region-current {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  padding: 7px 14px;
  border: 2px solid var(--primary);
  border-radius: var(--radius-sm);
  background: #eaf4ef;
}
.region-cap {
  font-size: 0.7rem;
}
.region-value {
  font-size: 0.92rem;
  color: var(--primary-dark, var(--primary));
}
.region-change {
  padding: 7px 14px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text);
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
}
.region-change:hover {
  border-color: var(--primary-light);
}
.region-picker {
  margin-bottom: 6px;
}
.provinces {
  margin-top: 8px;
  text-align: left;
}
.prov-cap {
  display: block;
  margin-bottom: 4px;
}
.prov-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.prov-pill {
  padding: 3px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--text-light);
  font-size: 0.72rem;
  cursor: pointer;
}
.prov-pill.on {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
  font-weight: 700;
}
.regions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  max-width: 560px;
  margin: 0 auto 10px;
}
.regions .tier.region {
  padding: 7px 12px;
  min-height: 0;
}
.regions .tier.region strong {
  font-size: 0.86rem;
  font-weight: 600;
}
/* 087 P0：洲 → 国家/地区 手风琴分组（全部 249 码；国家徽标 = 区系种数，如实标注） */
.continent-cap {
  text-align: center;
  margin: 2px auto 6px;
}
.continents {
  max-width: 560px;
  margin: 0 auto 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  text-align: left;
}
.continent + .continent {
  border-top: 1px solid var(--border);
}
.continent-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 9px 14px;
  border: none;
  background: #fff;
  font-family: inherit;
  font-size: 0.86rem;
  font-weight: 700;
  color: var(--text);
  cursor: pointer;
}
.continent-head:hover {
  background: #f3fbf7;
}
.continent-head .chev {
  color: var(--text-light);
  font-weight: 600;
}
/* 2026-10-25：洲标题即选择器——选中态与展开态都要能看出来 */
.continent-head.on {
  background: #eaf4ef;
  color: var(--primary-dark);
}
.continent-head .count {
  margin-left: auto;
  margin-right: 8px;
  padding: 0 7px;
  border-radius: 999px;
  background: #eaf4ef;
  color: var(--primary);
  font-size: 0.68rem;
  font-weight: 700;
  line-height: 1.7;
  font-variant-numeric: tabular-nums;
}
.continent-head.on .count {
  background: #d7ece2;
}
/* 洲/国家/省三层都内联展开，靠页面整体滚动查看（不做嵌套滚动条） */
.continent-body {
  padding: 0 10px 10px;
}
.continent-body .tier.region {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.tier.region .count {
  margin-left: 2px;
  padding: 0 6px;
  border-radius: 999px;
  background: #eaf4ef;
  color: var(--primary);
  font-size: 0.68rem;
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 520px) {
  .regimes {
    grid-template-columns: 1fr;
  }
}
/* 089 §6.2：L6 作答模式行（紧凑两枚，不带步骤号） */
.l6-mode-cap {
  margin-top: -10px;
}
.l6-mode {
  max-width: 420px;
  margin-bottom: 18px;
}
.l6-mode .tier {
  padding: 8px 14px;
}
/* 087 P0-4：地区步骤的提问句（替代干巴巴的步骤名） */
.region-ask {
  margin: 0 auto 10px;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text);
}
/* 087 P0-3：省级 chips 内联在所选国家正下方 */
.provinces.inline {
  flex-basis: 100%;
  margin: 2px 0 6px;
}
/* 区域标题：2 · 水平 / 3 · 形式 */
.step-cap {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 8px 0 8px;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-light);
}
.step-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  font-size: 0.72rem;
  font-style: normal;
}
.nickname-guide {
  max-width: 420px;
  margin: 0 auto 14px;
  padding: 12px 16px;
  border: 2px solid var(--primary-light);
  border-radius: var(--radius-sm);
  background: #f3fbf7;
}
.guide-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--primary-dark);
  margin-bottom: 8px;
}
.guide-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.guide-input {
  flex: 1;
  min-width: 140px;
  padding: 7px 12px;
  border: 2px solid var(--primary-light);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 0.9rem;
}
.tiers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  max-width: 520px;
  margin: 0 auto 22px;
}
@media (max-width: 520px) {
  .tiers {
    grid-template-columns: 1fr;
  }
}
.adaptive-hint {
  max-width: 520px;
  margin: -12px auto 22px;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  background: #eaf4ef;
  color: var(--primary-dark);
  font-size: 0.78rem;
  text-align: center;
}
.tier {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 12px 16px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  cursor: pointer;
  text-align: left;
  transition: all 0.18s ease;
}
/* 5 个档位时最后一个奇数位横跨两列，避免孤行 */
.tier:last-child:nth-child(odd) {
  grid-column: 1 / -1;
}
.tier:hover {
  border-color: var(--primary-light);
}
.tier.on {
  border-color: var(--primary);
  background: #f3fbf7;
}
.tier strong {
  font-size: 0.9rem;
}
.tier span {
  font-size: 0.74rem;
  color: var(--text-light);
}
.intro .btn {
  min-width: 180px;
}
/* 状态行：左=难度 · 中=题号 · 右=计时/正确率（R24 三栏紧凑布局） */
.status-bar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 0.78rem;
}
.sb-left {
  justify-self: start;
}
.sb-mid {
  font-weight: 700;
  color: var(--text);
}
.sb-right {
  justify-self: end;
  font-weight: 700;
  color: var(--text);
  display: inline-flex;
  align-items: center;
}
.tier-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: var(--radius-xs);
  background: #eaf4ef;
  color: var(--primary);
  font-size: 0.68rem;
}
.timer {
  font-variant-numeric: tabular-nums;
  background: #eaf4ef;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
}
.timer.warn {
  color: var(--wrong);
  background: #fdecee;
  font-size: 1rem; /* R30：警告期字号变大（比正常大 2 号），更醒目 */
  animation: pulse 1s infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
.feedback {
  margin-top: 16px;
  padding: 15px 18px;
  border-radius: var(--radius);
  font-size: 0.9rem;
  line-height: 1.7;
  animation: pop 0.3s ease;
}
.feedback.ok {
  background: linear-gradient(135deg, #eafaf1, #d8f3dc);
  border-left: 5px solid var(--correct);
}
.feedback.no {
  background: #fdecee;
  border-left: 5px solid var(--wrong);
}
.feedback strong {
  display: block;
  margin-bottom: 5px;
}
/* 作答后焦点被程序移入（读屏播报），本身不是可交互元素，不画焦点框 */
.feedback:focus {
  outline: none;
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}
.actions .btn {
  flex: 1;
}
.quiz-foot {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: 0.75rem;
  color: var(--text-light);
}
.foot-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
/* 署名移到卡片最底部（R41） */
.quiz-attr {
  margin-top: 14px;
}
/* 自动切换浮窗（R43）：可点击「取消切换」，取消后回落到下方常驻 */
.correct-toast {
  position: fixed;
  /* left/right 0 + margin auto 居中：避开 left:50% 时可用宽度只剩 50vw 的坑，
     浮窗可在整幅宽度内取 fit-content，倒计时数字变化不再触发折行抖动 */
  left: 0;
  right: 0;
  bottom: 21vh;
  z-index: 80;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: fit-content;
  max-width: min(92vw, 560px);
  padding: 12px 18px;
  border-radius: var(--radius);
  background: linear-gradient(135deg, #eafaf1, #d8f3dc);
  border: 1px solid var(--correct);
  box-shadow: 0 18px 40px -18px rgba(20, 52, 42, 0.6);
  text-align: center;
}
.correct-toast.is-wrong {
  background: linear-gradient(135deg, #fdecee, #fbd8dc);
  border-color: var(--wrong);
}
.ct-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.correct-toast .ic {
  color: var(--correct);
  flex-shrink: 0;
}
.correct-toast.is-wrong .ic {
  color: var(--wrong);
}
.ct-main {
  display: flex;
  flex-direction: column;
  min-width: 0; /* 允许在浮窗宽度内换行，不撑破 */
  line-height: 1.35;
  text-align: left;
  overflow-wrap: anywhere;
}
.ct-main strong {
  font-size: 0.92rem;
  color: var(--correct);
}
.correct-toast.is-wrong .ct-main strong {
  color: var(--wrong);
}
.ct-main span {
  font-size: 0.8rem;
  color: var(--text-light);
}
.ct-auto {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  row-gap: 8px;
  /* 不强制同行：倒计时与按钮放不下时整行折行，避免浮窗宽度抖动 */
  flex-wrap: wrap;
}
.ct-count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.74rem;
  color: var(--primary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums; /* 数字等宽：2.3/1.9/0.8 宽度一致 */
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
/* 自动切换控制行（R43） */
.auto-ctrl {
  margin-top: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}
.btn-mini {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  background: #f0f4f2;
  color: var(--text-light);
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}
.btn-mini:hover {
  color: var(--primary);
  border-color: var(--primary-light);
  background: #eaf4ef;
}
/* 浮窗内的「下一题/查看结果」：宽度贴合文字（不撑满），更醒目 */
.ct-next {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.ct-next:hover {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
  filter: brightness(0.94);
}
.quit-corner {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.88);
  color: var(--text-light);
  font-size: 0.72rem;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: all 0.18s ease;
}
.quit-corner:hover {
  color: var(--wrong);
  border-color: var(--wrong);
  background: #fff;
}
.spinner {
  width: 46px;
  height: 46px;
  border: 5px solid #dceee4;
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
  margin: 0 auto 16px;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes pop {
  0% {
    transform: scale(0.96);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
}
/* ---- G1 报错 ---- */
.report-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 4px 0 0 10px;
  padding: 0;
  border: none;
  background: none;
  color: var(--text-light);
  font-size: 0.78rem;
  cursor: pointer;
  vertical-align: middle;
}
.report-link:hover {
  color: var(--primary);
}
</style>
