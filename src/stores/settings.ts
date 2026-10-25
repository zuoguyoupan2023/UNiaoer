import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { AutoNextDelaySec, AutoNextMode, LicensePolicy, QuizRegime, Tier } from '@/types'
import { setLocale, currentLocale as i18nCurrentLocale, type AppLocale } from '@/i18n'

// v2：音频自动播放默认由「关」改为「开」（见 006），旧键不复用以免沿用旧默认
const STORAGE_KEY = 'uniaoer.settings.v2'

interface Persisted {
  /** 许可策略：固定宽松（R31，不再向用户展示） */
  licensePolicy: LicensePolicy
  autoplayAudio: boolean
  autoplayDelayMs: number
  autoNext: AutoNextMode
  autoNextDelaySec: AutoNextDelaySec
  /** 环境鸟鸣：被取消勾选的音轨 id（默认全部勾选，见 006 R22） */
  ambienceExcluded: string[]
  /** 佩戴的称号轨道 id（009）；null = 不佩戴 */
  wornTitle: string | null
  /** 佩戴的徽章 id（009）；null = 不佩戴 */
  wornBadge: string | null
  /** 已自动佩戴过首枚称号/徽章（固定规则：仅首枚自动佩戴，R32） */
  titleAutoWorn: boolean
  badgeAutoWorn: boolean
  /** 环境鸟鸣开关（R30）：默认开启，进入应用自动播放（被浏览器拦截则在首次手势后重试） */
  ambienceEnabled: boolean
  /** 用户昵称（R33，2–12 字符；海报与「我的」页显示） */
  nickname: string
  /** 界面语言（i18n-6；缺省由 i18n 模块的 savedLocale()/detectLocale() 决定） */
  locale?: AppLocale
  /** A1 昵称引导：用户点过「先跳过」后不再提示（013 §3.1 可跳过） */
  nicknameGuideDismissed?: boolean
  /** A2 赛制按图/声分别记忆（向导完成后写入；013 §4，看图/听声互不影响） */
  regimeImage?: QuizRegime
  regimeAudio?: QuizRegime
  /** A2 难度按图/声分别记忆（与赛制一致，013 §4 官能正交） */
  tierImage?: Tier
  tierAudio?: Tier
  /**
   * L6 半鸟人作答模式（089 §6.2 恢复，图/声分离）：'default' = 语言名（跟随界面语言），
   * 'sci' = 学名卷。L7 上线时沿用同一形态。
   */
  nameMode6Image?: 'default' | 'sci'
  nameMode6Audio?: 'default' | 'sci'
  /** D5 自适应难度：按最近表现自动升降档（默认开） */
  adaptiveTier?: boolean
  /** 029 M2:出题地区偏好（ISO 3166-1 alpha-2；'ALL'=不按地区过滤）。L1-L3 生效 */
  region?: string
  /**
   * 028 匿名计量开关（默认开，D-028-1）：只做**事件计数**（无 cookie/设备标识/IP）。
   * 关闭后前端完全不上报（设置页披露）。
   */
  metricsEnabled?: boolean
  /**
   * 076 省级归属地统计（**默认关**，需用户主动勾选）：
   * 开启后 Worker 才会按 `request.cf` 派生省级码并写入聚合（不存 IP）。
   * 与 `metricsEnabled` 是两件事：关掉匿名统计则两项都不上报。
   */
  metricsGeo?: boolean
}

