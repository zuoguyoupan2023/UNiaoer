-- UNiaoer D1 表结构
-- 用法（由 npm run sync:prod 调用）：wrangler d1 execute uniaoer --file=worker/schema.sql --remote
--
-- 分层：
--   · 派生读模型（species / media / questions）—— 由构建产物重建（worker/seed.sql 重灌）。
--     结构变更直接改本文件；DROP+CREATE 保证结构与数据都与构建产物严格一致
--     （INSERT OR REPLACE 不会清除已下架的行，全量重建才是真正的镜像）。
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
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 媒体素材（图片/音频），携带署名与许可，符合 CC 要求
CREATE TABLE media (
  id            TEXT PRIMARY KEY,       -- '<species_id>-<type>-<n>' 如 fulica-atra-image-1
  species_id    TEXT NOT NULL REFERENCES species(id),
  type          TEXT NOT NULL CHECK (type IN ('image','audio')),
  url           TEXT NOT NULL,          -- R2 公开地址（full / mp3）
  thumb_url     TEXT,                   -- 图片缩略图（320px）
  xl_url        TEXT,                   -- 图片母版原分辨率
  avif_url      TEXT,                   -- 图片 AVIF 版 full
  original_url  TEXT,                   -- 源站直链
  source_id     TEXT,                   -- 源站稳定 id（iNat photo id / XC recording id）
  license       TEXT NOT NULL,          -- 规范化：CC0 / CC-BY / CC-BY-SA / ...
  license_raw   TEXT,                   -- 原始值（可能是 URL）
  author        TEXT NOT NULL,          -- 作者/录音者（必须展示）
  source        TEXT NOT NULL,          -- iNaturalist / Xeno-canto
  source_url    TEXT,                   -- 原始页面
  quality       TEXT,                   -- A~E（音频）
  transcode     INTEGER NOT NULL DEFAULT 1, -- 0=ND 不允许转码
  quiz_excluded INTEGER NOT NULL DEFAULT 0, -- 029 M3：单条素材隔离（仅展示不进题库）
  retrieved_at  INTEGER NOT NULL DEFAULT (unixepoch())
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

CREATE INDEX IF NOT EXISTS idx_media_species ON media(species_id);
CREATE INDEX IF NOT EXISTS idx_media_type ON media(type);
CREATE INDEX IF NOT EXISTS idx_media_excluded ON media(quiz_excluded);
CREATE INDEX IF NOT EXISTS idx_species_commonness ON species(commonness);
CREATE INDEX IF NOT EXISTS idx_species_family ON species(family);
CREATE INDEX IF NOT EXISTS idx_species_group ON species(group_name);
CREATE INDEX IF NOT EXISTS idx_species_playable ON species(quiz_excluded, playable_image, playable_audio);

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

-- B6 大众评审投票：每设备每报错一票（+1/-1）
CREATE TABLE IF NOT EXISTS report_votes (
  report_id  TEXT NOT NULL,
  client_id  TEXT NOT NULL,
  value      INTEGER NOT NULL,           -- 1 | -1
  created_at INTEGER NOT NULL,
  PRIMARY KEY (report_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_report_votes_report ON report_votes(report_id);
