# UNiaoer · 鸟语识别

开源 · 非商业的观鸟学习与识别练习项目。用真实的鸟类照片与鸟鸣，练习「看图找鸟」与「听音找鸟」。

## 技术栈

- Vue 3 + TypeScript + Vite
- Vue Router（路由级 code-split）
- Pinia（状态管理）
- Vitest + Vue Test Utils
- ESLint + oxlint + Prettier

## 数据来源与许可

| 来源 | 用途 | 许可 |
|---|---|---|
| [iNaturalist](https://api.inaturalist.org/v1/docs/) | 鸟类照片 | 逐条 CC，仅取开放许可（可配置为含 NC） |
| [Xeno-canto](https://xeno-canto.org/explore/api) | 鸟鸣音频 | 逐条 CC，仅取开放许可（可配置为含 NC） |

- 代码以开源许可发布；**媒体素材仍遵循各自原始 CC 许可，均保留署名**。
- 许可策略可在「设置」中切换：宽松（含 CC-BY-NC，非商业可用）/ 严格（仅 CC0/BY/BY-SA）。
- 许可过滤与署名逻辑见 `src/core/licenseGuard.ts`。

## 开发

```bash
npm install
npm run dev          # 开发服务器
npm run build        # 类型检查 + 构建
npm run test:unit    # 单元测试
npm run lint         # 代码检查
npm run format       # 格式化
```

> 若 npm 安装缓慢，可配置国内镜像：`npm config set registry https://registry.npmmirror.com`

## 功能进度

- ✅ P0 脚手架：Vite + Vue3 + TS + Pinia + 路由 + 测试 + Lint
- ✅ P1 静态题库：`scripts/build-bank.mjs` 抓 iNat/XC → 许可过滤 → `manifest.json`
- ✅ P2 核心玩法：看图找鸟 / 听音找鸟（选项、反馈、署名、结果回顾）
- ✅ P3 体验：预加载（当前 + 后 3 题）、懒加载、Service Worker 持久化
- ✅ P4 难度梯度：L1 入门 / L2 进阶 / L3 高手 / L4 专家（选项数、干扰项、限时）
- ✅ P5 音频自动播放：第 2 题起、延迟 2s（可在设置调整）
- ✅ 用户数据（本地 IndexedDB）：每轮记录、错题本（当前 + 历史）、徽章、成绩海报（可编辑）
- ⏳ P6 边缘后端：Cloudflare Workers + D1 + R2（密钥下沉、动态出题、首屏走 R2）
- ⏳ P7 自适应难度、题库扩充

## 部署（Cloudflare Pages）

当前是纯静态 SPA，用 **Cloudflare Pages** 即可。构建时**现场生成题库**：

| 设置 | 值 |
|---|---|
| Build command | `npm run build:pages` |
| Output directory | `dist` |
| Node version | 22+（环境变量 `NODE_VERSION=22`） |
| 环境变量 | `XC_API_KEY` = 你的 Xeno-canto 个人 Key（**加密变量**） |

`build:pages` = `node scripts/build-bank.mjs --concurrency 6 --max-minutes 15 && npm run build`：
- 抓取 iNat/XC → 许可过滤 → 生成 `public/data/manifest.json` → 再打包
- `--max-minutes 15` 是**时间预算**：超出就跳过剩余物种并先出一版题库，避免 Pages 构建超时失败
- 未配置 `XC_API_KEY` 也能构建（音频退化为仅 iNaturalist sounds）

**注意 / 兜底**：
- Cloudflare Pages 构建默认上限约 20 分钟；100 种 + 慢速 iNat 可能吃紧。若常超时：
  1. 调小物种数（`data/species.json`）或提高 `--concurrency`；或
  2. 改为**本地生成后提交** `public/data/manifest.json`（构建命令改回 `npm run build`）；或
  3. 等 P6 用 R2/Worker 存题库，构建时直接读取（最快）。
- SPA 深链（`/wrong`、`/profile`）由 `public/_redirects` 处理。
- 媒体素材每次访问直接走源站（iNat/XC），由浏览器/Service Worker 缓存；P6 再迁到 R2。
