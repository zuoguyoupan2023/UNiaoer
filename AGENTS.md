# AGENTS.md — UNiaoer 开发约定

给在此仓库工作的 AI / 协作者的硬性规则与速查。

## 最高原则（2026-11-03 用户定，凌驾于一切技术与产品取舍之上）

> **本项目存在的唯一目的：帮助做题人更好地辨识各种鸟。**

任何设计、改动、优化、取舍，都要回到这一条上判断：

- **要问的是「这能不能让做题人更快/更准地认出鸟」**，而不是「这个功能更酷 / 代码更优雅 / 数据更全」。
- **重复不是问题**：同一批鸟反复出现、选项反复出现，只要不是「题目 + 选项」完全相同，都属于**有意为之的刷题训练**——
  项目本质就是刷题，让「XX 鸟有 YY 特点、叫 ZZ 名字」这种联结被反复强化。
- **选项即教材**：一道题的 4 个选项就是 4 只鸟的对照样本。所以作答后**必须同时给出**每只鸟的名字与
  作者/许可证（见铁律 11），让做题人顺带记住「A 是这个鸟、B 是那个鸟」。
- **减少无谓的门槛**：难度可以体现在「鸟长得像、名字像」，不应体现在「操作繁琐 / 加载慢 / 规则复杂」。
- 与其它规则冲突时，**以本条为准**；若本条与现有实现矛盾，先报告再改。
### 图像素材不足时的取舍（2026-11-08 用户定，属最高原则的延伸）

> **认的不止是鸟，而是和鸟相关的一切。** 生境、群居、巢、觅食、育雏，都是「认识这种鸟」的一部分。

当某个鸟种**找不到更合适的图**时，以下图像**可以放进物种详情画廊**，不必强求「单只、清晰、正面」：

- **剪影 / 逆光**：空中飞版（雨燕、针尾雨燕、隼、鵟等几乎只能在空中记录）；
- **带水印**：水印是摄影师的署名权利，保留原样，不要裁掉；
- **洞穴 / 巢群 / 群居照**：金丝燕类等洞穴繁殖鸟，绝大多数公开照片都是这类；
- **生境照**：主体在画面中占比小，但能说明它生活在什么地方；
- **背面 / 侧面 / 远景**：总比没有强；
- **幼鸟 / 巢寄生生态照**：能说明繁殖习性，即使画面里还有寄主等其他鸟；
- **模糊**：在没有更清晰替代品时也可用。

**前提不可颠倒**：先找更清晰、更合适的图；**只有确实没有更好的**，才降级采用上述类型。
不能拿「生境照也可以」当成不认真找图的借口。

**降级采用时必须在物种详情（data/species-notes.json）写清三件事**：

1. 这张／这几张拍的是什么、为什么不能作为识别题面；
2. 图源是哪儿（iNaturalist / eBird / Xeno-canto 等），以及该图源上这个种的现状
   （例如「该种几乎全是洞穴巢群照」「全站仅 5 条观察」）；
3. 欢迎投稿：**可选用 Creative Commons 系列许可协议，也可采用投稿者认可的其他许可方式**，
   具体可再商定；采用后按要求署名。联系方式：**小红书 左顾右盼**。

**投稿协议不是强迫**：CC 系列只是可选方案之一，不得写成「投稿即表示同意 CC 协议」。

