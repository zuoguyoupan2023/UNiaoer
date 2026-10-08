# UNiaoer · 鸟语识别

开源的观鸟学习与认鸟练习项目：用真实的鸟类照片与鸟鸣，练习「看图认鸟」与「听音认鸟」，并提供全球鸟类名录与分布浏览。面向全球观鸟者，中文用户优先起步。

## 技术栈

- Vue 3 + TypeScript + Vite
- Vue Router（路由级 code-split）
- Pinia（状态管理）
- Vitest + Vue Test Utils
- ESLint + oxlint + Prettier

## 数据来源与许可

**代码**以 [MIT](./LICENSE) 许可发布。**媒体素材与开放数据不随代码许可**，各自遵循下列声明：

| 来源 | 用途 | 许可 |
|---|---|---|
| [iNaturalist](https://api.inaturalist.org/v1/docs/) | 鸟类照片 / 音频 | 逐条 CC，仅取开放许可（可含 NC）；每条素材页面均署名（作者/许可/来源） |
| [Xeno-canto](https://xeno-canto.org/explore/api) | 鸟鸣音频 | 逐条 CC，仅取开放许可（可含 NC）；每条素材页面均署名 |
| [AviList v2025b](https://www.avilist.org/) | 全球名录骨架 | CC BY 4.0（署名见产物 `sources`） |
| [GBIF](https://www.gbif.org/) | 分布 / 省级 / 季节 / 观鸟点 | 逐条 CC0/CC-BY/CC-BY-NC；下载含 DOI 署名 |
| [eBird](https://ebird.org/)（Cornell Lab） | 观鸟点名录 / 区划（就近命名） | 非商业；需署名；不再分发原始数据 |
| ISO 3166-2（alexander-schranz） | 一级行政区基准 | MIT |

- **具体图像/音频数据以每条素材自带的声明为准**（如某条音频为 CC BY-NC，则该条适用该许可）；ND（禁止演绎）素材一律原样提供、不转码不派生。
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
- ✅ P2 核心玩法：看图认鸟 / 听音认鸟（选项、反馈、逐题署名、结果回顾、同种多素材切换）
- ✅ P3 体验：预加载、懒加载、Service Worker 持久化
- ✅ P4 难度梯度 L1–L5（选项数、限时、常见度、取材池、L5 随机干扰音）
- ✅ P5 音频自动播放（可在设置调整）
- ✅ 用户数据（本地 IndexedDB）：多档案、每轮记录、错题本、徽章/称号、成绩海报（可编辑）、导出/导入
- ✅ 成绩分享：单轮成绩可生成公开链接（海报二维码 → 该页），扫码即可查看本轮每题的素材/答案/错选与署名；可随时撤回（凭管理令牌）
- ✅ P6 边缘后端：Cloudflare Workers + D1 + R2（`/api/manifest`、`/api/questions`、`/api/media/:id`、报错/大众评审 `/reports`+`/admin`）
- ✅ P7 自适应难度（最近 5 轮滚动正确率升降档）
- ✅ 内容：物种档案（类群/分布/居留型）、答疑专栏 `/faq`、地区浏览 `/region`（七大洲→国家/省级→鸟种）
- ✅ 地区数据层：季节层 `seasonality.json`、15 国省级层 `region-provinces.json`（含中国 34 区划/港澳台标注）、观鸟点 `hotspots.json`（GBIF 源）
- ✅ i18n（zh-CN / en，586 keys，CI 门禁）· 无障碍（H3）· E2E（Playwright 13 条，全离线）
- ✅ 全球扩张（数据层）：AviList v2025b 全球骨架 `species-index.json`（11,131 种）+ manifest 增 `taxonKey`/`playable`；中文名 5,808 种（curated 优先 + Wikidata CC0）；backbone 映射 10,892/11,131；全球区系层 `/region`（249 国）+ 无媒体种轻量详情页
- ✅ 全球媒体采集：**9,839 种**（图 9,349 / 音 9,060，1 图 1 音/种）已全部上传 R2，逐条署名，ND 不转码
- ✅ 全量名录 `/catalog`：10,844 种按目 → 科 → 种浏览；**分类序 / 拼音 / 常见度**三态排序（拼音键与常见度档位构建期预计算）+ A–Z 字母跳转 + 拼音搜索
- 🚧 进行中：玩法集成（P3）——全球池进题、manifest 分层加载、常见度分档、媒体质量反馈闭环（规划见 `docs/029`）

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
