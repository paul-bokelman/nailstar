# YouTube data

## APIs used

| Purpose | Endpoint | Cost (units) |
|---|---|---|
| Find similar / adjacent videos | `search.list` (`type=video`, `order=viewCount` and `relevance`, `publishedAfter`, `relevanceLanguage`) | **100** per call |
| Video stats + duration + thumbnails | `videos.list` (`part=snippet,statistics,contentDetails`, ≤50 ids) | 1 |
| Global top performers | `videos.list` (`chart=mostPopular`, `videoCategoryId`, `regionCode`) | 1 |
| Channel stats + uploads playlist | `channels.list` (`part=statistics,contentDetails`, ≤50 ids) | 1 |
| Channel baseline uploads | `playlistItems.list` (uploads playlist, 50 items) | 1 |
| Own CTR (OAuth) | YouTube Analytics `reports.query` | separate quota |

Thumbnails are downloaded from `https://i.ytimg.com/vi/<id>/maxresdefault.jpg`, falling back to `hqdefault.jpg`. This costs no quota.

## Quota budget (cold run)

```
search.list   3 similar queries × 2 windows (12mo, 30d)  =  6 × 100 = 600
              1 adjacent-niche query                     =  1 × 100 = 100
videos.list   ~350 candidate ids / 50                              ≈   7
channels.list ~150 channels / 50                                   ≈   3
baselines     ~40 uncached channels × (playlistItems + videos)     ≈  80
mostPopular                                                        =   1
                                                           total   ≈ 790
```

The default cap is **7 searches per run** (configurable). The brief may propose more queries; they're ranked and truncated. Warm runs in the same niche reuse cached search results (24h TTL) and baselines (7d), so they cost about 50–150 units.

The ledger (`quota_ledger` table) is keyed by Pacific-time day, because the quota resets at midnight PT. `nailstar doctor` shows today's usage.

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
- Constants (`28`, `0.6`, `0.1`) live in config and are tuned in P0.3.

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

## CTR feedback (Phase 9)

- OAuth 2.0 **loopback** flow (desktop app client). The user supplies their own Google Cloud OAuth client ID/secret through `nailstar config set google.clientId …`. Tokens are stored in the OS keychain where available, otherwise `~/.nailstar/secrets.json` (0600).
- Scopes: `youtube.readonly`, `yt-analytics.readonly`.
- Metrics (verify names in P9): `videoThumbnailImpressions`, `videoThumbnailImpressionsClickRate`, `views`, filtered per video over the first 7 and 28 days.
- **Relative CTR** = video CTR ÷ the median CTR of the channel's last 30 uploads. This is the calibration target.
