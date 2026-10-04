# nailstar — Implementation Plan

> Video + script in → trend research → reference analysis → evolved, code-drawn YouTube thumbnails (and titles) out.

This is the master plan. Deep-dive specs live in `docs/`:

| Doc | What's in it |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Modules, run state machine, run directory layout, concurrency |
| [`docs/provider.md`](docs/provider.md) | The `claude -p` provider: flags, images, schemas, pooling, risks |
| [`docs/youtube.md`](docs/youtube.md) | Data API usage, quota budget, outlier score, reference pools, CTR feedback |
| [`docs/genome.md`](docs/genome.md) | Genome schema, mutation/crossover operators, selection, termination |
| [`docs/prompts.md`](docs/prompts.md) | Every Claude role: inputs, outputs, prompt structure, the render contract |
| [`docs/data-model.md`](docs/data-model.md) | SQLite schema, caching, memory/learning tables |
| [`docs/cli.md`](docs/cli.md) | Full CLI contract (commands, flags, `--json` shapes, exit codes) |

---

## 1. Decisions (from scoping Q&A)

| Topic | Decision |
|---|---|
| Input | Local **video file** + **script** + **initial title**. Optional `--channel`. |
| Platform / data | **YouTube only**, via **YouTube Data API v3** (official). Aggressive caching to live within the 10k units/day quota. |
| "High performing" | **Outlier score**: views ÷ channel's median views, age-adjusted. |
| Wildcards | All four: **adjacent niches**, **global top performers**, **contrarian styles**, **random sample**. |
| Imagery | **Code-drawn only**: shapes, gradients, typography, SVG illustration, plus local **icon/emoji** sets. No video frames or creator assets in the output. Videos have no humans; they contain animated characters or stock footage. |
| Rendering | Claude writes **self-contained HTML/CSS/SVG/JS**, and **Playwright (Chromium)** screenshots it at 1280×720. |
| Model | **Opus for every role.** It's kept fast with parallelism, small populations and merged calls. |
| Claude access | **Shell out to `claude -p`** (headless Claude Code on the user's subscription). It sits behind a `Provider` interface so an API-key provider can be added later. ⚠️ See risk R1. |
| Title | The user provides an initial title. **Titles co-evolve** with thumbnails as part of the genome. |
| Fitness | **Claude vision judge** (rubric + comparative + anchored) **+ human-in-the-loop**. Deterministic checks are **constraint lints only** (legibility, safe zone, overflow), never fitness. |
| Evolution | **Fixed population of 3, elitist.** Initial population of 3 *divergent* concepts. |
| Validation | A **human review checkpoint every 2 generations, plus one on finish.** Actions: rate 1–5, kill, boost, "more like this", free-text notes. |
| Review modes | `--review=human` (default), `--review=agent` (the calling agent reviews), `--review=none` (judge only). |
| Termination | Best candidate **score ≥ threshold** (and approved, if review is on) **or** a max-generation / time cap. Returns the **top 3 thumbnail+title pairs** for YouTube Test & Compare. |
| Channels | A generic tool, with named **channels** that persist memory: taste memo from human picks, run history, and **real CTR** via the YouTube Analytics API (OAuth). |
| Form factor | **CLI first**, agent-friendly (`--json`, NDJSON events, resumable runs, stable exit codes, Claude Code plugin/skill), plus a **simple local web UI** for **viewing and review only**. Runs start from the CLI or an agent. |
| Stack | **TypeScript on Bun.** `bun:sqlite`, `Bun.serve`, Playwright, `ffmpeg`/`ffprobe` subprocesses, `sharp` for image ops. |
| Scope | Local only. Single user per machine. Niche-agnostic. |

---

## 2. The pipeline at a glance

```
 video.mp4 + script.md + "Initial Title"            (+ --channel memory)
        │
        ▼
 ┌──────────────┐  ffprobe, scene-detect keyframes, contact sheets, palette
 │ 1. INGEST    │──► Opus(vision): VideoBrief  {topic, hook, promise, emotions,
 └──────────────┘    visual style, characters-as-descriptions, keywords, queries}
        │
        ▼
 ┌──────────────┐  YouTube Data API: search → videos → channel baselines
 │ 2. RESEARCH  │──► outlier scores → pools: similar(12) + wildcards(8)
 └──────────────┘    thumbnails downloaded + cached
        │
        ▼
 ┌──────────────┐  deterministic features (palette, contrast, clutter)
 │ 3. ANALYZE   │──► Opus(vision, contact sheets): per-thumb tags
 └──────────────┘──► Opus: TrendReport {winning patterns, saturated patterns,
        │             rising patterns, wildcard steals, title patterns}
        ▼
 ┌──────────────┐  Opus: DesignBrief + 3 divergent genomes
 │ 4. DIRECT    │    (proven-pattern / wildcard-steal / contrarian), each w/ title
 └──────────────┘
        │
        ▼
 ┌─────────────────────────── 5. EVOLVE (loop) ───────────────────────────┐
 │  BUILD ×3 (parallel)  Opus writes HTML from genome (+ parent HTML)     │
 │     → Playwright render → lint (overflow, legibility, safe-zone)       │
 │     → 1 auto-repair pass if lint fails                                 │
 │  EVALUATE (1 call)    Opus judges all 3 at full + mobile size + in a   │
 │                       mock feed beside real competitors, with anchors  │
 │                       → scores, critiques, AND next-gen mutation plan  │
 │  SELECT               elitist: keep best (1–2), fill to 3 via plan     │
 │  CHECKPOINT           every 2 gens: pause for human/agent review       │
 │  STOP?                score ≥ τ (+approved) | max gens | time cap      │
 └────────────────────────────────────────────────────────────────────────┘
        │
        ▼
 ┌──────────────┐  top-3 PNG (≤2MB, 1280×720) + title + HTML + genome +
 │ 6. DELIVER   │  lineage report; update channel taste memo
 └──────────────┘
        │  (later)  nailstar link <run> <cand> --video <id>
        ▼
 ┌──────────────┐  YouTube Analytics: impressions CTR → calibrate judge
 │ 7. LEARN     │  rubric weights + "what worked" notes per channel
 └──────────────┘
```

**Opus call budget per run** (defaults: 6 gens max). Ingest 1, analyze 2–3 (tag batches + synthesis), direct 1, then per generation 3 builds (+≤3 repairs) and 1 evaluate. That's about **30–40 calls**. **Wall-clock target: ≤ 15 min** for a full run excluding human think time. Concurrency is 3 (builds in parallel).

---

## 3. Stage details

### 3.1 Ingest → `VideoBrief`
1. `ffprobe`: duration, resolution, fps.
2. Keyframes. Use `ffmpeg` scene detection (`select='gt(scene,0.35)'`) and fill with uniform samples, up to 24 frames, deduped with perceptual hashing (dHash via `sharp`).
3. **Contact sheets.** Tile frames into labelled 3×3 grids at 1536px wide. A handful of images in place of 24 cuts vision tokens and latency by about 4×.
4. Deterministic palette. K-means (k=6) over downsampled frames gives the video's real colours.
5. **Opus (vision)** gets the contact sheets, script, initial title, palette and channel memo, and returns a `VideoBrief` (schema-validated):
   - `topic`, `subtopics[]`, `hook`, `promise` (what the viewer gets), `emotionalArc[]`, `peakMoments[]`
   - `visualStyle` (animation style, line weight, palette mood). This keeps code-drawn thumbnails *on-brand with the video* even though frames aren't used.
   - `subjects[]` are **descriptions** of characters and objects precise enough to redraw in SVG (shape language, colours, signature features).
   - `audience`, `keywords[]`, `searchQueries.similar[]` (4–6), `searchQueries.adjacent[]` (2–3 neighbouring niches), `ytCategoryId`.

### 3.2 Research → reference pools
See [`docs/youtube.md`](docs/youtube.md) for the math and quota budget. Summary:
- `search.list` for each similar query, in two windows: **last 12 months** (proven) and **last 30 days** (trending). Long-form only: shorts are filtered out by `contentDetails.duration > 3 min`.
- Batch `videos.list` / `channels.list`. Channel baselines (median views of the last ~30 uploads, 7–365 days old) are cached for 7 days.
- **Outlier score** = `views / channelMedian`, with an age correction for young videos.
- Pools:
  - **Similar (12)**: the highest outlier scores from similar queries, at most 2 per channel.
  - **Wildcards (8)**: 2 *adjacent-niche* outliers, 2 *global top performers* (`videos.list chart=mostPopular` in the brief's category, 1 unit), 2 *contrarian* (picked after analysis: high outlier whose style tags are far from the pool's dominant cluster), 2 *random* (uniform from all results regardless of score).
- Thumbnails are fetched from `i.ytimg.com` (no quota) and cached on disk forever, keyed by video ID.
- **Quota target: ≤ 800 units per cold run, about 150 warm** (≈12 cold runs/day on the default quota). A quota ledger is kept in SQLite. On exhaustion: degrade to cache plus whatever is available, warn, and continue (exit code 4 only if there are zero references).

### 3.3 Analyze → `TrendReport`
1. Deterministic features per thumbnail: palette, mean luminance, contrast (RMS), saturation, edge density (a clutter proxy), and dominant hue family.
2. **Opus (vision)** reads labelled contact sheets of 12 thumbnails each (2 sheets) and returns per-thumbnail **tags**: layout archetype, focal subject type, text (OCR'd words and word count), type style, colour scheme, curiosity device (arrow, circle, blur, before/after, question, number), emotion, background treatment, and title–thumbnail relation (repeat / complement / tease).
3. **Opus synthesis** (text-only, using tags + stats + titles + outlier scores) returns a `TrendReport`:
   - `winningPatterns[]`: traits over-represented in high outliers, with evidence (video IDs).
   - `saturatedPatterns[]`: what *everyone* in the niche does, so we can stand out.
   - `risingPatterns[]`: traits over-represented in the 30-day window compared with 12 months.
   - `wildcardSteals[]`: transferable ideas from the wildcards.
   - `titlePatterns[]`: structures, lengths and power words of high-outlier titles.
   - `differentiationOpportunities[]`.
   - `anchors`: 2 reference thumbnails (one high outlier, one median) reused in judging for calibration.

### 3.4 Direct → initial population
**Opus** gets the brief, trend report, channel taste memo and render contract summary. It returns a `DesignBrief` (the north star: the one thing a viewer must feel or understand in 0.3s) and **3 deliberately divergent genomes**:
- **G0-A "proven"** is built from winning patterns.
- **G0-B "steal"** is built around a wildcard steal.
- **G0-C "contrarian"** breaks a saturated pattern on purpose.

Each genome includes a **title variant**, and at least one keeps the user's initial title verbatim. Schema in [`docs/genome.md`](docs/genome.md).

### 3.5 Build (genome → HTML → PNG)
- The **Builder** (Opus) gets the render contract + DesignBrief + genome + (for mutations) parent HTML + mutation instruction. It returns **one self-contained HTML document** (inline CSS/SVG/JS; local assets only).
- **Render kit** (shipped in `assets/`, served by a local static route; the network is blocked during render):
  - ~25 bundled **OFL display fonts** (Anton, Bebas Neue, Archivo Black, Bangers, Luckiest Guy, Titan One, Rubik, Poppins Black, Oswald, Permanent Marker, Barlow Condensed, …) declared in `kit.css`.
  - **Icons/emoji**: Lucide, Phosphor and Twemoji SVGs, referenced by name (`/kit/icons/lucide/flame.svg`).
  - **`kit.css` effects**: text stroke and 3D extrude, glow, hard shadow, grain, vignette, halftone, speed lines, burst and scribble shapes.
  - **`kit.js` SVG primitives** for code-drawn subjects: an *expressive face kit* (eyes, brows, mouths × emotions), arrows, circles, burst stickers, and a simple character builder from geometric parts. This is the main quality lever for code-drawn characters (see R2).
- **Renderer**: one persistent Chromium instance, a fresh context per candidate, `page.setContent`, then wait for `document.fonts.ready` and a `window.__NAILSTAR_READY__` flag (2s timeout). Screenshot `#thumb` at 1280×720. It also produces **mobile (168×94)** and **desktop-feed (360×202)** downscales.
- **Lint** (deterministic, through DOM introspection plus pixels):
  - Every text node's bounding box is inside the canvas, and none clip.
  - The smallest headline glyph height is ≥ 7% of canvas height, so it's legible at 168px.
  - Nothing important sits in the **bottom-right timestamp zone** (≈ 180×60).
  - Word count is ≤ the genome's max.
  - There are no console errors and no external requests.
  - PNG ≤ 2MB, or re-encode as high-quality JPEG.
- If lint fails, there's **one repair pass** in which the Builder gets its HTML and the lint report. If it still fails, the candidate is kept but carries a fitness penalty.

### 3.6 Evaluate (judge + planner, one call per generation)
**Opus (vision)** receives:
- The 3 candidates at full size and at mobile size.
- A **mock feed** for each candidate: it's rendered in a YouTube-style grid (light and dark) among 7 real competitor thumbnails + titles from the similar pool.
- The **2 anchors** with their known outlier percentiles, to stabilise scores across generations.
- The DesignBrief, the trend report summary, prior critiques and **human notes** (which must be honoured).

It returns:
- **Rubric scores, 0–10 each**, with a weighted total. The dimensions are: glanceability (mobile), focal clarity, curiosity gap, title synergy, emotional pull, feed standout, niche fit and craft. Weights are per channel and recalibrated by CTR feedback.
- A **critique** per candidate: the top 3 fixes, ranked.
- A **next-generation plan**: for each of the 2–3 slots to fill, the operator, parent(s) and a precise instruction (see [`docs/genome.md`](docs/genome.md)).

Merging judge and planner saves one Opus call per generation. The judge never built the candidates, so self-preference bias is limited. Rationale is required *before* scores in the schema, which reduces snap judgments.

### 3.7 Selection, checkpoints, termination
- **Fitness** = judge total, minus lint penalty, plus a human blend (if rated: `0.5·judge + 0.5·(stars·2)`). **Kill** removes a candidate. **Boost** forces it into the elite.
- **Elitism**: keep the top 1, or the top 2 when #2 is within 0.5 points of #1 and genome-distant. Fill to 3 using the plan.
- **Diversity guard**: if two candidates have a genome distance below the threshold *or* a pHash distance under 8, the lower one is replaced by a macro-mutation.
- **Checkpoint**: after gen 2, 4, 6… and at finish. Status becomes `awaiting_review` (exit code 3 for non-detached CLI runs). `--review=agent` lets the calling agent rate through `nailstar review` / `nailstar rate`; `--review=none` skips checkpoints.
- **Stop when**:
  - the best score is ≥ `τ` (default **8.5**) and was approved at the last checkpoint (or review is `none`), **or**
  - `--max-gens` is reached (default **6**), **or**
  - `--time-cap` is reached (default **20 min** of compute), **or**
  - a plateau is detected (best Δ < 0.2 for 2 gens, after gen 4).
- **Deliver** the top 3 distinct candidates, each with its title.

### 3.8 Learn (channels)
- **Taste memo**: after each review and at the end of each run, one Opus call folds new ratings and notes into a compact (≤ 400 words) per-channel memo ("loves bold yellow 3D type; hates arrows; prefers 2-word text"). It's versioned. It's injected into Direct, Build and Evaluate.
- **CTR loop**:
  1. `nailstar channel connect` uses Google OAuth (loopback) with `youtube.readonly` + `yt-analytics.readonly`.
  2. `nailstar link` maps a delivered candidate to a published video ID.
  3. `nailstar channel sync` pulls impressions + impressions CTR per linked video (and for the whole channel catalogue as a baseline).
  4. Calibration: after ≥ 10 linked videos, fit non-negative least squares from rubric dimensions to *CTR relative to channel median*. The result becomes the channel's rubric weights (shrunk toward defaults; blended in gradually).
  5. Opus also writes "what actually worked" notes into the memo.
- The channel's own historical thumbnails (when the channel has a YouTube ID) join the reference set as a third pool, **own history**, for brand consistency.

---

## 4. Agent & UX surfaces

- **CLI** (`nailstar …`). Full contract in [`docs/cli.md`](docs/cli.md).
  - Every command supports `--json`. Long runs support `--detach` and `status --watch --json` (NDJSON events).
  - Commands are non-interactive by default when stdout isn't a TTY.
  - Exit codes are stable: 0 ok, 1 error, 2 usage, 3 awaiting review, 4 quota exhausted, 5 dependency missing, 6 Claude usage limit.
- **Claude Code plugin** (`plugin/`):
  - `skills/nailstar/SKILL.md` teaches agents to start a detached run, wait for events, read the brief and trend report, act as reviewer in `--review=agent`, and export.
  - A `/nailstar` command wraps the common path.
  - This is the primary way Claude Code users will drive it.
- **Web UI** (`nailstar ui`): view and review only. It's `Bun.serve` + Preact with no build step (Bun HTML imports), and live updates arrive over SSE from the run event log. Views:
  1. **Runs**: a list with status, channel, best score and thumbnails.
  2. **Run**: a stage timeline; brief; trend report with the reference wall (grouped by pool, coloured by outlier score); an evolution board (generations as columns, lineage lines, scores and critiques on hover); and a mock-feed preview toggle (desktop/mobile × light/dark).
  3. **Review**: big candidate cards. Keys: `1–5` rate, `k` kill, `b` boost, `m` more-like-this, `n` note, `t` edit title, `⏎` submit + resume.
  4. **Channel**: taste memo (editable), history, and a judge-score vs. CTR scatter.

---

## 5. Repository layout

```
nailstar/
  src/
    cli/              # command definitions (commander), output formatting, exit codes
    core/
      ingest/         # ffmpeg/ffprobe, keyframes, contact sheets, palette
      research/       # YouTube client, quota ledger, outlier math, pools
      analyze/        # features, tagging, trend synthesis
      direct/         # design brief + initial genomes
      build/          # builder orchestration, renderer, lint, repair
      evaluate/       # mock feed compositor, judge/planner
      evolve/         # genome, operators, selection, loop, termination
      review/         # checkpoint logic, rating ingestion, review modes
      learn/          # taste memo, CTR sync, calibration
      run/            # run state machine, event log, resume
    providers/        # Provider interface, claude-code (claude -p), anthropic-api (later)
    store/            # bun:sqlite schema, migrations, repositories, cache
    server/           # Bun.serve: JSON API + SSE + static UI
    web/              # Preact UI (HTML imports)
    schemas/          # zod schemas → JSON Schema for --json-schema
  prompts/            # versioned markdown prompt templates per role
  assets/kit/         # fonts/, icons/, kit.css, kit.js
  plugin/             # Claude Code plugin (skill + command)
  eval/               # benchmark set + harness (see §7)
  docs/
```

Runtime data lives in `~/.nailstar/` (override with `NAILSTAR_HOME`): `config.json`, `nailstar.db`, `cache/thumbs/`, `runs/<runId>/…`. See [`docs/architecture.md`](docs/architecture.md).

---

## 6. Phased implementation

Each phase ends with something runnable plus its acceptance criteria.

### Phase 0 — Spikes (de-risk first)
- **P0.1 Provider spike.** Check `claude -p --model opus --output-format json --json-schema … --tools "" --system-prompt …`:
  - Confirm image input through `--input-format stream-json` with base64 image blocks, and fall back to the `Read` tool on file paths.
  - Measure cold start latency and 3-way concurrency.
  - Confirm it works when nested inside a running Claude Code session.
  - Confirm `--safe-mode` and `--setting-sources` isolation leaves subscription auth intact. `--bare` is ruled out because it forces API-key auth.
- **P0.2 Render spike.** Have Opus build 5 thumbnails from hand-written genomes using a draft kit, render them, and eyeball quality. Decide how much of the SVG character kit is needed.
- **P0.3 YouTube spike.** Real queries for 3 niches. Check the quota math, outlier distributions and thumbnail availability (maxres vs hq).
- ✅ Done when the answers are written into `docs/provider.md` and `docs/youtube.md`, and every assumption marked *verify* is resolved.

### Phase 1 — Foundation
- Bun project, lint/format, `bun test`. `commander` CLI skeleton with `--json` and exit-code plumbing.
- `~/.nailstar` bootstrap, config (`youtube.apiKey`, defaults), `nailstar init` / `doctor` (bun, ffmpeg, claude, chromium, API key, auth).
- SQLite schema + migrations; run state machine; `events.jsonl` writer; `status`, `runs`, `resume` (no-op stages).
- `Provider` interface + `ClaudeCodeProvider`: a process pool, schema validation (zod) + 1 retry on invalid JSON, timeouts, usage/cost logging to `llm_calls`.
- ✅ `nailstar doctor` is green, and a dummy run walks through every state, survives `kill -9` and resumes.

### Phase 2 — Ingest
- ffprobe, scene-detect + uniform sampling, pHash dedupe, contact sheets, palette, the VideoBrief call.
- ✅ `nailstar analyze --video v.mp4 --script s.md --title "…" --stage ingest` writes a schema-valid `brief.json` in under 60s for a 10-minute video.

### Phase 3 — Research
- YouTube client with an ETag/TTL cache, quota ledger, channel baselines, outlier score, the four pools, and the thumbnail cache.
- ✅ A cold run uses ≤ 800 units and a warm rerun ≤ 50. The pools are populated with sensible outliers (spot-checked), and there are unit tests for outlier math and pool selection.

### Phase 4 — Analyze
- Deterministic features, contact-sheet tagging, contrarian pick, trend synthesis, anchors.
- ✅ `nailstar analyze …` produces `trend-report.json` + a readable `trend-report.md`. Every pattern cites video IDs.

### Phase 5 — Build
- Render kit (fonts, icons, kit.css, kit.js face/character primitives), renderer (a persistent browser), lint, repair, downscales.
- `nailstar render <file.html>` for debugging the kit.
- ✅ Over 10 genomes, ≥ 90% pass lint after ≤ 1 repair, and render time is under 1.5s per candidate.

### Phase 6 — Evaluate
- Mock-feed compositor (light/dark grids), the anchored judge/planner call, rubric weights.
- **Judge stability test**: the same 3 candidates judged 3 times give a score std-dev under 0.5 per candidate.
- ✅ Judge output is schema-valid, critiques are actionable, and the plan references valid parents and operators.

### Phase 7 — Evolve + review modes
- Genome operators, selection, diversity guard, the loop, checkpoints (`human` / `agent` / `none`), termination, delivery and export.
- CLI: `run`, `review`, `rate`, `resume`, `export`.
- ✅ An end-to-end run on a real video finishes in ≤ 15 min of compute with `--review=none`. Human-review pause/resume works across process restarts.

### Phase 8 — Web UI
- Runs list, run view (timeline, reference wall, evolution board, mock-feed preview) and review view with keyboard flow, plus SSE live updates.
- ✅ A full review checkpoint can be completed with the keyboard alone, and the UI reflects CLI-driven runs live.

### Phase 9 — Channels & learning
- Channel CRUD, own-history pool, taste memo, Google OAuth loopback, `link`, `channel sync`, calibration.
- ✅ The taste memo visibly changes Direct output, and with a fixture dataset calibration produces shrunk weights. Live CTR sync works on a real channel.

### Phase 10 — Agent plugin, docs, eval
- `plugin/` skill + `/nailstar` command, `docs/cli.md` finalized, README examples verified.
- **Eval harness** (`eval/`): 10 benchmark videos (brief + script + the real published thumbnail and CTR when available).
  - Metric 1: **human win rate** of nailstar's top pick against the original (blind pairwise in the UI).
  - Metric 2: **judge–human agreement** (Kendall τ).
  - Metric 3: wall-clock time and calls per run.
- ✅ A Claude Code agent can go from "make a thumbnail for this video" to exported PNGs using only the skill. The eval baseline is recorded.

---

## 7. Efficiency playbook
- **One Opus call per generation for judging + planning**; builds run in parallel (pool of 3).
- **Contact sheets** instead of individual images for ingest and tagging.
- **Micro mutations edit the parent HTML** (a small diff-like change) instead of regenerating, which gives faster, cheaper and more faithful refinement. Macro mutations rebuild from the genome.
- **Stable prompt prefixes** (render contract, kit reference, brief, trend report first; volatile content last) maximise Claude Code's automatic prompt caching.
- **Caches**: YouTube responses (TTL), channel baselines (7d), thumbnails (forever), tags per video ID (forever, keyed by prompt version), and briefs keyed by a hash of video + script.
- **Persistent Chromium**: renders cost milliseconds, not seconds.
- **`--effort`** per role (configurable): `high` for Direct/Evaluate/Analyze, `medium` for Build/Repair.

---

## 8. Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Terms**: Anthropic bans subscription OAuth in third-party tools. Shelling out to the official `claude` binary is a gray area for an automated tool. | Local, personal use only, through the official binary (never touch tokens). The `Provider` interface keeps an `AnthropicApiProvider` (API key) a one-file addition. The README states this plainly. |
| R2 | Code-drawn characters look amateurish. | Ship a curated SVG primitive kit (face/emotion kit, character builder, stickers). Bias genomes toward typography, symbol and object-led compositions when the subject is hard to draw. P0.2 measures this early. |
| R3 | Judge noise or drift across generations. | Anchored comparative judging, rationale-before-score, a stability test in P6, a human blend, CTR calibration. |
| R4 | YouTube quota (10k/day). | Caching, a ledger, warm-run reuse, graceful degradation, optional quota-increase application. |
| R5 | `claude -p` latency, rate limits or usage caps on the subscription. | A process pool, merged calls, `--max-gens` / `--time-cap`, resumable runs, clear "usage limit hit, resume later" handling. |
| R6 | Population collapse (3 is small). | Divergent G0 strategies, a diversity guard, wildcard-injection operator, human "more like this" / kill. |
| R7 | CTR is confounded (topic, timing, title). | Use CTR relative to the channel median, require n ≥ 10, shrink toward default weights. It only re-weights the rubric; it never replaces it. |

---

## 9. Open questions (non-blocking; defaults chosen)
1. Thumbnail text language: default to the script's language (detected in ingest).
2. Should delivered titles respect a max length? Default ≤ 70 chars, with a warning past 60.
3. Licence for the repo (none yet; fonts in the kit are OFL and keep their licence files).
