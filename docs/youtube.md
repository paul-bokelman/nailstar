# YouTube data

## APIs used

| Purpose | Endpoint | Quota |
|---|---|---|
| Find similar / adjacent videos | `search.list` (`type=video`, `order=viewCount`, `publishedAfter`, `relevanceLanguage`, `regionCode`, `maxResults=50`) | **1 call from the `search` bucket** (100 calls/day) |
| Video stats + duration + thumbnails | `videos.list` (`part=snippet,statistics,contentDetails`, ≤50 ids) | 1 unit |
| Global top performers | `videos.list` (`chart=mostPopular`, `videoCategoryId`, `regionCode`) | 1 unit |
| Channel stats + uploads playlist | `channels.list` (`part=statistics,contentDetails`, ≤50 ids) | 1 unit |
| Channel baseline uploads | `playlistItems.list` (uploads playlist, 50 items) | 1 unit |
| Own thumbnail impressions + CTR (OAuth) | **YouTube Reporting API** reach reports (bulk CSV) | separate (no Data API quota) |

### Quota model (changed in 2026; verified against Google's quota page, 2026-10-03)

> "Projects that enable the YouTube Data API have a default quota allocation of 100 `search.list` calls, 100 `videos.insert` calls, and 10,000 units per day combined for all other endpoints … The `search.list` and `videos.insert` methods have their own quota buckets. Each of these methods has a default daily limit of 100 per day. The quota cost is 1 per call."

So nailstar has **two budgets**, both resetting at midnight Pacific:
- **`search` bucket: 100 calls/day.** This is the binding constraint.
- **`units` bucket: 10,000/day** for everything else. A run barely touches it.

Every request costs at least 1, including invalid ones, and each extra page of results is another call.

## Thumbnails (verified)

Downloaded from `i.ytimg.com`. This costs no quota. Results from 137 long-form uploads across 10 channels of varied size (`spikes/youtube/thumbs-nokey.ts`):