**致谢署名**：由用户反馈发现的问题，答疑里统一写「**小红书网友 无心核酸酶**」，不要写多个不同 ID。


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
   - **CI 不阻塞 Cloudflare Pages 部署**（2026-10-19「做题白屏」事故，见 `docs/063`）：`git push` 一落地
     Pages 就自己构建发布，GitHub Actions 是**并行**跑的 → **CI 红了也照样上线**。所以产物类改动
     **推送前必须在本机跑门禁**：`npm run verify:push`（= `type-check` + `check:layers` + `check:index`
     + `check:traits` + `check:changelog`）。
     已挂 `.git/hooks/pre-push`（换机后 `npm run hooks:install` 重建；`git push` 时自动跑，`--no-verify` 可跳过但不推荐）。
   - **`type-check` 必须用 `npm run type-check`（`vue-tsc --build`），不能用 `npx tsc --noEmit`**。
     2026-11-03 事故：Pages 的 `type-check` 走 `tsconfig.vitest.json`，**包含测试文件**；
     而裸 `tsc --noEmit` 既不检查 `.vue` 的 setup 作用域，也不覆盖测试引用 →
     本地"类型通过"、Pages 报 `TS2741` 整次部署报废（线上停在旧版本，用户看到的是几轮之前的前端）。
     **测试 fixture 必须给必填字段补全**（如 `MediaAsset.speciesId`），并**显式标注返回类型**
     （`function media(...): MediaAsset`）——靠对象字面量推断会漏必填字段。
   - **`npm run build` 现在自带部署体积门禁**（`check:dist-size`，已挂进 build）：Cloudflare Pages 对
     **单个文件有 25 MiB 上限**，超了整次部署会在上传阶段失败，而本地/CI 全绿 → 线上静默停在旧版本。
     2026-10-17 事故：`import 'onnxruntime-web'` 带进 27 MiB 的 WebGPU wasm，导致连续两次部署 Failure
     （改引 `onnxruntime-web/wasm` → 13.58 MiB）。**新增依赖后务必看构建末尾的门禁输出。**
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
   - **不因为数据缺少而折叠任何地区（2026-10-23 用户定）。** 布韦岛（BV）、赫德岛（HM）、皮特凯恩（PN）这类
     属地只有几十条记录，也必须和中国、美国一样正常列出、正常显示「GBIF N 条」——**不设记录量门槛**；
     地区条目数只由 GBIF `countrycode`（ISO 3166-1，249 个码，含属地）决定，只排除 `ZZ/XK/XZ`。

7. **i18n 文案的 `{x}` 由 vue-i18n 插值，不是自定义占位符。**
   - `t(key)` **不带参**取值会把 `{name}` 替换成**空串**；"先取模板、再 `.replace('{x}', …)`" 的写法必然失效
     （海报错题行曾因此渲染成空括号「」——见 `docs/034`）。
   - 一律**带参一步到位**：`t(key, { name })`；`grep -rn "replace('{" src/` 应为空。
   - **`@` 也是 vue-i18n 的语法**（链接消息 `@:key`）：文案里写账号/邮箱**不要用裸 `@`**
     （`小红书 @左顾右盼` 会导致编译失败、整块页面空白，`SyntaxError: <位置数字>`）。
     用「账号：xxx」或转义 `{'@'}`；报错栈常落在共享 chunk，易误判成图标/组件问题（见 `docs/010` §9）。
   - 画布类渲染（`poster.ts`）沿用**函数式注入**模式（如 `PosterStrings.mistakenAs: (name) => string`）。

8. **推送（`git push`）由用户执行；`git commit` 也须先经用户同意（2026-10-24 起，见铁律 13）。**
   - 原因：`https://github.com` 在本机常年超时/被网络拦截，且沙箱进程读不到 macOS 钥匙串凭据
     （报错形态：`could not read Username for 'https://github.com'` 或 `Failed to connect to github.com port 443`）。
   - 做法：AI 完成改动后**报告改动清单与自检结论**，由用户决定是否 commit；push 清单一并报告，
     用户手动 `git push origin main`（会触发 CI + Pages 重建）。
   - **不要**反复重试推送、不要改用 SSH/代理等旁路；推送受阻时把剩余工作继续做完（Worker 部署走
     `wrangler`，不经 GitHub，可正常执行）。
   - Worker 用 `npm run worker:deploy`，前端靠 Pages——**两者发布节奏不同步**：Worker 侧改动推前就已生效，
     前端改动要等用户推送 + Pages 重建。报告时须显式区分（哪些已生效、哪些等推送）。

