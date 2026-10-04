# Data model (`~/.nailstar/nailstar.db`, bun:sqlite)

Large artifacts live on disk in the run directory. SQLite holds the index, state, caches and memory. WAL mode is on.

```sql
-- channels & memory -------------------------------------------------------
CREATE TABLE channels (
  id TEXT PRIMARY KEY,                 -- slug, e.g. "space-facts"
  name TEXT NOT NULL,
  youtube_channel_id TEXT,             -- UC… (optional)
  niche TEXT,
  rubric_weights JSON,                 -- null → defaults
  oauth_connected INTEGER DEFAULT 0,
  created_at INTEGER, updated_at INTEGER
);
CREATE TABLE taste_memos (
  channel_id TEXT REFERENCES channels(id),
  version INTEGER, memo TEXT, changes JSON, created_at INTEGER,
  PRIMARY KEY (channel_id, version)
);

-- runs --------------------------------------------------------------------
CREATE TABLE runs (
  id TEXT PRIMARY KEY,                 -- ns_<ulid>
  channel_id TEXT REFERENCES channels(id),
  state TEXT NOT NULL,                 -- see architecture.md
  generation INTEGER DEFAULT 0,
  options JSON NOT NULL,               -- review mode, τ, max gens, etc.
  video_path TEXT, video_sha256 TEXT, script_sha256 TEXT, initial_title TEXT,
  worker_pid INTEGER, error JSON,
  started_at INTEGER, updated_at INTEGER, finished_at INTEGER
);
CREATE TABLE candidates (
  id TEXT PRIMARY KEY,                 -- <runId>:g3c1
  run_id TEXT REFERENCES runs(id),
  generation INTEGER, slot INTEGER,
  parents JSON, operator TEXT, strategy TEXT,
  genome JSON, title TEXT,
  lint JSON, judge_scores JSON, judge_total REAL, fitness REAL,
  status TEXT,                         -- alive | elite | dead | killed | delivered
  phash TEXT, created_at INTEGER
);
CREATE TABLE ratings (
  candidate_id TEXT REFERENCES candidates(id),
  source TEXT,                         -- human | agent
  stars INTEGER, action TEXT,          -- kill | boost | more_like_this | null
  note TEXT, created_at INTEGER
);
CREATE TABLE llm_calls (
  id INTEGER PRIMARY KEY, run_id TEXT, role TEXT, prompt_version TEXT,
  ms INTEGER, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
  cost_usd REAL, ok INTEGER, error TEXT, created_at INTEGER
);

-- publishing & CTR ---------------------------------------------------------
CREATE TABLE publications (
  candidate_id TEXT REFERENCES candidates(id),
  youtube_video_id TEXT, linked_at INTEGER,
  PRIMARY KEY (candidate_id, youtube_video_id)
);
CREATE TABLE ctr_snapshots (
  youtube_video_id TEXT, window_days INTEGER,       -- 7 | 28
  impressions INTEGER, ctr REAL, views INTEGER, relative_ctr REAL,
  fetched_at INTEGER,
  PRIMARY KEY (youtube_video_id, window_days)
);

-- YouTube cache -----------------------------------------------------------
CREATE TABLE yt_cache (                -- raw API responses
  key TEXT PRIMARY KEY,                -- endpoint + normalized params
  body JSON, etag TEXT, fetched_at INTEGER, ttl_s INTEGER
);
CREATE TABLE yt_videos (
  id TEXT PRIMARY KEY, channel_id TEXT, title TEXT, published_at INTEGER,
  duration_s INTEGER, views INTEGER, likes INTEGER, comments INTEGER,
  category_id TEXT, thumb_path TEXT, stats_fetched_at INTEGER
);
CREATE TABLE yt_channels (
  id TEXT PRIMARY KEY, title TEXT, subscribers INTEGER, uploads_playlist TEXT,
  baseline_median REAL, baseline_n INTEGER, baseline_fetched_at INTEGER
);
CREATE TABLE thumb_tags (              -- tag cache, reused across runs
  video_id TEXT, prompt_version TEXT, tags JSON, features JSON,
  PRIMARY KEY (video_id, prompt_version)
);
CREATE TABLE quota_ledger (
  day_pt TEXT, endpoint TEXT, units INTEGER, run_id TEXT, created_at INTEGER
);
```

## TTLs

| Data | TTL |
|---|---|
| `search.list` responses | 24 h |
| video statistics | 24 h (refreshed lazily) |
| channel baselines | 7 d |
| thumbnails, tags | forever (tags keyed by prompt version) |
| `VideoBrief` | keyed by `sha256(video) + sha256(script) + promptVersion` |
