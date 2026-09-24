-- UNiaoer D1 表结构（元数据 / 署名 / 难度）
-- 用法：wrangler d1 execute uniaoer --file=worker/schema.sql --remote

CREATE TABLE IF NOT EXISTS species (
  id           TEXT PRIMARY KEY,        -- 'turdus-merula'
  name_zh      TEXT NOT NULL,           -- 乌鸫
  name_sci     TEXT NOT NULL,           -- Turdus merula
  family       TEXT,                    -- 鸫科
  commonness   INTEGER NOT NULL DEFAULT 2, -- 1 常见 → 4 少见（用于难度）
  desc         TEXT,
  location     TEXT,
  habit        TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 媒体素材（图片/音频），携带署名与许可，符合 CC 要求
CREATE TABLE IF NOT EXISTS media (
  id            TEXT PRIMARY KEY,       -- '<species_id>-<type>'
  species_id    TEXT NOT NULL REFERENCES species(id),
  type          TEXT NOT NULL CHECK (type IN ('image','audio')),
  url           TEXT NOT NULL,          -- R2 或源站地址
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

-- 出题可选：预生成的题目（也可由 Worker 动态生成）
CREATE TABLE IF NOT EXISTS questions (
  id           TEXT PRIMARY KEY,
  species_id   TEXT NOT NULL REFERENCES species(id),
  tier         INTEGER NOT NULL,        -- 1~4
  type         TEXT NOT NULL CHECK (type IN ('image','audio')),
  media_id     TEXT NOT NULL REFERENCES media(id),
  answer       TEXT NOT NULL,
  options      TEXT NOT NULL,           -- JSON 数组
  answer_mode  TEXT NOT NULL DEFAULT 'choice',
  time_limit   INTEGER                   -- 秒；NULL 为不限时
);
