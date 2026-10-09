# AGENTS.md — UNiaoer 开发约定

给在此仓库工作的 AI / 协作者的硬性规则与速查。

## 铁律（违反即返工）

1. **禁止"本地模拟"式操作。**
   - `wrangler r2 object put/get/list` **必须带 `--remote`**；`wrangler d1 execute` **必须带 `--remote`**。
   - 绝不允许出现"命令显示成功、但数据实际写进了 `.wrangler/state` 本地模拟存储"的情况。
   - 任何要"真正生效"的云操作，必须**显式指向远端**，并在完成后**验证远端**（如 `curl` 公开 URL 返回 200、D1 `SELECT` 出数据）。
   - 发现 `.wrangler/` 目录出现在仓库里 → 视为事故，删除并排查。

2. **不提交密钥。**
   - `.env`、R2 凭证、`XC_API_KEY` 一律不入库；只提交 `.env.example` 模板。
   - 令牌用完即删；用**桶级最小权限**。

3. **不提交规划文档与旧 demo。**
   - `0xx-*.md`（规划文档）、`docs/`（开发过程文档，另有私有 repo `uniaoer-private` 存档）、`legacy/`（旧单文件 demo）已在 `.gitignore`，不要提交。

4. **改完必须自检。** 交付前跑：`npm run lint` && `npm test` && `npm run build`。
   - **动了 D1 相关代码或 schema/seed，必须再手动跑 `npm run check:sync`**（CI 不跑它；
     2026-10-08 事故正是「Worker 部署了带新列的查询、D1 结构没同步」——见 `docs/032`）。
   - 动了产物构建脚本（`build-manifest-layers` / `build-hotspots-gbif` / `region:*` 等），同步跑对应门禁：
     `check:layers`（manifest 三层）· `check:catalog`（名录）· `check:region`（地区层）；前三者 CI 已接入，但**产物是提交物**，本地重建后必须自检再提交。
   - **`sync:prod` 单次写入 ≈43,410 行（10 万/天额度的 43%）→ 单日最多跑 2 次**；
     跑前可用 `npm run d1:usage` 看当日已用额度。
   - 所有"响应后仍需完成"的副作用（Cache API 写入等）必须 `ctx.waitUntil(...)` 或 await——
     否则被 Worker 运行时取消（边缘缓存曾因此静默失效半日，见 `docs/032`）。

5. **涉及媒体许可的改动**，必须保持署名（作者/许可证/来源）与 `canTranscode()`（ND 不转码）。
   - **跨域媒体必须走 CORS 模式**：`<audio>`/`new Audio()`/预加载都要 `crossorigin`（**先于 `src` 设置**，Safari 只读设置 src 那一刻的值）。
     WebKit 无法消费 SW 返回的 opaque 媒体响应——2026-10-08 iPhone 音频全挂即此因，见 `docs/033`。
   - **不要把 206 片段写缓存**（Cache API 拒绝存储 206，且 Safari 永远发 Range 请求）：媒体缓存统一"去 Range 取全量"。
   - 改动 SW 媒体策略后跑 `npm run check:media-webkit`（Chromium 的 lint/单测/e2e 覆盖不到这类引擎差异）。

6. **地图与地区展示（政治敏感性）。**
   - 当前只做**国家/地区文本**，不含地图/边界；未来若上地图，边界须按官方立场处理，**逐项复核后再合并**。
   - 港澳台**单独列出**，显示名必须是「中国香港／中国澳门／中国台湾」（英文 `Hong Kong, China / Macao, China / Taiwan, China`），见 `src/core/region.ts` 的 `REGION_LABEL_KEY` + i18n `region.regions.*`。
   - 南海诸岛、藏南及一切边界归属，按官方表述；不得把有争议地区作为独立国家呈现。

7. **i18n 文案的 `{x}` 由 vue-i18n 插值，不是自定义占位符。**
   - `t(key)` **不带参**取值会把 `{name}` 替换成**空串**；"先取模板、再 `.replace('{x}', …)`" 的写法必然失效
     （海报错题行曾因此渲染成空括号「」——见 `docs/034`）。
   - 一律**带参一步到位**：`t(key, { name })`；`grep -rn "replace('{" src/` 应为空。
   - 画布类渲染（`poster.ts`）沿用**函数式注入**模式（如 `PosterStrings.mistakenAs: (name) => string`）。

