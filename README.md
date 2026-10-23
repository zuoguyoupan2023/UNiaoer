# UNiaoer · 鸟语识别

地球环境正在恶化,我们的健康也是。

是时候放下手机离开电脑走出门去观鸟去保护鸟了!

UNiaoer里面有10000+种鸟的图像或音频,帮你快速认识可爱的小啾啾们。

(本项目为开源非商业项目)

项目描述：用真实的鸟类照片与鸟鸣，练习「看图认鸟」与「听音认鸟」，并提供全球鸟类名录与分布浏览。面向全球观鸟者，中文用户优先起步。

> **非商业 · 开源**
>
> UNiaoer 是**非商业开源项目**，免费使用、无广告、无付费功能、不售卖数据。
> **代码**以 [MIT](./LICENSE) 发布；**图像、音频素材与识别模型不随代码授权**，各自遵循其许可证（见下表）；
> 任何商业用途（含商业产品集成、镜像站、以广告/订阅变现的再分发）需自行取得相应授权。

## 计划中的题型

> 以下是设计草案，**代码、题库、UI 都还没做**；不影响现有 L1–L5。
> 共同点：一组 10 题；**中英文界面都支持**——题目与作答都按当前界面语言显示/匹配（中文名或英文名）；只对有稳定名称的物种出题；判分与出题池细节待定。

### L6 · 半鸟人（名字 → 图像 / 声音）

- **看图版**：题目给一个鸟的俗名（按界面语言显示中文名或英文名，如「白鹡鸰」/「White Wagtail」），下方 **6 个图像选项**，限时 **10 秒**。
- **听音版**：同样给名字（中文或英文，随界面语言），**4 个声音选项**，限时 **25 秒**（听音辨认更难，给更长时间）。
- 定位：把「名字」和「样子/叫声」对上，是看图和听音的反向辨认；比 L1–L5 更依赖对名字的熟悉度。

### L7 · 鸟娲 · 造鸟者（图像 / 声音 → 名字，主动输入）

- **看图版**：上方一张鸟的图，下方输入框；**10 秒**内输入鸟名并提交（按界面语言输入中文名或英文名）。
- **听音版**：给一段鸟鸣，**12 秒**内输入鸟名并提交（同样支持中文名/英文名）。
- 定位：从「选择题」升级到「主动回忆（production）」，难度最高；先做「当前语言的名称精确匹配 + 常见别名/学名容错」，拼音与简繁容错待评估。

## 技术栈

- Vue 3 + TypeScript + Vite
- Vue Router（路由级 code-split）
- Pinia（状态管理）
- Vitest + Vue Test Utils
- ESLint + oxlint + Prettier

## 数据来源与许可

**代码**以 [MIT](./LICENSE) 发布；**图像、音频素材、开放数据集与识别模型不随代码授权**，各自遵循下列许可：

### 媒体素材（逐条署名）

