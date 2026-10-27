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
        '「关于」页改为站点版式：项目定位、玩法、技术栈、数据来源与许可（媒体 / 数据集 / 模型三张明细表）、隐私与联系方式',
        '新增「更新日志」页，按日期倒序记录每次发布的内容',
        '页脚加入更新日志入口',
        '品牌名统一为 UNiaoer，去掉副标题括注',
      ],
    },
    en: {
      title: 'A new About page and a changelog',
      items: [
        'The About page is now a proper site page: what it is, how it plays, tech stack, data sources and licences (three detailed tables for media / datasets / models), privacy and contact',
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
]
