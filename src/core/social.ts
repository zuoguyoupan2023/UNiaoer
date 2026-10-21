/**
 * 公开链接（页脚 / 关于）
 *
 * ## 小红书为什么不是普通链接
 *
 * 小红书**没有**「按小红书号直达主页」的公开 URL：
 *   · 网页版 profile 路径要 **24 位内部 user id**（`/user/profile/<24hex>`），不是小红书号；
 *   · 网页搜索（`/search_result?keyword=…`）未登录会落到「页面不见」/登录页；
 *   · 官方 App 的 scheme（`xhsdiscover://user/<id>/`）同样要内部 id。
 *
 * 所以：拿到**主页分享链接**后，把其中的 24 位 id 填到 `XHS_USER_ID`，页脚会自动变成一键直达；
 * 留空时退化为「点一下复制小红书号」，提示用户去 App 里搜索——不假装能直达。
 */
export const GITHUB_REPO = 'https://github.com/zuoguyoupan2023/uniaoer'
export const XHS_HANDLE = 'zuoguyoupan2026'

/** 主页分享链接里的 24 位 id（例如 5f1a2b3c000000000101abcd）；留空 = 用复制号方案 */
export const XHS_USER_ID = ''

export const xhsProfileUrl = XHS_USER_ID
  ? `https://www.xiaohongshu.com/user/profile/${XHS_USER_ID}`
  : ''