9. **前端 UI 不堆解释文案（2026-11-01 用户定）。**
    - UI 文案保持**最短**；数据口径、字段含义、覆盖范围等解释**一律放代码注释与 docs/**，不进界面；
    - 禁止「点开一层说明、里面还有一层说明」的嵌套解释 UI；帮助/口径类内容只允许出现在
      关于页/FAQ 等专门的文档型页面；
    - 新增任何说明性文案（注记、脚注、提示行）**先问用户**，默认不加。
    - **不给用户给的内容加标题/标签/小标题**。用户说「写宣传语」，界面就只显示宣传语本身——
      不要自作主张加「观鸟伦理」「温馨提示」这类抬头（2026-11-03 用户强烈反对）。

10. **用户给的文案一律原文使用（2026-11-03 用户定，反复强调过）。**
    - **不要拆成变体、不要改写、不要"优化"**：用户写「不要诱拍！不要诱拍！不要诱拍！」就用这一句，
      不要改成「不要诱拍 / 不要用回放引诱鸟类」这种两条并列。
    - **不要加解释性补充**：用户没要求"为什么"，就不要在文案里、注释里解释一句"这样写是因为…"。
    - **大小写等瑕疵该正确书写就正确书写**（如英文句首大写），但不引入用户没要求的风格变化。
    - 用户一句话里给了多组内容（如中英各一句），就逐条照排，不要合并、不要重排、不要删重。

10-a. **禁止把答题说成「玩」（2026-11-05 用户第四次强调后成文，违反即返工）。**
    - **本项目是严肃的鸟类辨识**，不是游戏。用户原话：「这是严肃的试题，不是玩」。
    - **UI 文案、i18n 文案、代码注释、文档、提交信息——一律不得出现「玩」「试玩」「去玩一局」
      「可玩」「玩家」这类措辞**；英文对应禁 `play` / `playable` / `player` / `play a round`
      作为「答题」的动词或名词。
    - **正确措辞**：答题、做题、刷题、练习、训练、作答、试题、题库、鸟种、出题、可出题、
      该地鸟种数。英文用 `answer` / `quiz` / `practice` / `session` / `species` / `questions`。
    - **`playable` / `playableImage` / `playableAudio` 是既有产物字段名，属数据 schema，不改名**
      （改名要重跑产物 + 改 D1），但**不得把这种措辞带到任何用户可见文案或新增注释里**；
      写注释时用「有素材 / 可出题」代替「可玩」。
    - **媒体播放类的 `play` 是唯一例外**（播放鸟鸣/音频、`playCall`、`playBtn` 等指音频播放），
      与「答题」无关，不受此条约束。
    - 新增/修改任何用户可见文案前，`grep -n "玩" src/i18n/locales/` 自查一遍。

11. **答题界面的署名义务：选项是图片时，作答后必须给出每个选项的鸟名 + 作者 + 许可证（2026-11-03 用户定）。**
    - **出自最高原则**：选项是教材，做题人要能看清「A 是这个鸟、B 是那个鸟」；同时 CC BY/BY-NC
      等许可证要求署名，作答前不显示（避免泄题），**作答后必须显示**。
    - 适用范围：**选项是图片的选择题** —— 即 S1「看名选图」（`stemName`）与 **L6 识图模式**。
      这类题的图片上不能放文字（泄题），作答后必须补名字与署名。
    - **不在选项是文字的题里显示**（经典看图选名、S1 看图选名）：选项列表本身就写着鸟名，
      再列一遍属重复文案（铁律 10）。
    - 展示形式（`src/components/AnswerReview.vue`）：分**两块集中显示** ——
      ① 选项对照（A/B/C/D → 鸟名，标注正确答案与错选）；② 图片来源（每张图 → 作者 · 许可证）。
      不要每张图下各挂一行（拥挤且信息不全）。
    - `OptionMediaList` 的 `alt=''` 是**作答前**的防泄题设计，作答后由 `AnswerReview` 补上名字与署名。

12. **图片选项的触摸交互：图片只负责看大图/滚动，作答只走右上角方框（2026-11-03 用户定）。**
    - **解决的是真实冲突**：手机上「上下滚动」和「点选答案」若共用「点图片」这一个动作，
      只能靠位移/时长阈值去猜，惯性滚动与手指抖动必然误判（旧 `SWIPE_MAX_DY` 即此类方案）。
    - **分离到不同元素，不用阈值猜**：图片本体单击 = 看大图、按住拖 = 浏览器滚动（不设
      `touch-action`、不 `preventDefault`）；**右上角白色方框是唯一作答入口**（热区 ≥44px）；
      键盘 1–4 / A–D 保留。
    - **标号与状态分离**：`A/B/C/D` 在**左上角**（纯标号，`pointer-events:none`，不拦截点击）；
      作答/状态方框在**右上角**。不要把字母塞进方框里——那会让「选项编号」和「已选状态」混淆。
    - **方框状态**：未作答 = **纯空白方框**（绝不画勾号——会让人误以为已选中）；
      作答后正确项 = 绿底白勾，其余 = 红底白叉（刷题要看清楚自己错在哪，不要灰化）。
    - **一次性首次提示**：每个模式第一次进答题时，在第一个选项的方框左侧弹 2.4s「点这里选择」
      （轻微缩放呼吸 + 小三角指向方框），**作答即消失**；用 `localStorage` 按模式记标记
      （`uniaoer-hint-shown:<mode>`），跨刷新/跨会话永不再弹。两个模式（L6 / S1 看名选图）各自独立计数。
    - **桌面 / iPad / 手机同一套**，不按 UA 分叉；iPad 也有触摸屏，分叉反而制造不一致。
    - 适用组件：`OptionMediaList.vue`（L6 识图 + S1 看名选图共用）。听音版仍为
      「点按试听 → 再点同一项作答」，不受此条约束。

13. **云端资源、发布与提交操作必须先经用户确认（2026-10-21 用户要求；2026-10-24 强化：一律先停下来问）。**
   - **（2026-10-24 总则，覆盖下面一切情形）凡是「修改 D1 / R2 / Worker 的数据、结构、代码或配置」、
     「部署 Worker / 写 R2 / 写 D1」（`worker:deploy`、`r2:push`、`r2:manifest`、`wrangler d1 execute --remote`、
     `sync:prod` 等）、「`git commit`」、「`git push`」——AI 必须**先停下来**，把要执行的命令、影响范围、
     回滚方式列成清单，等用户逐项决定后再执行；**不允许默认直接执行，也不允许「先做了再报告」**。
     本地文件/产物改动、只读排查不受限。
   - **R2 / D1 / Worker / Pages** 的数据、结构、代码、配置，以及**任何会写云端或发布产物的脚本**
     （`r2:push`、`r2:manifest`、`sync:prod`、`d1:execute`、`worker:deploy`、`bank:r2`、
     会重建并提交 `public/data/*` 的构建脚本等），**执行前必须说明：要改什么、影响范围、回滚方式**，
     并取得用户明确同意后才可运行。
   - **`git commit` 不再是默认动作**：改动完成后先报告「已改哪些文件、自检结果」，commit 与否由用户决定；
     `git push` 永远由用户执行（铁律 8）。
   - 只读排查（`curl`、`SELECT`、`wrangler r2 object get`、`git status`）不受限；
     **任何写操作**（含删除、覆盖、批量导入、purge）都要先问。
   - 违反代价：2026-10 的统计缓存事故、D1 写入额度事故都属「脚本直接跑了」类问题，恢复成本远高于先问一句。
   - **（2026-11-05 加固）四类操作已加代码级闸门 `scripts/lib/cloud-guard.mjs`**：
     ① 写 R2、② 写 D1、③ `worker:deploy`、④ `git commit` / `git push`。
     闸门规则：
     - **默认 dry-run**：不带 `--apply` 一律只打印计划、不写云端（`push-r2-data` / `push-r2` /
       `sync:prod` / `bank:r2` 已改）；
     - **非 TTY 直接拒绝**（退出码 2）：AI 的 Bash 工具、CI、管道、`nohup` 的 stdin 都不是 TTY
       → **AI 物理上无法代跑云端写**，不依赖自觉；
     - **TTY 下要求手输确认词**（如 `push province-commonness`）才执行，防手滑并留下交互痕迹。
     → AI 的正确做法：准备产物 + 打印待执行命令，**由用户在自己的终端里跑**。
   - **（2026-11-05）分片版本一致性门禁**：`province-commonness/` 只推 R2、不进 git，
     曾出现「本地/索引是 10 档、R2 停留 5 档」达 7 天无人发现（见 `docs/105`）。
     - CI 跑 `npm run check:tiers:local`（本地分片清单/档位数/省码数/generatedAt）；
     - 推 R2 前后与前端发布前，人工跑 `npm run check:tiers`（含 R2 远端比对，抽样 10 国）；
     - 改动档位产物后必须「重建 → `check:tiers` → 推 R2 → 再跑 `check:tiers` 确认远端一致」。
   - **（2026-11-07）D1 专项——`schema.sql` 禁止单独执行、`--file` 必须先通读**
     （2026-11-06 事故：schema.sql 被单独执行，其中 `DROP TABLE species` 清空了
     11,026 行出题数据，前端静默降级到本地池一天无人察觉；见
     `docs/000-SOP-D1防灾备份与恢复标准流程.md` §6）。
     - **`worker/schema.sql` 含 `DROP TABLE species/questions/media`，禁止单独执行**——
       它必须与 `seed.sql` 配对（`sync:prod` 的内部步骤）。单独跑 = 只删不灌。
       给出任何 `d1 execute --file=worker/schema.sql` 的指令**之前必须先通读该文件全文**；
     - **任何 `wrangler d1 execute --file=<文件>` 都不经过 cloud-guard**——执行前必须
       人工通读目标文件，确认无 `DROP`/`DELETE`/`UPDATE`（或这些正是意图且已获批），
       并把「执行了什么、影响哪些表」写进报告；
     - **派生表（species/questions）空了不慌也不用手动补数据**：它是从 git 构建产物
       重建的读模型，恢复 = `npm run sync:prod`（≈43,410 行写入，当日额度 43%，单日最多 2 次）
       → `check:sync` → 验证出题 API；
     - **Time Travel 是整库回滚**（破坏性、原地、7 天窗口），只用于用户数据（reports/
       round_shares/metrics）丢失的兜底；恢复派生表**禁止**用 Time Travel；
     - **定期备份用户数据**：每周 `npx wrangler d1 export uniaoer --remote
       --output=store/d1-backups/<带时间戳>.sql`（存本地，gitignore；操作卡见 SOP §5）。

14. **绝对不要杀用户启动的进程（2026-11-05 用户定，多次违反后成文）。**
    - **`npm run dev`（及任何用户自己起的 server / watch 进程）不许 `kill` / `pkill` / `fuser` /
      重启 / "顺手清理"。** 用户为此多次被逼中断工作。
    - 验证页面**复用用户已在跑的 dev server**（`curl -s http://localhost:5173/` 探活后直接用）；
      确需独立环境时，起在**别的端口**并在报告里写明 PID，用完只杀**自己起的那个精确 PID**
      （先 `lsof -nP -iTCP:<port> -sTCP:LISTEN` 核对）。
    - 修 bug 需要重启验证时：改完文件靠 Vite HMR 热更新，**不要重启服务**。

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
| **全球 5+5 采集（推荐：一键托管，含批量推送与内存/磁盘看门狗）** | `nohup npm run bank55 &`（并发用 `BANK55_CONCURRENCY=N`，默认 8；观测 `/tmp/bank55-supervisor.log` + `/tmp/bank55.log`）。⚠️ **别再手动起 `build-bank`** —— 监管器会「收养」已跑进程，两套并行会抢同一台账 |
| 把 `public/media` 传到 R2（wrangler，已内置 `--remote`） | `npm run r2:push -- --apply`（默认 dry） |
| 把 `manifest-meta.json` 传到 R2（`/api/manifest-meta` 读它；`npm run layers` 重算后需重推） | `npm run r2:manifest` |
| 题库一致性校验（CI 已接入；`--no-net` 跳过抽查） | `npm run check:bank` |
| 媒体完整性全量检查（`--fix` 从本地重传缺失文件） | `npm run check:media` |
| 抓 ISO 3166-2 省级基准清单（021 M2，缓存到 data-cache；本机 jsDelivr 主站不通，脚本自动回退 fastly/gcore 入口） | `npm run region:subdiv` |
| **省级层覆盖率干跑**（只读；按记录加权算「GBIF 省名 → ISO 码」可映射比例；<90% 的国家仍发布，但前端标注「仅覆盖 X%」） | `npm run region:coverage -- --countries TH,MY,ID`（`--json` 出全量报告） |
| 构建季节层 / **省级层（194 国，按省×学名切法）** | `npm run region:build` / `npm run region:provinces`（旧切法 `region:provinces:legacy` 仅供交叉校验） |
| **国家层记录数（249 个国家/地区码，零新下载）**（P0-5；产 `public/data/region-records/`） | `npm run region:records`（`-- --dry` 只看统计） |
| **重建省级出题档位**（从省级分片算，无需 GBIF 下载；**分片只推 R2、不进 git**） | `npm run region:province-commonness -- --from-provinces` |
| **省名别名自动建议**（低覆盖国；只收唯一最佳、领先 ≥0.15 的匹配） | `npm run region:suggest-aliases -- --write`（产 `scripts/region/aliases-auto.mjs`） |
| **把档位分片推 R2**（云端写，先报备；wrangler 抖动会自动重试） | `node scripts/push-r2-data.mjs --dir public/data/province-commonness --concurrency 2` |
| 构建观鸟点（XC 源；`-- --mock` 离线） | `npm run region:hotspots` |
| 构建观鸟点（GBIF SQL 1° 源 + eBird 命名 + 网格×省补码；**当前正式产物**） | `npm run region:hotspots-gbif -- --ebird-names --cell-provinces <GBIF 下载 key，如 0017635-260928105237408>` |
| 构建全球区系层（GBIF SQL 国家矩阵 → `species-distribution.json`；025 M1） | `npm run region:distribution`（`-- --mock --out …` 离线） |
| 抓 eBird 热点/区划到缓存（需 `EBIRD_API_KEY`） | `npm run region:ebird` |
| 构建附近观鸟点产物（eBird 派生子集 + GBIF 网格去重；039 P1） | `npm run region:nearby-spots`（`--min-species 50 --cell-deg 0.25`） |
| GBIF SQL 下载（提交/续传/列表；需 GBIF 账号） | `npm run region:gbif-sql -- --sql "..."` / `-- --key <key>` / `-- --list` |
| 地区 SQL 对照校验（仅报告，不改产物） | `npm run region:verify-provinces` / `region:verify-seasonality` / `region:verify-hotspots` |
| 地区产物校验（结构/署名/无边界几何/观鸟点省码覆盖率地板；CI 用 `-- --no-net`） | `npm run check:region` |
| 名录产物校验（`catalog.json` 结构/计数/manifest/骨架/拼音键；CI 已接入） | `npm run check:catalog` |
| manifest 三层产物校验（core/assets/global 与完整层一致；CI 已接入） | `npm run check:layers` |
| **档位分片版本一致性**（本地：清单/10 档/省码数/generatedAt；CI 已接入） | `npm run check:tiers:local` |
| **档位分片版本一致性（含 R2 远端比对，抽样 10 国）**——推 R2 前后必跑 | `npm run check:tiers` |
| **全量地区池核算**（188 国 × L1/L2-3/L4-5/L6+ 池大小与实测百分比；只读） | `npm run report:tiers`（`-- --json` / `-- --country CN,US` / `-- --locale en`） |
| **推省级档位分片到 R2**（云端写；默认 dry，须 TTY 手输确认词） | `node scripts/push-r2-data.mjs --dir public/data/province-commonness --apply` |
| 拉 AviList v2025b（全球名录 xlsx → data-cache/taxonomy，gitignore；CC BY 4.0） | `npm run taxonomy:avilist`（`--refresh` 重下） |
| 抓 Wikidata 中文名（specieswiki 标题反查，断点缓存；CC0） | `npm run taxonomy:wikidata-zh`（`--limit N` 冒烟 / `--refresh` 重抓） |
| GBIF backbone 批量键位匹配（v2 match → 断点缓存；023 P1-b） | `npm run taxonomy:gbif-match`（`--limit N` 冒烟 / `--refresh` 重抓） |
| 构建全球物种骨架（`species-index.json` 11,131 种 + manifest 只增 `taxonKey`/`playable`；023 P0） | `npm run species-index`（`-- --mock --out …` 全离线） |
| 物种骨架校验（结构/署名/1299 映射/无几何；CI 已接入） | `npm run check:index` |
| **结构化生境**（IUCN v4；断点缓存；产物 `data/iucn-habitats.json`） | `npm run taxonomy:iucn-habitat -- --scope core\|all --concurrency 2 --delay 1200`（`--build-only` 只读缓存重算 / `--limit N` 冒烟）。⚠️ **必须带浏览器 UA**，否则 Cloudflare 1010 会伪装成凭证失效的 403 |
| **形态测量 + 生态变量**（AVONET；CC BY 4.0；`taxonKey` 直连 + 学名兜底，覆盖 95.1%） | `npm run taxonomy:avonet`（镜像先用 `--verify` 校验行数 11,009 与列名） |
| **食性 / 取食层次 / 夜行性**（EltonTraits 1.0；覆盖 84.0%） | `npm run taxonomy:elton`（原始表**非 UTF-8**，须 latin-1 解码） |
| **羽色 12 类色相 × 雄/雌 + 雌雄异色**（Dunning 2025；**CC0**；**稀疏层，源表仅 1,287 种**） | `npm run taxonomy:plumage`（先 `--verify` 校验官方 sha256；Datadryad 有反爬，需浏览器手动下载到 `data-cache/taxonomy/plumage/`） |
| 结构化性状产物门禁（许可/引用留痕、taxonKey 键合法、食性和、插值可追溯、habitat code 中文对照齐备） | `npm run check:traits` |
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

- **前端**：Vue 3 + Vite + TS + Pinia；纯静态 SPA，名单源 = 权威名录层 `manifest-meta.json`（先读 Pages 静态 `/data/manifest-meta.json`，失败回退 Worker `/api/manifest-meta` 读 R2）；媒体走 `assets` 分片。`public/data/manifest.json` 与 `/api/manifest` 已退役（P5，86db878）。
  - **SW 缓存失效标记 = 构建期生成的 `data/build.json`（每次部署都变）**。别再用 `manifest-meta.generatedAt`
    当标记：只重建前端/对表产物时它**不变** → 缓存永不清，用户一直看到旧数据
    （2026-10-17 事故：线上产物已修好，浏览器里还是旧的，识别出的白头鹎被误判「暂无素材」）。
  - `/data/model-labels-*`、`data/assets/*` 都是 cache-first，改产物后**必须**确认部署 + 用户端失效。
- **媒体**：存在 Cloudflare **R2**（`media/<物种id>/…`），经公开域名（r2.dev 或自定义域名）访问。
- **元数据**：`manifest-meta.json` 是唯一名单源（11,026 种）；**D1 已启用**（`uniaoer`：species（首图首音内联，11,026 行 = 核心 1,299 + 全球池）/questions；`media` 表 2026-10-08 并入 species 后 DROP）。
- **后端**：独立 Worker `uniaoer-api`（`worker/`），挂 `uniaoer.com/api/*`：
  `/api/region-tiers/<CC>[.country].json`（省级出题档位分片，读 R2 + 边缘缓存 1 天；分片不进 git）、`/api/health`、`/api/manifest`、`/api/questions`、`/api/media/:id`、`/api/reports`（提交/公开列表/投票）、`/api/reports/:id/vote`、`/api/reports/admin`（受保护）；`XC_API_KEY` 存 Worker secret，`ADMIN_KEY` 存 Worker secret（前端不接触）。
- **报错/评审（B6）**：前端报错先存本地（`uniaoer-reports`）再上传；`reports`/`report_votes` 在 D1；大众评审页 `/reports`（**仅 `published` 公开**）；管理页 `/admin`（密钥解锁，需 Worker `ADMIN_KEY`）——提交=open 不公开，管理方发布后才公开可投票。
- **构建期数据管道**：`scripts/build-bank.mjs` 抓 iNaturalist（图）+ Xeno-canto/iNat（音）→ 许可过滤 → 转码 → R2。
- **许可**：`src/core/licenseGuard.ts` + `scripts/lib/license.mjs`（兼容 XC 的 URL 与 iNat 短码）；`relaxed` 含 NC/ND，`strict` 仅 CC0/BY/BY-SA。
- **用户数据**：仅存浏览器 IndexedDB（`src/core/historyDb.ts`），不上云。

## 验证要求（云操作）

- R2 上传后：`curl -I <公开域名>/media/<物种>/image.webp` → 期望 **200**。
- D1 写入后：`wrangler d1 execute uniaoer --command "SELECT COUNT(*) FROM species;" --remote`。

## 标准操作流程（SOP，特殊编号 000，**动手前先读**）

| Sop | 什么时候读 | 文件 |
|---|---|---|
| **媒体纠错** | 某物种的图/音有错误、用户报错要结案 | `docs/000-SOP-媒体纠错标准流程.md` |
| **Worker 部署 / 分片重建 / R2 发布** | 改 `worker/**`、重建 `province-commonness/`、推 R2 产物、改 D1 结构 | `docs/000-SOP-Worker部署与分片重建标准流程.md` |
| **D1 防灾备份与恢复** | 跑 `schema.sql`/`seed.sql` 或任何 `d1 execute --file` 之前；出题返 0 题、`species` 为空等数据异常；定期备份 | `docs/000-SOP-D1防灾备份与恢复标准流程.md` |
| **数据口径契约** | 新增/修改地区产物、出题池逻辑，或界面上任何「N 种」数字 | `000-DATA-CONTRACT.md`（仓库根） |

### Worker / 分片 相关速查（细节见 SOP）

```bash
npm run worker:check                                  # 编译自检（不部署）
npm run worker:deploy                                 # 部署（云端写 → 用户执行）
npx wrangler rollback -c worker/wrangler.toml         # 回滚 Worker（秒级）

npm run region:province-commonness -- --from-provinces  # 重建档位（不下载）
npm run check:tiers:local                             # 本地分片校验
npm run report:tiers                                  # 全量地区池核算
node scripts/push-r2-data.mjs --dir public/data/province-commonness --apply  # 推分片+索引（云端写）
npm run check:tiers                                   # 含 R2 远端抽样校验（推完必须跑）
```

> **完整顺序不可颠倒**：重建 → `check:tiers:local` → `report:tiers` → `push-r2-data --apply` → `check:tiers`。
> `push-r2-data --apply` 只是**发布步骤**，不是完整流程；它不重建、不校验、不比对远端。

## 相关文档（本地，不入库；同步到私有 repo `uniaoer-private`）

- `docs/` 文件夹：`000-SUMMARY`（全貌快照）· `006`（任务原始定义与 P3 规划）· `019`（I1/A5 待做方案）· `024`（数据集级许可与署名总表；**新数据源先登记**）。
- 事故与专题：`105`（分片版本漂移）· `106`（边缘缓存策略对比与容量测算）· `107`（D1 读取额度 / 覆盖索引 / 分片降级 + 备份回滚）。
- 根目录活跃文档：`017`（剩余任务盘点）· `018`（新窗口交接）及其余 `0xx-*.md`（000 数据接入 · 001 重写 · 002 扩展性 · 003/005 D1+R2 · 004 操作指南 · 007/012/014 交接 · 008 数据体系 · 009 称号徽章 · 010 i18n · 011 媒体库 · 013 档案 · 015/016 i18n 迁移/反查）。
