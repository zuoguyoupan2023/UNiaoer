-- UNiaoer D1 表结构（元数据 / 署名 / 难度）
-- 用法：wrangler d1 execute uniaoer --file=worker/schema.sql --remote

CREATE TABLE IF NOT EXISTS species (
  id                 TEXT PRIMARY KEY,        -- 'turdus-merula'
  name_zh            TEXT NOT NULL,           -- 乌鸫
  name_sci           TEXT NOT NULL,           -- Turdus merula
  name_en            TEXT,                    -- Eurasian Blackbird（i18n，015）
  taxon_id           INTEGER,                 -- iNat taxon id（稳定主键）
  family             TEXT,                    -- 鸫科
  commonness         INTEGER NOT NULL DEFAULT 2, -- 1 常见 → 4 少见（用于难度）
  rank_world         INTEGER,                 -- 全球榜排名
  rank_cn            INTEGER,                 -- 中国榜排名
  in_cn              INTEGER,                 -- 是否中国可见 1/0
  group_name         TEXT,                    -- 类群 C1：waterbird / raptor / landbird
  migration          TEXT,                    -- 居留型 C1：resident/summer/winter/passage/migrant/vagrant
  iucn_category      TEXT,                    -- IUCN 等级：LC/NT/VU/EN/CR…
  distribution_count INTEGER,                 -- 分布国家/地区数（C1）
  desc               TEXT,
  location           TEXT,
  habit              TEXT,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 媒体素材（图片/音频），携带署名与许可，符合 CC 要求
CREATE TABLE IF NOT EXISTS media (
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
  retrieved_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_media_species ON media(species_id);
CREATE INDEX IF NOT EXISTS idx_media_type ON media(type);
CREATE INDEX IF NOT EXISTS idx_species_commonness ON species(commonness);
CREATE INDEX IF NOT EXISTS idx_species_family ON species(family);
CREATE INDEX IF NOT EXISTS idx_species_group ON species(group_name);

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
  reason           TEXT NOT NULL,        -- image | audio | answer | other
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
