/**
 * H2 E2E：关键路径回归保护。
 * 全部离线运行（e2e/app.ts 拦截 manifest/媒体/外部 API），每个测试独享干净浏览器上下文。
 */
import { answerOption, bank, expect, setManualAutoNext, startImageQuiz, test } from './app'

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

    // 海报弹层：打开（role=dialog）→ ESC 关闭（useDialogA11y 回归）
    await page.getByRole('button', { name: '生成海报' }).click()
    const posterDialog = page.locator('.overlay .panel[role="dialog"]')
    await expect(posterDialog).toBeVisible()
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

    await page.goto('/faq')
    await expect(page.getByText('暂时还没有需要说明的条目。')).toBeVisible()

    await page.goto('/reports')
    // 无后端环境：列表不可用是既定降级态（离线也可确定性断言）
    await expect(page.getByText('反馈列表暂时不可用（需要联网）。')).toBeVisible()
    // 导航入口：无可评审内容时不显示（reportsMeta 拉取失败按 0 处理）
    await expect(page.locator('.app-nav a', { hasText: '大众评审' })).toBeHidden()
  })

  test('地区浏览：外国省级层（021 M2）筛选与署名', async ({ page }) => {
    await page.goto('/region')
    await page.getByRole('button', { name: '北美洲' }).click()
    await page.getByRole('button', { name: /美国/ }).click()

    // 省级二级列表在左侧国家树下（021 M2 修订）；含来源署名
    await expect(page.locator('.country-list .prov-list')).toBeVisible()
    await expect(page.getByRole('button', { name: 'California' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Washington' })).toBeVisible()
    await expect(page.locator('.prov-source')).toContainText('GBIF')

    // 选 California：只剩 sp-01/sp-02；sp-03（仅 WA）不出现
    await page.getByRole('button', { name: 'California' }).click()
    await expect(page.getByText('测试鸟1', { exact: true })).toBeVisible()
    await expect(page.getByText('测试鸟2', { exact: true })).toBeVisible()
    await expect(page.getByText('测试鸟3', { exact: true })).toBeHidden()
    await expect(page.locator('.sp-count').first()).toContainText('条记录')

    // 切回全部：sp-03 重现
    await page.getByRole('button', { name: '全部' }).click()
    await expect(page.getByText('测试鸟3', { exact: true })).toBeVisible()
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
  })
})
