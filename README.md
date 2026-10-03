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
| [iNaturalist](https://api.inaturalist.org/v1/docs/) | 鸟类照片 / 音频 | 逐条 CC，仅取开放许可（可配置为含 NC） |
| [Xeno-canto](https://xeno-canto.org/explore/api) | 鸟鸣音频 | 逐条 CC，仅取开放许可（可配置为含 NC） |
| [GBIF](https://www.gbif.org/) | 分布 / 省级 / 季节 / 观鸟点 | 逐条 CC0/CC-BY/CC-BY-NC |
| [eBird](https://ebird.org/)（Cornell Lab） | 观鸟点名录 / 区划（就近命名） | 非商业；需署名；不再分发原始数据 |
| ISO 3166-2（alexander-schranz） | 一级行政区基准 | MIT |

- 代码以开源许可发布；**媒体素材仍遵循各自原始 CC 许可，均保留署名**。
- 许可策略可在「设置」中切换：宽松（含 CC-BY-NC，非商业可用）/ 严格（仅 CC0/BY/BY-SA）。
- 许可过滤与署名逻辑见 `src/core/licenseGuard.ts`；地区/季节/观鸟点逐条署名见 `scripts/check-region.mjs`。

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
- ✅ P1 静态题库：`scripts/build-bank.mjs` 抓 iNat/XC → 许可过滤 → `manifest.json`（1299 种 / 5 图 5 音）
- ✅ P2 核心玩法：看图找鸟 / 听音找鸟（选项、反馈、逐题署名、结果回顾、同种多素材切换）
- ✅ P3 体验：预加载、懒加载、Service Worker 持久化
- ✅ P4 难度梯度 L1–L5（选项数、限时、常见度、取材池、L5 随机干扰音）
- ✅ P5 音频自动播放（可在设置调整）
- ✅ 用户数据（本地 IndexedDB）：多档案、每轮记录、错题本、徽章/称号、成绩海报（可编辑）、导出/导入
- ✅ P6 边缘后端：Cloudflare Workers + D1 + R2（`/api/manifest`、`/api/questions`、`/api/media/:id`、报错/大众评审 `/reports`+`/admin`）
- ✅ P7 自适应难度（最近 5 轮滚动正确率升降档）
- ✅ 内容：物种档案（类群/分布/居留型）、答疑专栏 `/faq`、地区浏览 `/region`（七大洲→国家/省级→鸟种）
- ✅ 地区数据层：季节层 `seasonality.json`、15 国省级层 `region-provinces.json`（含中国 34 区划/港澳台标注）、观鸟点 `hotspots.json`（GBIF 源）
- ✅ i18n（zh-CN / en，532 keys，CI 门禁）· 无障碍（H3）· E2E（Playwright 11 条，全离线）
- 🚧 下一大计划：全球全种类扩张（1299 → ~11k，骨架先行）——P0 分类骨架已完成：AviList v2025b 全球骨架 `species-index.json`（11,131 种）+ manifest 增 `taxonKey`/`playable`（1299 全映射，只增不改）；P1-a 中文名已填充（curated 优先 + Wikidata CC0，覆盖 5,808 种）；P1-b/c / P2 媒体分层待做

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
