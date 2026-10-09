/**
 * H2 E2E：关键路径回归保护。
 * 全部离线运行（e2e/app.ts 拦截 manifest/媒体/外部 API），每个测试独享干净浏览器上下文。
 */
import {
  answerOption,
  bank,
  expect,
  newShareStore,
  setManualAutoNext,
  startImageQuiz,
  stubApp,
  test,
} from './app'

test.describe('核心答题链路', () => {
  test('主链路：向导 → 答题 2 题 → 退出 → 结果 → 海报弹层 → 再来一轮 → 档案统计', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await setManualAutoNext(page)
    await page.goto('/quiz/image')

    // 首启向导：跳过昵称
    await expect(page.locator('.wizard-panel')).toBeVisible()
    await page.getByRole('button', { name: '直接开始' }).click()
    await expect(page.locator('.wizard-panel')).toBeHidden()

    await page.getByRole('button', { name: /L1 入门/ }).click()
    await page.getByRole('button', { name: '开始答题' }).click()
    await expect(page.getByText('第 1 / 10 题')).toBeVisible()

    // 第 1 题：点选作答 → 常驻反馈含正确答案 → 下一题
    await answerOption(page, 1)
    await expect(page.locator('.feedback')).toBeVisible()
    await expect(page.locator('.feedback')).toContainText('正确答案')
    await page.getByRole('button', { name: /下一题|查看结果/ }).click()
    await expect(page.getByText('第 2 / 10 题')).toBeVisible()

    // 第 2 题作答后中途退出（原生 confirm = 接受）
    await answerOption(page, 1)
    await expect(page.locator('.feedback')).toBeVisible()
    page.once('dialog', (d) => d.accept())
    await page.getByRole('button', { name: '退出' }).click()

    // 结果页：截至成绩
    await expect(page).toHaveURL(/\/result$/)
    await expect(page.getByText('答题完成')).toBeVisible()
    await expect(page.getByText(/正确率 \d+%/).first()).toBeVisible()

    // 海报弹层：打开（role=dialog）→ 勾选项默认勾上 → ESC 关闭（useDialogA11y 回归）
    await page.getByRole('button', { name: '生成海报' }).click()
    const posterDialog = page.locator('.overlay .panel[role="dialog"]')
    await expect(posterDialog).toBeVisible()
    const inc = posterDialog.locator('.inc-opt input')
    await expect(inc).toBeChecked() // 「海报包含本组测试内容」默认勾选
    await expect(posterDialog.locator('.inc-note')).toContainText('含本轮成绩')
    await page.keyboard.press('Escape')
    await expect(posterDialog).toBeHidden()

    // 再来一轮：跳过介绍页直接进入答题（沿用上一轮题量=截断后的 2 题）
    await page.getByRole('button', { name: '再来一轮' }).click()
    await expect(page.getByText('第 1 / 2 题')).toBeVisible()

    // 档案：一轮已落库（退出时截断为 2 题）
    await page.goto('/profile')
    await expect(page.locator('.archive-chip').first()).toBeVisible()
    await expect(page.getByText('轮次', { exact: true })).toBeVisible()
  })

  test('键盘作答：数字键选择、方向键下一题', async ({ page }) => {
    await startImageQuiz(page)
    await expect(page.locator('.option').first()).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('1')
    await expect(page.locator('.feedback')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByText('第 2 / 10 题')).toBeVisible()
  })

  test('报错浮窗：提交后显示已记录', async ({ page }) => {
    await startImageQuiz(page)
    await page.getByRole('button', { name: '报错' }).click()
    const panel = page.locator('.report-panel')
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: '录音不对' }).click()
    await panel.getByRole('button', { name: '提交' }).click()
    await expect(panel.getByText('已记录，感谢反馈！')).toBeVisible()
  })

  test('成绩分享（035）：创建链接 → 打开分享页 → 撤回后失效', async ({ page, context }) => {
    // 分享桩的存储在多个上下文间共享（"创建方"与"扫码方"是两个独立浏览器上下文）。
    // 后注册的路由优先，故这里重装一次即可覆盖 fixture 的默认桩。
    const shares = newShareStore()
    await stubApp(page, { shares })
    // 答 2 题后中途退出（L1 每题前 5s 隐藏选项，答满 10 题会白等 ~50s）；
    // 退出时本轮截断为已答题目（与主链路测试同一模式），分享流程完全等价。
    const ROUND_ITEMS = 2
    await setManualAutoNext(page)
    await page.goto('/quiz/image')
    await expect(page.locator('.wizard-panel')).toBeVisible()
    await page.getByRole('button', { name: '直接开始' }).click()
    await page.getByRole('button', { name: /L1 入门/ }).click()
    await page.getByRole('button', { name: '开始答题' }).click()
    for (let i = 0; i < ROUND_ITEMS; i++) {
      await expect(page.locator('.option').first()).toBeVisible({ timeout: 10_000 })
      await page.locator('.option').first().click()
      await expect(page.locator('.feedback')).toBeVisible()
      if (i < ROUND_ITEMS - 1) await page.getByRole('button', { name: '下一题' }).click()
    }
    page.once('dialog', (d) => d.accept())
    await page.getByRole('button', { name: '退出' }).click()
    await expect(page).toHaveURL(/\/result$/)

    // 海报「生成并下载」→ 先弹提醒（含错题信息，可改为不含）→ 继续生成
    // 勾选含测试内容时，生成过程会确保本轮分享链接存在并向二维码回填（2026-10-09）
    await page.getByRole('button', { name: '生成海报' }).click()
    const posterDialog = page.locator('.overlay .panel[role="dialog"]')
    await expect(posterDialog).toBeVisible()
    const downloadPromise = page.waitForEvent('download')
    await posterDialog.getByRole('button', { name: /生成并下载/ }).click()
    // 提醒弹层：说明会带上成绩与错题；点「继续生成」→ 直接下载
    const notice = posterDialog.locator('.notice')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('错题')
    await notice.getByRole('button', { name: '继续生成' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^UNiaoer-Test_Share_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.png$/)
    await page.keyboard.press('Escape')
    await expect(posterDialog).toBeHidden()

    // 结果页同步进入"已分享"态（复用弹层里创建的那份，不重复创建）
    const linkInput = page.locator('.share-link input')
    await expect(linkInput).toBeVisible()
    const shareUrl = await linkInput.inputValue()
    expect(shareUrl).toMatch(/\/s\/E2Eshare\d{4}$/)

    // 新上下文打开分享页（模拟"别人扫码"：无本地数据、无登录）
    const anon = await context.browser()!.newContext({ locale: 'zh-CN' })
    await stubApp(anon, { shares })
    const viewer = await anon.newPage()
    await viewer.goto(shareUrl)
    await expect(viewer.locator('.share .items > li').first()).toBeVisible()
    // 题目、答案、素材、署名都要在
    await expect(viewer.locator('.share .items > li')).toHaveCount(ROUND_ITEMS)
    await expect(viewer.locator('.share .items > li img, .share .items > li audio').first()).toBeVisible()
    await expect(viewer.locator('.share .credits').first()).toContainText(/iNaturalist|Xeno-canto/)
    // 分享页不该被收录
    await expect(viewer.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
    await anon.close()

    // 撤回 → 同一链接 404
    page.once('dialog', (d) => d.accept()) // window.confirm
    await page.getByRole('button', { name: '撤回分享' }).click()
    await expect(page.locator('.share-msg')).toContainText(/已撤回/)
    const after = await context.browser()!.newContext({ locale: 'zh-CN' })
    await stubApp(after, { shares })
    const gone = await after.newPage()
    await gone.goto(shareUrl)
    await expect(gone.getByText('这个分享链接不可用')).toBeVisible()
    await after.close()
  })

  test('听音答题：音频播放器带 crossorigin（iPhone 播放前提，docs/033）', async ({ page }) => {
    await page.goto('/quiz/audio')
    await expect(page.locator('.wizard-panel')).toBeVisible()
    await page.getByRole('button', { name: '直接开始' }).click()
    await page.getByRole('button', { name: /L1 入门/ }).click()
    await page.getByRole('button', { name: '开始答题' }).click()
    // 属性必须是 crossorigin="anonymous"；缺失/为空时 WebKit 无法消费 SW 缓存的音频
    const audio = page.locator('.media audio, .audio-row audio').first()
    await expect(audio).toBeAttached({ timeout: 10_000 })
    await expect(audio).toHaveAttribute('crossorigin', 'anonymous')
  })

  test('更多素材去冗余：图题只列音频、音题只列图片（2026-10-09 实测反馈）', async ({ page }) => {
    // 夹具物种为 1 图 + 1 音：过滤掉当前题面后，画廊里应只剩"另一种"
    await startImageQuiz(page)
    const toggle = page.locator('.sg-toggle')
    await expect(toggle).toBeVisible()
    await toggle.click()
    const body = page.locator('.sg-body')
    await expect(body.locator('.sg-audio')).toHaveCount(1) // 图题 → 列录音
    await expect(body.locator('.sg-thumb')).toHaveCount(0) // 题面那张图不再重复列出
    await expect(toggle).toContainText('1')

    // 音题同理：只列图片（首启向导已在上面跳过，同一上下文不再弹）
    await page.goto('/quiz/audio')
    await page.getByRole('button', { name: /L1 入门/ }).click()
    await page.getByRole('button', { name: '开始答题' }).click()
    const atoggle = page.locator('.sg-toggle')
    await expect(atoggle).toBeVisible({ timeout: 10_000 })
    await atoggle.click()
    const abody = page.locator('.sg-body')
    await expect(abody.locator('.sg-thumb')).toHaveCount(1)
    await expect(abody.locator('.sg-audio')).toHaveCount(0)
  })
})