8. **推送（`git push`）由用户执行，AI 只提交到本地。**
   - 原因：`https://github.com` 在本机常年超时/被网络拦截，且沙箱进程读不到 macOS 钥匙串凭据
     （报错形态：`could not read Username for 'https://github.com'` 或 `Failed to connect to github.com port 443`）。
   - 做法：AI 完成改动后 `git commit`（消息里写清自检结论），并把**待推提交清单**报告给用户；
     用户手动 `git push origin main`（会触发 CI + Pages 重建）。
   - **不要**反复重试推送、不要改用 SSH/代理等旁路；推送受阻时把剩余工作继续做完（Worker 部署走
     `wrangler`，不经 GitHub，可正常执行）。
   - Worker 用 `npm run worker:deploy`，前端靠 Pages——**两者发布节奏不同步**：Worker 侧改动推前就已生效，
     前端改动要等用户推送 + Pages 重建。报告时须显式区分（哪些已生效、哪些等推送）。

## 速查命令

| 目的 | 命令 |
|---|---|
| 开发 | `npm run dev` |
| 构建（类型检查 + 打包） | `npm run build` |
| 测试 | `npm test` |
| 代码检查 | `npm run lint` |
| 抓题库（直连源站） | `npm run bank` |
| 抓题库 + 转码暂存 | `npm run bank:stage` |
| 抓题库 + 直传 R2（S3 凭证，带远端） | `npm run bank:r2` |
| 全球增量采集（023 P2：骨架取种 → 台账 `data/manifest-global.json`，断点续跑，不碰主 manifest） | `npm run bank:global -- --media stage --limit N` |
| 把 `public/media` 传到 R2（wrangler，已内置 `--remote`） | `npm run r2:push` |
| 把 `manifest.json` 传到 R2（`/api/manifest` 优先读它；重建 manifest 后需重跑） | `npm run r2:manifest` |
| 题库一致性校验（CI 已接入；`--no-net` 跳过抽查） | `npm run check:bank` |
| 媒体完整性全量检查（`--fix` 从本地重传缺失文件） | `npm run check:media` |
| 抓 ISO 3166-2 省级基准清单（021 M2，缓存到 data-cache） | `npm run region:subdiv` |
| 构建季节层 / 省级层（`-- --mock` 全离线；产 `public/data/*.json`） | `npm run region:build` / `npm run region:provinces` |
| 构建观鸟点（XC 源；`-- --mock` 离线） | `npm run region:hotspots` |
| 构建观鸟点（GBIF SQL 1° 源 + eBird 命名 + 网格×省补码；**当前正式产物**） | `npm run region:hotspots-gbif -- --ebird-names --cell-provinces <GBIF 下载 key，如 0017635-260928105237408>` |
| 构建全球区系层（GBIF SQL 国家矩阵 → `species-distribution.json`；025 M1） | `npm run region:distribution`（`-- --mock --out …` 离线） |
| 抓 eBird 热点/区划到缓存（需 `EBIRD_API_KEY`） | `npm run region:ebird` |
| GBIF SQL 下载（提交/续传/列表；需 GBIF 账号） | `npm run region:gbif-sql -- --sql "..."` / `-- --key <key>` / `-- --list` |
| 地区 SQL 对照校验（仅报告，不改产物） | `npm run region:verify-provinces` / `region:verify-seasonality` / `region:verify-hotspots` |
| 地区产物校验（结构/署名/无边界几何/观鸟点省码覆盖率地板；CI 用 `-- --no-net`） | `npm run check:region` |
| 名录产物校验（`catalog.json` 结构/计数/manifest/骨架/拼音键；CI 已接入） | `npm run check:catalog` |
| manifest 三层产物校验（core/assets/global 与完整层一致；CI 已接入） | `npm run check:layers` |
| 拉 AviList v2025b（全球名录 xlsx → data-cache/taxonomy，gitignore；CC BY 4.0） | `npm run taxonomy:avilist`（`--refresh` 重下） |
| 抓 Wikidata 中文名（specieswiki 标题反查，断点缓存；CC0） | `npm run taxonomy:wikidata-zh`（`--limit N` 冒烟 / `--refresh` 重抓） |
| GBIF backbone 批量键位匹配（v2 match → 断点缓存；023 P1-b） | `npm run taxonomy:gbif-match`（`--limit N` 冒烟 / `--refresh` 重抓） |
| 构建全球物种骨架（`species-index.json` 11,131 种 + manifest 只增 `taxonKey`/`playable`；023 P0） | `npm run species-index`（`-- --mock --out …` 全离线） |
| 物种骨架校验（结构/署名/1299 映射/无几何；CI 已接入） | `npm run check:index` |
| 生成 D1 seed | `npm run d1:seed` |
| D1 建表 / 灌数据（务必 `--remote`） | `wrangler d1 execute uniaoer --file=worker/schema.sql --remote` |
| D1 用量取证（按天/按小时读写，Cloudflare GraphQL；需已 `wrangler login`） | `npm run d1:usage -- --days 3`（`--db uniaoer` / `--hourly-only`） |
| 媒体 WebKit 回归（iPhone Safari/Edge 音频播放 + SW 缓存形态；需 `npm run build` + 首次 `npx playwright install webkit`） | `npm run check:media-webkit`（`-- --all` 含对照组） |
| 三源一致性校验（仓库/R2/D1/Pages；**改完 D1 相关代码必须手动跑**，CI 不跑） | `npm run check:sync` |
| Worker 本地调试（绑定远端 D1/R2） | `npm run worker:dev` |
| Worker 编译自检（不部署） | `npm run worker:check` |
| Worker 部署（挂 `uniaoer.com/api/*`） | `npm run worker:deploy` |
| 下沉 XC 密钥到 Worker secret（值从 `.env` 管道传入） | `wrangler secret put XC_API_KEY -c worker/wrangler.toml` |
| 查看用户报错（管理，需 `ADMIN_KEY`，见 `.env`） | `curl -H "x-admin-key: $ADMIN_KEY" "https://uniaoer.com/api/reports/admin?status=open"` |
| 纠正/处理报错（管理） | `curl -X PATCH -H "x-admin-key: $ADMIN_KEY" -H 'content-type: application/json' -d '{"status":"fixed"}' https://uniaoer.com/api/reports/<id>` |
| **看匿名计量数据**（028，管理；默认近 30 天，`days` 可调） | `source .env && curl -s -H "x-admin-key: $ADMIN_KEY" "https://uniaoer.com/api/metrics/summary?days=30" \| jq` |
| 直接查计量原始行（按日/事件/属性） | `wrangler d1 execute uniaoer --command "SELECT day,event,props,n FROM metrics_daily ORDER BY day DESC LIMIT 50;" --remote` |
| 分享页浏览数（管理，按浏览次数降序） | `wrangler d1 execute uniaoer --command "SELECT id,nickname,total,correct,view_count FROM round_shares WHERE hidden=0 ORDER BY view_count DESC LIMIT 20;" --remote` |