function load(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : {}
  } catch {
    return {}
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const saved = load()

  /** 许可策略：固定宽松（R31，不再作为用户可配置项） */
  const licensePolicy = ref<LicensePolicy>('relaxed')
  /** 音频自动播放：默认开；第 1 题手动，第 2 题起自动（可在设置中改回每题手动） */
  const autoplayAudio = ref<boolean>(saved.autoplayAudio ?? true)
  /** 自动播放延迟（ms） */
  const autoplayDelayMs = ref<number>(saved.autoplayDelayMs ?? 2000)
  /** 自动进入下一题：默认答对后等 2s（见 006 D2） */
  const autoNext = ref<AutoNextMode>(saved.autoNext ?? 'correct')
  /** 072-h：答对后等待秒数（默认 3 = 与旧行为一致） */
  const autoNextDelaySec = ref<AutoNextDelaySec>(saved.autoNextDelaySec ?? 3)
  /** 环境鸟鸣：取消勾选的音轨（默认全部勾选；新增音轨默认生效） */
  const ambienceExcluded = ref<string[]>(saved.ambienceExcluded ?? [])
  /** 佩戴称号（轨道 id；称号文本由当前数据实时派生） */
  const wornTitle = ref<string | null>(saved.wornTitle ?? null)
  /** 佩戴徽章（徽章 id，R31） */
  const wornBadge = ref<string | null>(saved.wornBadge ?? null)
  /** 已自动佩戴过首枚称号（固定规则：仅首枚自动佩戴，之后手动更换，R32） */
  const titleAutoWorn = ref<boolean>(saved.titleAutoWorn ?? false)
  const badgeAutoWorn = ref<boolean>(saved.badgeAutoWorn ?? false)
  /** 环境鸟鸣开关（默认开；用户手动关闭后记住，不再自动播放） */
  const ambienceEnabled = ref<boolean>(saved.ambienceEnabled ?? true)
  /** 用户昵称（R33：2–12 字符，可编辑） */
  const nickname = ref<string>(saved.nickname ?? '')
  /**
   * 界面语言（i18n-6）：初始值以 i18n 实例当前值为准（其创建时已按 savedLocale ?? detectLocale 决定），
   * 本地持久化由下面的 watch 统一落盘；写入即同步 i18n 与 <html lang>。
   */
  const locale = ref<AppLocale>(i18nCurrentLocale())
  /** A1 昵称引导跳过标记（013 §3.1） */
  const nicknameGuideDismissed = ref<boolean>(saved.nicknameGuideDismissed ?? false)
  /** A2 赛制（图/声分离记忆；向导完成后持久化，下次直接进入） */
  const regimeImage = ref<QuizRegime | undefined>(saved.regimeImage)
  const regimeAudio = ref<QuizRegime | undefined>(saved.regimeAudio)
  /** A2 难度（图/声分离记忆；与赛制一致） */
  const tierImage = ref<Tier | undefined>(saved.tierImage)
  const tierAudio = ref<Tier | undefined>(saved.tierAudio)
  /** L6 作答模式（089 §6.2：语言名/学名，图/声分别记忆） */
  const nameMode6Image = ref<'default' | 'sci'>(saved.nameMode6Image ?? 'default')
  const nameMode6Audio = ref<'default' | 'sci'>(saved.nameMode6Audio ?? 'default')
  /** L6 半鸟人卷别（docs/085 D-2：switch 切换，'default' 跟随界面语言 / 'sci' 学名卷） */
  /** D5 自适应难度：默认开；开启后介绍页会按最近表现推荐档位，"再来一轮"也会自动升降 */
  const adaptiveTier = ref<boolean>(saved.adaptiveTier ?? true)
  /** 029 M2:出题地区偏好（默认 ALL=不过滤；L1-L3 按此过滤全球池） */
  const region = ref<string>(saved.region ?? 'ALL')
  /** 028 匿名计量开关（默认开；关闭即完全不上报） */
  const metricsEnabled = ref<boolean>(saved.metricsEnabled ?? true)
  /** 076 省级归属地统计（**默认关**：处理 IP 归属地，必须显式同意；见 docs/076） */
  const metricsGeo = ref<boolean>(saved.metricsGeo ?? false)

  // 切语言：写 store 即同步 i18n 实例与 <html lang>（UI 只改 settings.locale）
  watch(locale, (v) => {
    setLocale(v)
  })

  watch(
    [
      licensePolicy,
      autoplayAudio,
      autoplayDelayMs,
      autoNext,
      autoNextDelaySec,
      ambienceExcluded,
      wornTitle,
      wornBadge,
      titleAutoWorn,
      badgeAutoWorn,
      ambienceEnabled,
      nickname,
      locale,
      nicknameGuideDismissed,
      regimeImage,
      regimeAudio,
      tierImage,
      tierAudio,
      nameMode6Image,
      nameMode6Audio,
      adaptiveTier,
      region,
      metricsEnabled,
      metricsGeo,
    ],
    () => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            licensePolicy: licensePolicy.value,
            autoplayAudio: autoplayAudio.value,
            autoplayDelayMs: autoplayDelayMs.value,
            autoNext: autoNext.value,
            autoNextDelaySec: autoNextDelaySec.value,
            ambienceExcluded: ambienceExcluded.value,
            wornTitle: wornTitle.value,
            wornBadge: wornBadge.value,
            titleAutoWorn: titleAutoWorn.value,
            badgeAutoWorn: badgeAutoWorn.value,
            ambienceEnabled: ambienceEnabled.value,
            nickname: nickname.value,
            locale: locale.value,
            nicknameGuideDismissed: nicknameGuideDismissed.value,
            regimeImage: regimeImage.value,
            regimeAudio: regimeAudio.value,
            tierImage: tierImage.value,
            tierAudio: tierAudio.value,
            nameMode6Image: nameMode6Image.value,
            nameMode6Audio: nameMode6Audio.value,
            adaptiveTier: adaptiveTier.value,
            region: region.value,
            metricsEnabled: metricsEnabled.value,
            metricsGeo: metricsGeo.value,
          } satisfies Persisted),
        )
      } catch {
        /* localStorage 不可用（file:// 等）时忽略 */
      }
    },
    { flush: 'post' },
  )

  return {
    licensePolicy,
    autoplayAudio,
    autoplayDelayMs,
    autoNext,
    autoNextDelaySec,
    ambienceExcluded,
    wornTitle,
    wornBadge,
    titleAutoWorn,
    badgeAutoWorn,
    ambienceEnabled,
    nickname,
    locale,
    nicknameGuideDismissed,
    regimeImage,
    regimeAudio,
    tierImage,
    tierAudio,
    nameMode6Image,
    nameMode6Audio,
    adaptiveTier,
    region,
    metricsEnabled,
    metricsGeo,
  }
})