test.describe('入口与页面', () => {
  test('首页渲染 + 无障碍基建（skip-link / header / main 地标 / 题库统计）', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: '跳到主内容' })).toBeAttached()
    await expect(page.locator('header.app-topbar')).toBeVisible()
    await expect(page.locator('main#main')).toBeAttached()
    await expect(page.getByText(`题库：${bank.total} 种`)).toBeVisible()
    // 键盘聚焦 skip-link 后 href 指向主内容
    await page.locator('.skip-link').focus()
    await expect(page.locator('.skip-link')).toBeFocused()
  })

  test('首次向导：ESC 不关闭昵称浮窗，只能开始/跳过', async ({ page }) => {
    await page.goto('/quiz/image')
    const wizard = page.locator('.wizard-panel')
    await expect(wizard).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(wizard).toBeVisible() // 无 onClose：向导必须二选一
    await page.getByRole('button', { name: '直接开始' }).click()
    await expect(wizard).toBeHidden()
    await expect(page.getByRole('button', { name: /L1 入门/ })).toBeVisible()
  })

  test('设置页：语言切换 zh ↔ en', async ({ page }) => {
    await page.goto('/settings')
    await page.locator('.lang-choices button', { hasText: 'English' }).click()
    await expect(page.locator('.app-nav a', { hasText: 'Photo quiz' })).toBeVisible()
    await page.locator('.lang-choices button', { hasText: '中文' }).click()
    await expect(page.locator('.app-nav a', { hasText: '看图认鸟' })).toBeVisible()
  })

  test('冒烟：地区浏览 / 答疑专栏 / 大众评审 / 物种详情季节块', async ({ page }) => {
    await page.goto('/region')
    await expect(page.getByRole('button', { name: '亚洲' })).toBeVisible()
    await expect(page.getByText('测试鸟1', { exact: true })).toBeVisible()

    // 物种详情：季节块（021 M1/M3）按需加载，有数据的物种显示直方图、居留型与署名
    await page.locator('.species-card').first().click()
    await expect(page.getByText('出现月份')).toBeVisible()
    await expect(page.getByText('基于约 1234 条公开观测记录')).toBeVisible()
    await expect(page.locator('.season')).toContainText('GBIF')
    await expect(page.locator('.season')).toContainText('留鸟')

    // 省份热力条（036，非地图）：sp-01 夹具含 CN-44(500)/US-CA(120)/US-WA(4)/CN-91(1)
    const bars = page.locator('.prov .bar-row')
    await expect(bars).toHaveCount(4)
    // 降序：广东省(500) 在首
    await expect(bars.first()).toContainText('广东省')
    await expect(bars.first()).toContainText('500')
    // 铁律 6：港澳台标注（CN-91 → 中国香港）
    await expect(page.locator('.prov')).toContainText('中国香港')

    await page.goto('/faq')
    await expect(page.getByText('暂时还没有需要说明的条目。')).toBeVisible()

    await page.goto('/reports')
    // 无后端环境：列表不可用是既定降级态（离线也可确定性断言）
    await expect(page.getByText('反馈列表暂时不可用（需要联网）。')).toBeVisible()
    // 导航入口：无可评审内容时不显示（reportsMeta 拉取失败按 0 处理）
    await expect(page.locator('.app-nav a', { hasText: '大众评审' })).toBeHidden()
  })

  test('地区浏览：外国省级层（021 M2）筛选/折叠与署名', async ({ page }) => {
    await page.goto('/region')
    await page.getByRole('button', { name: '北美洲' }).click()
    const us = page.locator('.country-btn[data-code="US"]')

    // 切换大洲自动选中并展开美国省级（左侧国家树下）；含来源署名
    await expect(page.locator('.country-list .prov-list')).toBeVisible()
    await expect(page.getByRole('button', { name: 'California' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Washington' })).toBeVisible()
    await expect(page.locator('.prov-source')).toContainText('GBIF')

    // 再次点击已选国家 → 折叠；再点 → 展开（021 UI 修订）
    await us.click()
    await expect(page.locator('.country-list .prov-list')).toBeHidden()
    await us.click()
    await expect(page.locator('.country-list .prov-list')).toBeVisible()

    // 选 California：只剩 sp-01/sp-02；sp-03（仅 WA）不出现
    await page.getByRole('button', { name: 'California' }).click()
    await expect(page.getByText('测试鸟1', { exact: true })).toBeVisible()
    await expect(page.getByText('测试鸟2', { exact: true })).toBeVisible()
    await expect(page.getByText('测试鸟3', { exact: true })).toBeHidden()
    await expect(page.locator('.sp-count').first()).toContainText('条记录')

    // 点击国家本身 = 全部：sp-03 重现（二级目录已无「全部」项）
    await us.click()
    await expect(page.getByText('测试鸟3', { exact: true })).toBeVisible()
    await expect(page.locator('.country-list .prov-list')).toBeVisible()
  })

  test('地区浏览：中国省级层（021 M3）——默认国即中国，港澳台标注', async ({ page }) => {
    await page.goto('/region') // 默认亚洲 + 中国（017）

    // 左侧国家树下自动展开 CN 省级：中文全称 + 港澳台标注名（铁律 6）
    await expect(page.locator('.country-list .prov-list')).toBeVisible()
    await expect(page.getByRole('button', { name: '北京市' })).toBeVisible()
    await expect(page.getByRole('button', { name: '广东省' })).toBeVisible()
    await expect(page.getByRole('button', { name: '中国台湾' })).toBeVisible()
    await expect(page.getByRole('button', { name: '中国香港' })).toBeVisible()

    // 选中国香港：只剩 sp-01（其 CN-91 有存在性记录）；sp-02 不出现
    await page.getByRole('button', { name: '中国香港' }).click()
    await expect(page.getByText('测试鸟1', { exact: true })).toBeVisible()
    await expect(page.getByText('测试鸟2', { exact: true })).toBeHidden()

    // 选中国台湾：只剩 sp-02
    await page.getByRole('button', { name: '中国台湾' }).click()
    await expect(page.getByText('测试鸟2', { exact: true })).toBeVisible()
    await expect(page.getByText('测试鸟1', { exact: true })).toBeHidden()

    // 排序切换（一级二级共用）：按鸟种数 / 按名称；省级条目带鸟种数
    await page.getByRole('button', { name: '按鸟种数' }).click()
    await expect(page.locator('.country-list .prov-list')).toBeVisible()
    await expect(page.locator('.prov-btn', { hasText: '广东省' }).locator('.prov-count')).toContainText('1 种')
    await page.getByRole('button', { name: '按名称' }).click()
    await expect(page.locator('.prov-btn', { hasText: '北京市' })).toBeVisible()
  })

  test('答题页：地区选择器「已选摘要 + 更改」与新手指引（2026-10-09 UI 重做）', async ({ page }) => {
    await page.goto('/quiz/image')
    await expect(page.locator('.wizard-panel')).toBeVisible()
    await page.getByRole('button', { name: '直接开始' }).click()
    await expect(page.locator('.wizard-panel')).toBeHidden()

    // 默认收起：只显示「当前地区：全球」摘要 + 更改按钮（不再平铺国家按钮）
    await expect(page.locator('.region-value')).toContainText('全球')
    await expect(page.locator('.region-picker')).toBeHidden()

    // 展开 → 选中国 → 选北京市 → 摘要变成「中国 · 北京市」且选择器收起
    await page.getByRole('button', { name: '更改' }).click()
    await expect(page.locator('.region-picker')).toBeVisible()
    await page.locator('.region-picker').getByRole('button', { name: '中国', exact: true }).click()
    await page.locator('.region-picker').getByRole('button', { name: '北京市' }).click()
    await expect(page.locator('.region-value')).toContainText('中国 · 北京市')
    await expect(page.locator('.region-picker')).toBeHidden()

    // 新手福利提示（全新上下文 = 无历史轮次 + L1）
    await page.getByRole('button', { name: /L1 入门/ }).click()
    await expect(page.locator('.beginner-hint')).toBeVisible()
  })

  test('地区浏览：观鸟点（021 M4 腿 B / 2026-10-09 标签页）列表/就地详情/署名', async ({ page }) => {
    await page.goto('/region')
    await page.getByRole('button', { name: '北美洲' }).click()

    // 右侧面板：鸟种 / 观鸟点两个标签页（不再上下堆叠）
    const spotsTab = page.getByRole('tab', { name: /观鸟点/ })
    await expect(spotsTab).toBeVisible()
    await spotsTab.click()
    await expect(spotsTab).toHaveAttribute('aria-selected', 'true')

    const ca = page.locator('.hotspot-btn', { hasText: 'California' })
    await expect(ca).toBeVisible()
    await expect(ca).toContainText('条记录')

    // 就地详情：常见鸟种（可跳物种详情）+ 来源署名
    await ca.click()
    const detail = page.locator('.hotspot-detail')
    await expect(detail).toContainText('常见鸟种')
    await expect(detail).toContainText('测试鸟1')
    await expect(page.locator('.hotspot-source')).toContainText('GBIF')

    // 切回鸟种标签页：物种网格可见、观鸟点列表隐藏（v-show 保留节点但不可见）
    const speciesTab = page.getByRole('tab', { name: /鸟种/ })
    await speciesTab.click()
    await expect(page.locator('.species-grid')).toBeVisible()
    await expect(page.locator('.hotspot-btn').first()).toBeHidden()
  })

  test('地区浏览：观鸟点按省过滤（选省后只见本省点）', async ({ page }) => {
    await page.goto('/region')
    // 默认中国：点省份「北京市」后，观鸟点标签只应显示北京（夹具 CN-Beijing）
    await page.locator('.prov-btn[data-prov="CN-11"]').click()
    const spotsTab = page.getByRole('tab', { name: /观鸟点/ })
    await spotsTab.click()
    await expect(page.locator('.hotspot-btn')).toHaveCount(1)
    await expect(page.locator('.hotspot-btn')).toContainText('Beijing')
  })

  test('公开统计（028）：数字卡/近 30 日条形/徽章与称号榜 + 口径说明', async ({ page }) => {
    await page.goto('/stats')
    // 数字卡（桩数据：独立访客 7 / 会话 12 / 轮次 5 / 浏览 40）
    const cards = page.locator('.card-item')
    await expect(cards).toHaveCount(6)
    await expect(page.locator('.card-item', { hasText: '独立访客' }).locator('.num')).toHaveText('7')
    await expect(page.locator('.card-item', { hasText: '完成轮次' }).locator('.num')).toHaveText('5')
    // 近 30 日逐日条形
    await expect(page.locator('.bars li')).toHaveCount(30)
    // 徽章 / 称号榜（桩：first-round 3 人；volume L1 2 人）——两个独立列表，各取 first()
    await expect(page.locator('.ranks li').first()).toContainText('3 人')
    await expect(page.locator('.ranks').last()).toContainText('2 人')
    // 口径说明可见（避免"数字怎么来的"疑问）
    await expect(page.locator('.foot')).toContainText('匿名')
  })

  test('地区浏览：移动端折叠选择器（021 UI 修订）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/region')

    // 移动端：选择按钮可见、国家树默认收起（不占屏，鸟种直接可见）
    await expect(page.locator('.picker-toggle')).toBeVisible()
    await expect(page.locator('.picker-body')).toBeHidden()
    await expect(page.locator('.species-grid')).toBeVisible()

    // 展开 → 选省 → 自动收起
    await page.locator('.picker-toggle').click()
    await expect(page.locator('.picker-body')).toBeVisible()
    await page.locator('.prov-btn[data-prov="CN-44"]').click()
    await expect(page.locator('.picker-body')).toBeHidden()
    await expect(page.getByText('测试鸟1', { exact: true })).toBeVisible()
  })

  test('名录排序（031 D-031-2）：分类序 / 拼音 + 字母跳转 / 常见度 / 拼音搜索', async ({
    page,
  }) => {
    await page.goto('/catalog')
    const rowIds = () => page.locator('.cat-sp').evaluateAll((els) => els.map((e) => e.id))
    const orderNames = () => page.locator('.cat-order-name').allTextContents()

    // 夹具为 4 种(每目 1 科 2 种);分类序 = 构建期顺序,字母条不显示
    await expect(page.locator('.cat-sp')).toHaveCount(4)
    expect(await rowIds()).toEqual([
      'cat-sp-bubo-bubo',
      'cat-sp-athene-noctua',
      'cat-sp-hirundo-rustica',
      'cat-sp-delichon-dasypus',
    ])
    expect(await orderNames()).toEqual(['鸮形目 Strigiformes', '雀形目 Passeriformes'])
    await expect(page.locator('.letter-btn')).toHaveCount(0)

    // 拼音:目内重排（d<z、j<y）,目层级不动;字母条出现
    await page.locator('.sort-btn', { hasText: '拼音' }).click()
    expect(await rowIds()).toEqual([
      'cat-sp-bubo-bubo',
      'cat-sp-athene-noctua',
      'cat-sp-hirundo-rustica',
      'cat-sp-delichon-dasypus',
    ])
    expect(await orderNames()).toEqual(['鸮形目 Strigiformes', '雀形目 Passeriformes'])
    await expect(page.locator('.letter-btn')).toHaveText(['D', 'J', 'Y', 'Z'])

    // 字母跳转:J → 展开雀形目并滚到家燕
    await page.locator('.letter-btn', { hasText: 'J' }).click()
    await expect(page.locator('details[open] .cat-sp-link[href="/species/hirundo-rustica"]')).toBeVisible()

    // 常见度:目内 1 档在前（小鸮 cm1 < 雕鸮 cm3;烟腹 cm1 < 家燕 cm4）
    await page.locator('.sort-btn', { hasText: '常见度' }).click()
    expect(await rowIds()).toEqual([
      'cat-sp-athene-noctua',
      'cat-sp-bubo-bubo',
      'cat-sp-delichon-dasypus',
      'cat-sp-hirundo-rustica',
    ])

    // 回到分类序:字母条隐藏,顺序复原
    await page.locator('.sort-btn', { hasText: '分类序' }).click()
    await expect(page.locator('.letter-btn')).toHaveCount(0)
    expect((await rowIds())[0]).toBe('cat-sp-bubo-bubo')

    // 拼音直达:搜索「jiayan」命中家燕（拼音键参与搜索）
    await page.locator('.cat-search').fill('jiayan')
    await expect(page.locator('.cat-sp')).toHaveCount(1)
    await expect(page.locator('.cat-sp')).toContainText('家燕')
  })

  test('全球物种层（025）：未收录标记、轻量详情与 bank 回归', async ({ page }) => {
    await page.goto('/region') // 默认亚洲 + 中国

    // 全球未收录种:网格显示「未收录媒体」标记;bank 种仍带头图可玩
    const globus = page.locator('.species-card', { hasText: 'Globus testus' })
    await expect(globus).toBeVisible()
    await expect(globus.locator('.sp-badge')).toHaveText('未收录媒体')
    const bankCard = page.locator('.species-card', { hasText: '测试鸟1' })
    await expect(bankCard.locator('img.thumb')).toBeVisible()

    // 轻量详情:名称/目科/分布/外链(全球种有页可看)
    await globus.click()
    await expect(page.getByText('全球测试鸟')).toBeVisible()
    await expect(page.getByText('目：Testiformes')).toBeVisible()
    await expect(page.getByText(/记录分布/)).toBeVisible()
    const links = page.locator('.lite-links')
    await expect(links).toContainText('GBIF')
    await expect(links).toContainText('Avibase')
    await expect(links).toContainText('eBird')
    await expect(page.locator('.lite-src')).toContainText('AviList v2025b')

    // 省级选中时全球种不出现(省级层仅覆盖 bank 物种)
    await page.goto('/region')
    await page.locator('.country-list .prov-btn[data-prov="CN-44"]').click()
    await expect(page.getByText('测试鸟1', { exact: true })).toBeVisible()
    await expect(page.getByText('Globus testus', { exact: true })).toBeHidden()
  })
})
