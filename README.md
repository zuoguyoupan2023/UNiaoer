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

当前是纯静态 SPA，用 **Cloudflare Pages** 即可。

### 方案 A（推荐，最简单）：题库随仓库提交
1. 本地跑一次 `npm run bank`（生成 `public/data/manifest.json`），把它 `git add` 提交。
2. Pages 设置：

| 设置 | 值 |
|---|---|
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | 22+（`NODE_VERSION=22`） |

> `public/data/manifest.json` 只是元数据 + 远端 URL + 署名（不含媒体），体积很小。
> 需要更新题库时，本地重跑 `npm run bank` 再提交即可。

### 方案 B：构建时现场生成题库
| 设置 | 值 |
|---|---|
| Build command | `npm run bank && npm run build` |
| Output directory | `dist` |
| 环境变量 | `XC_API_KEY` = Xeno-canto 个人 Key（加密） |

- 也可用等价的 `npm run build:pages`（= `bank --concurrency 6 --max-minutes 15 && build`）。
- ⚠️ Pages 构建默认上限约 20 分钟；100 种 + 慢速 iNat 可能超时，故有 `--max-minutes 15` 兜底。

### 其它
- SPA 深链（`/wrong`、`/profile`）由 `public/_redirects` 处理。
- **千万别在 Pages 里只写 `npm run build` 而不提交题库**：那样 `/data/manifest.json` 不存在，会被 SPA 回退成 HTML，前端报 `Unexpected token '<'`。
- P6 后可把题库放 R2/Worker，构建时直接读取，彻底免去这一步。
