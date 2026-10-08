-- UNiaoer D1 表结构
-- 用法（由 npm run sync:prod 调用）：wrangler d1 execute uniaoer --file=worker/schema.sql --remote
--
-- 分层：
--   · 派生读模型（species / questions）—— 由构建产物重建（worker/seed.sql 重灌）。
--     结构变更直接改本文件；DROP+CREATE 保证结构与数据都与构建产物严格一致
--     （INSERT OR REPLACE 不会清除已下架的行，全量重建才是真正的镜像）。
--     形态：**一物种一行 + 首图首音内联**（题目生成只需要 1 图 + 1 音；
--     完整 5+5 素材由前端 assets 分片提供，见 docs/029 M1/D-029-3）。
--     历史沿革：2026-10-08 前用独立 media 表存 5+5（31,347 行）并把
--     索引建满，一次全量重建写入 22.2 万行，超出 D1 免费额度（10 万行/天，
--     索引维护按行计费）→ 改为内联后一次重建约 3.3 万行（预算 33%）。
--   · 用户数据（reports / report_votes）与指纹（meta）—— 永不 DROP，跨同步保留。

-- 同步指纹（029 M5 三源一致性）：记录本次 seed 的来源与行数，供 check:sync 比对漂移
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ============================================================
-- 派生读模型：全量重建（子表先于父表 DROP，避免外键约束报错）
-- ============================================================
DROP TABLE IF EXISTS questions;
DROP TABLE IF EXISTS media;
DROP TABLE IF EXISTS species;
-- 物种（核心 1299 全字段 + 全球池 1+1 条目；name_zh 允许为空——全球长尾种可能无中文名）
CREATE TABLE species (
  id                 TEXT PRIMARY KEY,        -- 'turdus-merula'（= slug(学名)）
  name_zh            TEXT,                    -- 中文名（可空：全球长尾种约半数无中文名）
  name_sci           TEXT NOT NULL,           -- Turdus merula
  name_en            TEXT,                    -- Eurasian Blackbird（i18n，015）
  taxon_id           INTEGER,                 -- iNat taxon id（核心库才有）
  taxon_key          TEXT,                    -- AviList AvibaseID（稳定概念键，023）
  family             TEXT,                    -- 科（英文科名）
  commonness         INTEGER NOT NULL DEFAULT 3, -- 1 极常见 → 5 稀有（029 M0；难度分档用）
  rank_world         INTEGER,                 -- 全球榜排名（核心库）
  rank_cn            INTEGER,                 -- 中国榜排名（核心库）
  in_cn              INTEGER,                 -- 是否中国可见 1/0（核心库）
  group_name         TEXT,                    -- 类群 C1：waterbird / raptor / landbird
  migration          TEXT,                    -- 居留型 C1：resident/summer/winter/passage/migrant/vagrant
  iucn_category      TEXT,                    -- IUCN 等级：LC/NT/VU/EN/CR…
  distribution_count INTEGER,                 -- 分布国家/地区数（C1）
  playable_image     INTEGER NOT NULL DEFAULT 0, -- 有图可玩（D-023-3 拆维度）
  playable_audio     INTEGER NOT NULL DEFAULT 0, -- 有音可玩
  quiz_excluded      INTEGER NOT NULL DEFAULT 0, -- 029 M3：质量降级（仅展示不进题库）
  desc               TEXT,
  location           TEXT,
  habit              TEXT,
  -- 首图（题目用；完整素材见前端 assets 分片）——署名字段不可省（AGENTS 铁律 5）
  img_url            TEXT,
  img_thumb_url      TEXT,
  img_xl_url         TEXT,
  img_avif_url       TEXT,
  img_thumbhash      TEXT,
  img_original_url   TEXT,
  img_source_id      TEXT,
  img_license        TEXT,
  img_license_raw    TEXT,
  img_author         TEXT,
  img_source         TEXT,
  img_source_url     TEXT,
  img_transcode      INTEGER,
  -- 首音
  aud_url            TEXT,
  aud_original_url   TEXT,
  aud_source_id      TEXT,
  aud_license        TEXT,
  aud_license_raw    TEXT,
  aud_author         TEXT,
  aud_source         TEXT,
  aud_source_url     TEXT,
  aud_quality        TEXT,
  aud_transcode      INTEGER,
  -- 029 M2/措施二:构建期固定的伪随机值 [0,1)，用于"随机取样"的**索引区间扫描**
  -- （替代 ORDER BY RANDOM()——后者必须扫完整个候选集再排序：
  --   L3 档实测每轮扫 ~10,000 行；改此列后每次只需扫几十行）
  rnd                REAL NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 出题可选：预生成的题目（也可由 Worker 动态生成）
CREATE TABLE IF NOT EXISTS questions (
  id           TEXT PRIMARY KEY,
  species_id   TEXT NOT NULL REFERENCES species(id),
  tier         INTEGER NOT NULL,        -- 1~5
  type         TEXT NOT NULL CHECK (type IN ('image','audio')),
  media_id     TEXT NOT NULL REFERENCES media(id),
  answer       TEXT NOT NULL,
  options      TEXT NOT NULL,           -- JSON 数组
  answer_mode  TEXT NOT NULL DEFAULT 'choice',
  time_limit   INTEGER                   -- 秒；NULL 为不限时
);

-- 索引策略：每个索引都会让"写一行"变成"写两行"（索引维护按行计费），故只为热路径建。
-- 题目查询走 (commonness, rnd)：先按常见度定位区间，再用 rnd 做范围扫描取样，
-- 无需全表排序（措施二）。写成本 +1 索引 ≈ 每次全量重建 +1.1 万行（额度 10 万/天）。
CREATE INDEX IF NOT EXISTS idx_species_commonness ON species(commonness);
CREATE INDEX IF NOT EXISTS idx_species_sample ON species(commonness, rnd);

-- ============================================================
-- 用户数据（永不 DROP；同步只重灌派生读模型）
-- ============================================================

-- B6 报错（G1 上报）：用户对图/音/答案的反馈，供管理方纠正 + 大众评审
CREATE TABLE IF NOT EXISTS reports (
  id               TEXT PRIMARY KEY,     -- 客户端生成（uuid）
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  species_id       TEXT,                 -- 题目物种 id
  species_name     TEXT,                 -- 显示名快照（当轮语言）
  sci              TEXT,
  question_type    TEXT,                 -- image | audio
  media_url        TEXT,
  reason           TEXT NOT NULL,        -- image | audio | answer | quality | other
  suggested_answer TEXT,                 -- 用户认为的正确答案（可选）
  note             TEXT,                 -- 补充说明（可选）
  status           TEXT NOT NULL DEFAULT 'open', -- open | published | fixed | rejected
  up               INTEGER NOT NULL DEFAULT 0,
  down             INTEGER NOT NULL DEFAULT 0,
  client_id        TEXT                  -- 匿名设备 id（去重/防刷，非追踪）
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_species ON reports(species_id);

-- 029 M3:媒体质量隔离（管理方判定"该素材不适合当考题"后的处置台账）。
-- 生命周期：quality 反馈 → 管理方在 /admin「隔离素材」→ 写入本表 → 导出到
-- data/quality-exclusions.json → 下次构建时从题库剔除（有替补则换，无替补则 quizExcluded）；
-- 素材修复/替换后管理方可解除（deleted_at 置空或删行）。
-- 键格式: `<species_id>|<type>|<url>`（type=image|audio），与前端素材一一对应。
CREATE TABLE IF NOT EXISTS media_quarantine (
  media_key   TEXT PRIMARY KEY,          -- '<species_id>|<image|audio>|<url>'
  species_id  TEXT NOT NULL,
  media_type  TEXT NOT NULL CHECK (media_type IN ('image','audio')),
  media_url   TEXT NOT NULL,
  report_id   TEXT,                      -- 触发隔离的报错（可空:管理方直接判定）
  note        TEXT,                      -- 隔离原因/备注
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER                    -- 非空 = 已复原（保留审计）
);
CREATE INDEX IF NOT EXISTS idx_quarantine_active ON media_quarantine(resolved_at, species_id);

-- B6 大众评审投票：每设备每报错一票（+1/-1）
CREATE TABLE IF NOT EXISTS report_votes (
  report_id  TEXT NOT NULL,
  client_id  TEXT NOT NULL,
  value      INTEGER NOT NULL,           -- 1 | -1
  created_at INTEGER NOT NULL,
  PRIMARY KEY (report_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_report_votes_report ON report_votes(report_id);

-- 035 单轮成绩分享（用户主动分享；D-035-1~6 已拍板）
-- 生命周期：结果页点「分享」→ POST /api/shares（写入 payload 快照）→ 海报二维码指向 /s/:id
--          → 任何人可读（GET，默认不缓存：撤回需即时生效）→ 分享者凭管理令牌撤回（hidden=1，公开读 404）。
-- 隐私口径：**首个上传用户数据的功能**，仅"该轮记录"、仅用户主动触发、可撤回（见 docs/035 §2.5）。
-- token 只存哈希（SHA-256），明文仅下发一次给创建者本地保存（跨设备凭令牌仍可撤回）。
CREATE TABLE IF NOT EXISTS round_shares (
  id            TEXT PRIMARY KEY,        -- 不可猜测短 id（base62 12 位）
  created_at    INTEGER NOT NULL,
  mode          TEXT NOT NULL,           -- image | audio
  tier          INTEGER NOT NULL,
  total         INTEGER NOT NULL,
  correct       INTEGER NOT NULL,
  accuracy      INTEGER NOT NULL,
  nickname      TEXT,                    -- 分享者昵称快照（D-035-4：默认带上；可勾选隐藏=null）
  payload       TEXT NOT NULL,           -- JSON：一轮全量 items（见 docs/035 §2.3）
  token_hash    TEXT NOT NULL,           -- 管理令牌 SHA-256（撤回凭据；明文不落库）
  client_id     TEXT,                    -- 仅用于限流与管理，不公开
  hidden        INTEGER NOT NULL DEFAULT 0 -- 1 = 分享者已撤回（公开读 404）
);
CREATE INDEX IF NOT EXISTS idx_shares_created ON round_shares(created_at);
CREATE INDEX IF NOT EXISTS idx_shares_client  ON round_shares(client_id, created_at);
