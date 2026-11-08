/**
 * 更新日志（2026-10-26）：站点「更新日志」页的数据源。
 *
 * 为什么是 TS 而不是 JSON：这些字段要参与类型检查与排序，写错 `date` 格式
 * 应该在 `npm run build` 时就红，而不是等用户打开页面才发现白屏。
 *
 * 维护规则：
 *  - **新的在最上面**（页面按数组顺序渲染，不再二次排序）；
 *  - `date` 一律 `YYYY-MM-DD`（构建期由 check-changelog 校验格式与倒序）；
 *  - 每条 `items` 是面向用户的说法，不写 commit hash、不写内部文件名；
 *  - `zh` / `en` 必须同时给，别只写一半。
 */

export interface ChangelogEntry {
  /** 发布日期，YYYY-MM-DD */
  date: string
  zh: {
    title: string
    items: string[]
  }
  en: {
    title: string
    items: string[]
  }
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-11-04',
    zh: {
      title: '称号与徽章改版',
      items: [
        '徽章新增「佩戴」：在徽章页挑一枚随身展示；徽章墙改为网格陈列并标注所属系列',
        '称号页版式精简',
        '「我的」页数据看板：走势图改为平滑曲线，显示平均正确率',
      ],
    },
    en: {
      title: 'Reworked badges and titles',
      items: [
        'Badges can now be worn — pick one to display on the badges page; the badge wall is now a labelled grid',
        'The titles page got a simpler layout',
        'Profile dashboard: trend charts now draw smooth curves and show your average accuracy',
      ],
    },
  },
  {
    date: '2026-11-03',
    zh: {
      title: '加载画面与宣传语 · 同名题干修复',
      items: [
        '练习开始前的准备过程改为专门加载画面（转圈 + 随机宣传语），素材预热并行进行',
        '加载等待时随机显示一条观鸟宣传语（如「不要诱拍！不要诱拍！不要诱拍！」），不带任何标题',
        '修复中文名相同的两个物种出现在同一轮、题干文字完全一样的问题',
      ],
    },
    en: {
      title: 'Loading screen, ethics lines, duplicate-stem fix',
      items: [
        'The round preparation now shows a dedicated loading screen (spinner + a random slogan) while media warms up in parallel',
        'While waiting, a random birding-ethics line is shown (e.g. “No Baiting! No Baiting! No Baiting!”), with no heading attached',
        'Fixed one round showing two questions with identical stems when two different species share the same Chinese name',
      ],
    },
  },
  {
    date: '2026-11-02',
    zh: {
      title: '海报可编辑',
      items: [
        '分享海报支持编辑：可从候选背景中挑选并拖动调整构图',
        '海报自动标注背景图片的鸟名与数据来源',
      ],
    },
    en: {
      title: 'Editable posters',
      items: [
        'Share posters are now editable: pick a background from the candidates and drag to reframe',
        'The poster credits the background photo with the bird name and source automatically',
      ],
    },
  },
  {
    date: '2026-10-31',
    zh: {
      title: '观鸟页大改版：名录并入 · 数据面板 · 省级选区',
      items: [
        '观鸟页改为三个标签：该地鸟种 / 观鸟点 / 名录——名录不再单独跳页',
        '每个地区卡提供三种动作：浏览 / 预习模式 / 鸟点',
        '预习浮窗：换地区、看大图、展开更多素材与鸣声',
        '数据面板：该地鸟种构成与「我已认识」占比一目了然',
        '地区选区细化到省级行政区',
      ],
    },
    en: {
      title: 'Birding page overhaul: catalog built in, data panel, province-level areas',
      items: [
        'The birding page now has three tabs — local species / hotspots / catalog — no more separate catalog hop',
        'Each region card offers three actions: browse / preview / hotspots',
        'Preview panel: switch region, view photos full-size, unfold more media and sounds',
        'Data panel: the area’s species makeup and how much you already know, at a glance',
        'Region selection now goes down to province level',
      ],
    },
  },
  {
    date: '2026-10-29',
    zh: {
      title: '预习模式',
      items: [
        '新增预习模式：按地区把鸟先过一遍——照片、鸣声、大图，再去做题',
        '预习素材标明作者与许可证',
      ],
    },
    en: {
      title: 'Preview mode',
      items: [
        'New preview mode: go through a region’s birds — photos, sounds, full-size views — before you quiz',
        'Preview media credits its author and licence',
      ],
    },
  },
  {
    date: '2026-10-28',
    zh: {
      title: '大众评审页',
      items: [
        '新增大众评审页：管理方发布的纠错在此公开陈列，可查看证据并投票',
        '你提交的纠错被发布后会进入评审页，投票帮助确认处理方式',
      ],
    },
    en: {
      title: 'Community review page',
      items: [
        'New community review page: reports published by the maintainers are listed publicly with their evidence, open for voting',
        'Once your report is published it appears there; votes help confirm how it gets handled',
      ],
    },
  },
  {
    date: '2026-10-27',
    zh: {
      title: '报错可留昵称',
      items: [
        '反馈问题时可填写昵称，用于更正日志的致谢；不填也可以提交',
        '这里填的昵称与「我的」页的昵称互通，填一次两处都在',
        '管理端能看到每条反馈的昵称',
      ],
    },
    en: {
      title: 'Leave a nickname with your report',
      items: [
        'You can add a nickname when reporting an issue, used to credit you in the fix log; leaving it empty is fine',
        'The nickname is shared with the one on your profile page — set it once, it applies to both',
        'The admin view now shows the reporter nickname',
      ],
    },
  },
  {
    date: '2026-10-26',
    zh: {
      title: '新的「关于」页与更新日志',
      items: [
        '「关于」页改为站点版式：项目定位、作答方式、技术栈、数据来源与许可（媒体 / 数据集 / 模型三张明细表）、隐私与联系方式',
        '新增「更新日志」页，按日期倒序记录每次发布的内容',
        '页脚加入更新日志入口',
        '品牌名统一为 UNiaoer，去掉副标题括注',
      ],
    },
    en: {
      title: 'A new About page and a changelog',
      items: [
        'The About page is now a proper site page: what it is, how to answer, tech stack, data sources and licences (three detailed tables for media / datasets / models), privacy and contact',
        'Added a Changelog page listing what changed in each release, newest first',
        'Changelog link added to the footer',
        'The brand is now just UNiaoer, without a bracketed subtitle',
      ],
    },
  },
  {
    date: '2026-10-26',
    zh: {
      title: '计时更公平 · 地区选择更顺手',
      items: [
        '看图题也改成「图片完全显示后才开始计时」，加载慢不再白白扣掉答题时间；音频仍等真正开播才计时',
        '素材加载失败较多时，页面会提示当前网速并建议换到良好网络重新开始',
        'L1–L5 听音版限时单独设定：L1 30s / L2 28s / L3 25s / L4 22s / L5 20s；L6 听音版 20s',
        'L4 看图限时调整为 12s，与 L5（10s + 随机鸟鸣干扰）拉开梯度',
        '地区选择器去掉两层嵌套滚动条，改为整页滚动；选完洲或国家可直接点「完成」收起',
        '中国台湾、中国香港、中国澳门改为列在「中国」下的省级选项，不再与国家并列',
        'L6 两种模式的说明改为「看鸟名选图 / 看鸟名选音」',
      ],
    },
    en: {
      title: 'Fairer timers, smoother region picker',
      items: [
        'Photo questions now start the clock only after the image is fully displayed, so slow loading no longer costs you answering time; audio still waits for actual playback',
        'When many media files fail to load, the page reports your current speed and suggests restarting on a better connection',
        'Separate audio time limits for L1–L5: L1 30s / L2 28s / L3 25s / L4 22s / L5 20s; L6 audio 20s',
        'L4 photo limit adjusted to 12s, opening up the gradient towards L5 (10s with random interference calls)',
        'Removed the nested scrollbars in the region picker — the page scrolls instead; press “Done” to collapse right after picking a continent or country',
        'Taiwan, Hong Kong and Macao now appear as provinces under China instead of standing alongside countries',
        'L6 mode descriptions now read “see the name, choose the photo / sound”',
      ],
    },
  },
  {
    date: '2026-10-24',
    zh: {
      title: '新档位：L6 半鸟人 · L7 鸟娲·造鸟者',
      items: [
        'L6 半鸟人（看名选图 / 看名选音）：题干是鸟名，从 6 张图（限时 10 秒）或 4 段鸣声（限时 25 秒）里选出正确项；干扰项以同科鸟类为主',
        '中文名卷 / 学名卷可切换，统计按卷别分开记账',
        'L7 鸟娲·造鸟者：直接输入鸟名作答',
      ],
    },
    en: {
      title: 'New tiers: L6 Half-Birder and L7 Bird Maker',
      items: [
        'L6 “Half-Birder” (name → photo / sound): the stem is a bird name — pick the match from 6 photos (10s) or 4 sounds (25s); distractors are mostly same-family birds',
        'Switch between Chinese-name and scientific-name papers; stats are kept per paper',
        'L7 “Bird Maker”: type the bird’s name as your answer',
      ],
    },
  },
]
