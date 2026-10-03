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

5. **涉及媒体许可的改动**，必须保持署名（作者/许可证/来源）与 `canTranscode()`（ND 不转码）。

6. **地图与地区展示（政治敏感性）。**
   - 当前只做**国家/地区文本**，不含地图/边界；未来若上地图，边界须按官方立场处理，**逐项复核后再合并**。
   - 港澳台**单独列出**，显示名必须是「中国香港／中国澳门／中国台湾」（英文 `Hong Kong, China / Macao, China / Taiwan, China`），见 `src/core/region.ts` 的 `REGION_LABEL_KEY` + i18n `region.regions.*`。
   - 南海诸岛、藏南及一切边界归属，按官方表述；不得把有争议地区作为独立国家呈现。

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
| 把 `public/media` 传到 R2（wrangler，已内置 `--remote`） | `npm run r2:push` |
| 把 `manifest.json` 传到 R2（`/api/manifest` 优先读它；重建 manifest 后需重跑） | `npm run r2:manifest` |
| 题库一致性校验（CI 已接入；`--no-net` 跳过抽查） | `npm run check:bank` |
| 媒体完整性全量检查（`--fix` 从本地重传缺失文件） | `npm run check:media` |
| 抓 ISO 3166-2 省级基准清单（021 M2，缓存到 data-cache） | `npm run region:subdiv` |
| 构建季节层 / 省级层（`-- --mock` 全离线；产 `public/data/*.json`） | `npm run region:build` / `npm run region:provinces` |
| 构建观鸟点（XC 源；`-- --mock` 离线） | `npm run region:hotspots` |
| 构建观鸟点（GBIF SQL 1° 源 + eBird 命名；**当前正式产物**） | `npm run region:hotspots-gbif -- --ebird-names` |
| 抓 eBird 热点/区划到缓存（需 `EBIRD_API_KEY`） | `npm run region:ebird` |
| GBIF SQL 下载（提交/续传/列表；需 GBIF 账号） | `npm run region:gbif-sql -- --sql "..."` / `-- --key <key>` / `-- --list` |
| 地区 SQL 对照校验（仅报告，不改产物） | `npm run region:verify-provinces` / `region:verify-seasonality` / `region:verify-hotspots` |
| 地区产物校验（结构/署名/无边界几何；CI 用 `-- --no-net`） | `npm run check:region` |
| 拉 AviList v2025b（全球名录 xlsx → data-cache/taxonomy，gitignore；CC BY 4.0） | `npm run taxonomy:avilist`（`--refresh` 重下） |
| 抓 Wikidata 中文名（specieswiki 标题反查，断点缓存；CC0） | `npm run taxonomy:wikidata-zh`（`--limit N` 冒烟 / `--refresh` 重抓） |
| 构建全球物种骨架（`species-index.json` 11,131 种 + manifest 只增 `taxonKey`/`playable`；023 P0） | `npm run species-index`（`-- --mock --out …` 全离线） |
| 物种骨架校验（结构/署名/1299 映射/无几何；CI 已接入） | `npm run check:index` |
| 生成 D1 seed | `npm run d1:seed` |
| D1 建表 / 灌数据（务必 `--remote`） | `wrangler d1 execute uniaoer --file=worker/schema.sql --remote` |
| Worker 本地调试（绑定远端 D1/R2） | `npm run worker:dev` |
| Worker 编译自检（不部署） | `npm run worker:check` |
| Worker 部署（挂 `uniaoer.com/api/*`） | `npm run worker:deploy` |
| 下沉 XC 密钥到 Worker secret（值从 `.env` 管道传入） | `wrangler secret put XC_API_KEY -c worker/wrangler.toml` |
| 查看用户报错（管理，需 `ADMIN_KEY`，见 `.env`） | `curl -H "x-admin-key: $ADMIN_KEY" "https://uniaoer.com/api/reports/admin?status=open"` |
| 纠正/处理报错（管理） | `curl -X PATCH -H "x-admin-key: $ADMIN_KEY" -H 'content-type: application/json' -d '{"status":"fixed"}' https://uniaoer.com/api/reports/<id>` |

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
