import { defineConfig, devices } from '@playwright/test'

/**
 * H2 E2E：关键路径回归保护。
 * 跑前先构建（type-check + build），再用 vite preview 伺服 dist；
 * 用例内通过 page.route 模拟 manifest / 媒体 / 外部 API，不依赖真实网络。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    // 应用按 navigator.language 探测语言；固定中文使选择器稳定（en 切换另有单测覆盖）
    locale: 'zh-CN',
    // 应用注册了 sw.js：SW 内的请求不经过 page.route，E2E 必须禁用，
    // 否则媒体请求绕过夹具直连真实网络（ERR_FAILED）
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
})