| 来源 | 用途 | 许可与义务 |
|---|---|---|
| [iNaturalist](https://www.inaturalist.org/)（api.inaturalist.org） | 鸟类照片 / 部分鸟鸣 | **逐条 CC**（CC0 / BY / BY-NC / BY-ND…，仅取开放许可）；每条素材在页面标注作者、许可与来源链接；ND 一律原样提供、不转码 |
| [Xeno-canto](https://xeno-canto.org/) | 鸟鸣音频 | **逐条 CC**（录音页标注）；同样逐条署名，ND 不转码 |
| whitenoise.earthtrip.online | 环境鸟鸣 / L5 干扰音 | **本项目自有素材**，无第三方义务 |

### 开放数据集与分类骨架

| 来源 | 用途 | 许可与义务 |
|---|---|---|
| [AviList v2025b](https://www.avilist.org/)（AviList Core Team） | 全球鸟类分类骨架（11,131 种） | **CC BY 4.0**；产物 `species-index.json` 带 `citation` 与 `sources[]` |
| [GBIF](https://www.gbif.org/)（occurrence + backbone） | 分布 / 省级常见度 / 季节 / 观鸟点 / 分类键位 | **逐条 CC0 / CC BY / CC BY-NC**；每个下载在产物中记录数据集 DOI 与署名 |
| [eBird](https://ebird.org/)（Cornell Lab，API v2） | 观鸟点 / 区划（就近命名） | **非商业；需署名；不得再分发原始数据**；本项目只发布派生结果（≥6 种 + 0.25° 网格去重） |
| [ISO 3166-2](https://github.com/alexander-schranz/iso-3166-2) | 一级行政区基准 | **MIT** |
| 《中国鸟类的生活史和生态学特征数据集》(2021) | 居留型（迁徙 / 留鸟） | 开放数据论文，**按学术惯例引用**（数据集页未明示 CC）；仅非商业使用 |
| [Wikidata](https://www.wikidata.org/) | 物种中文名、**科中文名** | **CC0 1.0**；经 Action API 以 specieswiki 标题精确反查 |
| [IUCN Red List](https://www.iucnredlist.org/)（API v4） | 结构化生境与系统 | **非商业；必须引用**；不商业化、不再分发原始数据集 |
| [AVONET](https://doi.org/10.1111/ele.13898)（Tobias et al. 2022） | 形态测量 / 生态变量 | **CC BY 4.0** |
| [EltonTraits 1.0](https://doi.org/10.1890/13-1917.1)（Wilman et al. 2014） | 食性 / 取食层次 / 夜行性 | 论文配套数据，**引用即可** |
| [Dunning et al. 2025](https://doi.org/10.5061/dryad.jq2bvq8jg) | 羽色（12 类色相 × 雄/雌） | **CC0-1.0**（仍保留引用以便追溯） |
| 维基百科（zh / en） | 叙述性识别特征（登记，尚未落地） | **CC BY-SA 4.0**（有传染性，落地时须标注许可与原文链接） |

### 识别模型（浏览器本地推理）

| 模型 | 用途 | 许可 |
|---|---|---|
| [BirdNET v2.4](https://github.com/kahst/BirdNET-Analyzer)（Cornell Lab） | 听音识别（6,522 类，WASM 本地推理） | **CC BY-NC-SA 4.0**（非商业；署名 + 相同方式共享） |
| [OSEA](https://huggingface.co/sunjiao/osea)（Sun Jiao） | 看图识别（11,000 类，WASM 本地推理） | 权重 **attribution-only**（署名即可用）；其代码为 **GPL-3.0**，本项目**未使用**其代码；训练集 DIB-10K 图片版权需商用前另行评估 |

- **逐条素材许可以每张图/每段音频自带的声明为准**（如某条音频为 CC BY-NC，则该条适用该许可）；页面每题、每个物种页都展示署名。
- 许可策略可在「设置」中切换：宽松（含 CC BY-NC，非商业可用）/ 严格（仅 CC0 / BY / BY-SA）。
- 许可过滤与署名逻辑：`src/core/licenseGuard.ts`、`scripts/lib/license.mjs`；地区 / 季节 / 观鸟点署名见 `scripts/check-region.mjs`。
- 识别在本机完成（Web Worker + onnxruntime-web），录音与照片不上传。

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
- ✅ i18n（zh-CN / en，875 keys，CI 门禁）· 无障碍（H3）· E2E（Playwright 13 条，全离线）
- ✅ 全球扩张（数据层）：AviList v2025b 全球骨架 `species-index.json`（11,131 种）+ manifest 增 `taxonKey`/`playable`；中文名 5,808 种（curated 优先 + Wikidata CC0）；backbone 映射 10,892/11,131；全球区系层 `/region`（249 国）+ 无媒体种轻量详情页
- ✅ 全球媒体采集：**11,026 种可玩**（图 10,888 / 音 10,356）已上传 R2，逐条署名，ND 不转码
- ✅ 全量名录 `/catalog`：**11,026 种 / 46 目 / 252 科**按目 → 科 → 种浏览（科名 224/252 有中文）；**分类序 / 拼音 / 常见度**三态排序（拼音键与常见度档位构建期预计算）+ A–Z 字母跳转 + 拼音搜索
- ✅ 匿名计量与分享增强：**匿名事件计数**（无 cookie/设备标识/IP，设置页可关闭）；分享页 **OG 社交预览**、**访问计数**、**离线补传**
- 🚧 进行中：玩法集成（P3）——全球池进题、manifest 分层加载、常见度分档、媒体质量反馈闭环（规划见 `docs/029`）

## 隐私

- **成绩与档案只存本机**：轮次记录、错题本、徽章/称号、昵称、分享管理令牌均在浏览器 IndexedDB / localStorage，不上云。
- **匿名统计（可关闭）**：全站只做**事件计数**——日期 × 事件类型（如"完成一轮""浏览地区页"）× 少量枚举属性（题型 `image/audio`、难度 `L1–L5`、页面类目、**精确得分 correct/total**）。
  无 cookie、无设备指纹、无持久标识、不存 IP/UA；计数表不含任何可关联个人的键。设置页「匿名统计」关闭后前端完全不上报。
- **独立访客的去重方式**（这也是「为什么给不出全站累计独立人数」的原因）：只保存 `sha256(日盐 | 日期 | IP | UA)` 的截断哈希，
  **盐每天随机轮换**（存在 `meta`，不随日志外泄），因此同一个人的哈希**跨日不可关联**——
  看板能给出的是「按日去重后逐日累加的访问人次」，而不是跨日去重的独立人数；原始 IP/UA 只在内存里参与一次哈希，**不落库**。
- **省际统计（可选，默认关）**：只有用户主动开启「允许按省级归属地统计」后，才按 Cloudflare 给出的 IP **省级归属地**做聚合
  （只落 `CN-32` 这类省码，原始 IP 不落库、不定位到城市）；港澳台计入中国省级（中国香港／中国澳门／中国台湾）。
  默认关闭，设置页可随时关掉；不开这项时，上一条的匿名计数照常、但不产生任何省级数据。
- **鸟种级错误率（观察期，未公开）**：逐题上报「鸟种 + 对/错 + 答错时错认成哪种鸟 + 题目地区 + 水平」，
  **不含用户、设备、省份维度**（与省际统计是两条独立事件，库里无法交叉关联）；只做聚合、样本不足不展示，
  公开页暂不展示，先只在管理端观察。
- **用户主动分享**：单轮成绩链接仅由用户点击生成，内容仅该轮题目与媒体链接；可随时撤回（撤回后他人 404）。分享页 `noindex`，不鼓励搜索引擎收录。

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

## 关注 / 联系

- GitHub：[zuoguyoupan2023](https://github.com/zuoguyoupan2023) · 项目仓库 [uniaoer](https://github.com/zuoguyoupan2023/uniaoer)
- 小红书：**左顾右盼**（小红书号 `zuoguyoupan2026`，在 App 内搜索这个号即可）

---

> **特别致谢：感恩蓝色大肥鱼DeepSeek的辛勤工作！**