## 架构速览

- **前端**：Vue 3 + Vite + TS + Pinia；纯静态 SPA，生产优先读 Worker `/api/manifest`（失败回退 `public/data/manifest.json`）。
- **媒体**：存在 Cloudflare **R2**（`media/<物种id>/…`），经公开域名（r2.dev 或自定义域名）访问。
- **元数据**：`manifest.json` 仍是主索引；**D1 已启用**（`uniaoer`：species/media/questions，1299 物种 / 12938 媒体）。
- **后端**：独立 Worker `uniaoer-api`（`worker/`），挂 `uniaoer.com/api/*`：`/api/health`、`/api/manifest`、`/api/questions`、`/api/media/:id`、`/api/reports`（提交/公开列表/投票）、`/api/reports/:id/vote`、`/api/reports/admin`（受保护）；`XC_API_KEY` 存 Worker secret，`ADMIN_KEY` 存 Worker secret（前端不接触）。
- **报错/评审（B6）**：前端报错先存本地（`uniaoer-reports`）再上传；`reports`/`report_votes` 在 D1；大众评审页 `/reports`（**仅 `published` 公开**）；管理页 `/admin`（密钥解锁，需 Worker `ADMIN_KEY`）——提交=open 不公开，管理方发布后才公开可投票。
- **构建期数据管道**：`scripts/build-bank.mjs` 抓 iNaturalist（图）+ Xeno-canto/iNat（音）→ 许可过滤 → 转码 → R2。
- **许可**：`src/core/licenseGuard.ts` + `scripts/lib/license.mjs`（兼容 XC 的 URL 与 iNat 短码）；`relaxed` 含 NC/ND，`strict` 仅 CC0/BY/BY-SA。
- **用户数据**：仅存浏览器 IndexedDB（`src/core/historyDb.ts`），不上云。

## 验证要求（云操作）

- R2 上传后：`curl -I <公开域名>/media/<物种>/image.webp` → 期望 **200**。
- D1 写入后：`wrangler d1 execute uniaoer --command "SELECT COUNT(*) FROM species;" --remote`。

## 相关文档（本地，不入库；同步到私有 repo `uniaoer-private`）

- `docs/` 文件夹：`000-SUMMARY`（全貌快照）· `006`（任务原始定义与 P3 规划）· `019`（I1/A5 待做方案）· `024`（数据集级许可与署名总表；**新数据源先登记**）。
- 根目录活跃文档：`017`（剩余任务盘点）· `018`（新窗口交接）及其余 `0xx-*.md`（000 数据接入 · 001 重写 · 002 扩展性 · 003/005 D1+R2 · 004 操作指南 · 007/012/014 交接 · 008 数据体系 · 009 称号徽章 · 010 i18n · 011 媒体库 · 013 档案 · 015/016 i18n 迁移/反查）。