| Variant | Size | Available |
|---|---|---|
| `maxresdefault.jpg` | 1280×720 | **132/137 (96 %)** |
| `hq720.jpg` | 1280×720 | the same 132 (never available when maxres isn't) |
| `sddefault.jpg` | 640×480, 4:3 **letterboxed** | 135/137 |
| `hqdefault.jpg` | 480×360, 4:3 **letterboxed** | 137/137 |

Fallback chain: `maxresdefault` → `sddefault` → `hqdefault`, **centre-cropping the 4:3 fallbacks to 16:9** (remove the black bars: 640×360 from sd, 480×270 from hq) and flagging `lowRes` so analysis doesn't over-read blur. `videos.list` `snippet.thumbnails.maxres` presence predicts availability, so no HEAD probe is needed. `spikes/youtube/spike.ts` measures how often the API and CDN agree. The sample is biased toward established channels, so expect more misses from small channels that upload in SD. A missing maxres returns HTTP 404.

(The public RSS feed `feeds/videos.xml?channel_id=` returned 404 for 9 of 10 channels during the spike. Nothing in nailstar should depend on it.)

## Quota budget (cold run)

```
search bucket  3 similar queries × 2 windows (12mo, 30d) + 1 adjacent   =  7 calls
units bucket   videos.list    ~300 candidate ids / 50                    ≈   6
               channels.list  ~150 channels / 50                         ≈   3
               baselines      every channel × (playlistItems + videos)   ≈ 300   (cap 400)
               mostPopular                                               =   1
                                                                  units  ≈ 310
```

- **≈ 14 cold runs/day** on the default quota (100 ÷ 7 searches). The units bucket supports ~30 cold runs, so it's never the limit.
- Because units are now plentiful, nailstar computes a **baseline for every channel** in the candidate set, not just ~40. This cuts low-confidence outlier scores (subscriber fallback) to channels with < 5 eligible uploads.
- **Warm runs** in the same niche reuse cached search results (24h TTL) and baselines (7d). They use **0 search calls** and ~10–50 units.
- `--max-searches` (default 7) caps search calls per run. The brief may propose more queries; they're ranked and truncated.
- The ledger (`quota_ledger`) is keyed by Pacific day and records `bucket` (`search` | `units`). `nailstar doctor` shows both: "searches 21/100 · units 940/10000".
- **Exhaustion**: a `403` with reason `quotaExceeded` on `search.list` means the search bucket is spent. Degrade to cached searches and keep using the units bucket for stats/baselines. Exit 4 only if there are zero references.

> ⏳ **Pending a real API key** (`bun spikes/youtube/spike.ts` with `YOUTUBE_API_KEY` in `.env`): confirm actual per-niche usage of both buckets, distinct channels per niche, and the error body of a quota failure. The budget above is computed from the documented costs and the planned call pattern.

## Outlier score

For video *v* on channel *c*:

```
baseline(c)   = median(views) over c's uploads aged 7–365 days (last ≤ 30 uploads, long-form only)
ageFactor(v)  = min(1, (ageDays(v) / 28) ^ 0.6)        # young videos haven't accumulated views yet
outlier(v)    = views(v) / (baseline(c) × ageFactor(v))
```

- Videos under 3 days old are excluded (too noisy). Channels with fewer than 5 baseline videos use a **fallback**: `views / (subscribers × 0.1)`, flagged `lowConfidence`.
- `log2(outlier)` is shown in the UI: 0 = typical, +1 = 2× typical, +3 = 8×.
- Shorts are excluded everywhere (`duration ≤ 180s`, or the `#shorts` hint in the title).
- Constants (`28`, `0.6`, `0.1`) live in config.
- ⚠️ **View-count definition changed on 2026-08-27**: public views for long-form now count from the first frame (including autoplay); previously a view needed real playback. If YouTube didn't restate older counts, videos published after the change will look like outliers against baselines built mostly from older uploads. Mitigation if confirmed: build the baseline only from uploads on the same side of 2026-08-27 when ≥ 5 exist, otherwise apply a correction factor measured per niche. `spike.ts` reports outlier medians before and after the date (`viewCountChange`).

> ⏳ **Pending a real API key**: outlier distribution per niche (p10–p99, counts over 2×/5×/10×), low-confidence share, how many 30-day-window videos survive filtering, the before/after-2026-08-27 comparison, and tuning of the constants. `spike.ts` prints all of these.

## Pools

| Pool | Size | Source | Selection |
|---|---|---|---|
| similar | 12 | similar queries, both windows | top outlier, ≤2 per channel, ≥3 from the 30-day window if available |
| adjacent | 2 | adjacent-niche queries | top outlier |
| global | 2 | `mostPopular` in the brief's category (+ region) | most views/day |
| contrarian | 2 | similar-pool *candidates* (top 40 by outlier) | after tagging, the highest-outlier items whose tag vector is farthest from the similar-pool centroid |
| random | 2 | all search results | uniform random, seeded by run ID (reproducible) |
| own | ≤6 | channel's own uploads (if a channel with a YouTube ID is selected) | highest outlier from own catalogue |

The contrarian pick needs tags, so the analyze stage tags the top 40 cheaply (contact sheets of 20) before selecting. This doubles as broader trend evidence.

## CTR feedback (Phase 9) — verified against Google's docs, 2026-10-03

Thumbnail impressions and CTR are **not** in the YouTube Analytics API (targeted queries). The metric list there has no thumbnail metric, and the names in the old plan (`videoThumbnailImpressions`, `videoThumbnailImpressionsClickRate`) don't exist. They are in the **YouTube Reporting API** (bulk reports), added 2026-01-15:

| Report type | Dimensions | Metrics |
|---|---|---|
| `channel_reach_basic_a1` | `date`, `channel_id`, `video_id` | `video_thumbnail_impressions`, `video_thumbnail_impressions_ctr` |
| `channel_reach_combined_a1` | + `traffic_source_type`, `traffic_source_detail`, `operating_system`, `device_type` | same |

How it works, and what nailstar must do:
- OAuth 2.0 **loopback** flow (desktop app client). The user supplies their own Google Cloud OAuth client ID/secret through `nailstar config set google.clientId …`. Tokens go in the OS keychain where available, otherwise `~/.nailstar/secrets.json` (0600).
- Scopes: `yt-analytics.readonly` (Reporting API) + `youtube.readonly` (resolve the channel and its uploads).
- Reporting is **job-based**: `nailstar channel connect` must immediately call `jobs.create` for `channel_reach_basic_a1`. The first report is ready about 48 h later, then one CSV per day (Pacific day).
- **Reports expire**: daily reports after 60 days, historical backfill reports for a new job after 30 days. `channel sync` downloads every report not yet seen (`reports.list` with `createdAfter`, dedupe by report ID) into SQLite, and `nailstar doctor` warns when a connected channel hasn't synced in > 21 days. YouTube may also publish **backfill** reports that replace earlier days; replace those rows.
- Views per video still come from the Data API (`videos.list`), or the Analytics API `views` metric if needed.
- Per linked video, sum the daily rows for the first 7 and 28 days after publish: `impressions = Σ video_thumbnail_impressions`, `ctr = Σ(impressions × ctr) / Σ impressions`.
- **Relative CTR** = video CTR ÷ the median CTR of the channel's last 30 uploads (from the same reports). This is the calibration target.
- How far back a new job's historical backfill reaches isn't documented on the pages checked. Verify on the first real connect (Phase 9).

## Phase 0 status

- [x] Quota model: corrected (separate search bucket); the budget is rewritten above.
- [x] Thumbnail availability: maxres 96 % of long-form; fallback crop rule defined.
- [x] CTR metric names: Reporting API `channel_reach_basic_a1` → `video_thumbnail_impressions`, `video_thumbnail_impressions_ctr`.
- [ ] **Pending API key**: real quota usage per niche, outlier distributions and constants, the view-count-change check, API vs CDN maxres agreement. Run `bun spikes/youtube/spike.ts` (writes `spikes/youtube/out/<niche>.json`).
