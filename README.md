# ⭐ nailstar

**Thumbnails that evolve until they're impossible to scroll past.**

You give nailstar your video, script and title. It researches what's actually winning in your niche, studies the outliers, and then breeds YouTube thumbnails by natural selection: three are born, the weak are culled, and the strong mutate. No image model is involved. Every pixel is drawn in HTML/CSS/SVG by Claude and judged by Claude, with you holding the veto.

> 🚧 **Status: planned.** This README describes the CLI being built. The blueprint is in [`PLAN.md`](PLAN.md). Commands below are the target contract, not yet shipped.

---

## How it works (the 20-second version)

```
video + script + title
   → ingest     what is this video, really? (frames → brief)
   → research   who's crushing it in this niche? (YouTube outlier scores + wildcards)
   → analyze    why are they winning, and what's everyone overdoing?
   → direct     3 deliberately different concepts: proven · stolen · contrarian
   → evolve     build → render → judge → select → mutate → (you review every 2 gens) → repeat
   → deliver    top 3 thumbnail + title pairs, ready for YouTube Test & Compare
```

- **Outliers, not giants.** A video is "high performing" when it beats *its own channel's* median, not when it comes from a channel with 40M subscribers.
- **Wildcards on purpose.** Adjacent niches, global hits, contrarian styles and pure randomness keep the gene pool from inbreeding.
- **Titles evolve too.** A thumbnail that repeats its title wastes the space.
- **It learns your taste.** Channels remember your ratings and, once connected, your real CTR.

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- `ffmpeg` / `ffprobe`
- [Claude Code](https://claude.com/claude-code), logged in. nailstar runs every model call through `claude -p` using Opus.
- A YouTube Data API v3 key (free, 10k units/day; a fresh run uses about 800)
- *(optional)* A Google OAuth client, for pulling real CTR from YouTube Analytics

## Install

```bash
git clone https://github.com/paul-bokelman/nailstar && cd nailstar
bun install && bun link
nailstar init       # sets up ~/.nailstar, installs Chromium, asks for your YouTube key
nailstar doctor     # everything green? good.
```

## Quick start

```bash
nailstar run \
  --video ./ep42.mp4 \
  --script ./ep42.md \
  --title "The Moon Is Slowly Breaking Apart"
```

Grab a coffee. Every 2 generations nailstar pauses and asks for your opinion at `nailstar ui` (or in the terminal). Rate, kill, boost or leave a note like *"bigger text, less red"*. Nature continues.

```bash
nailstar export @last --out ./thumbs    # → 1.png 2.png 3.png + titles + lineage
```

---

## CLI

Global flags: `--json` (machine-readable stdout), `--home <dir>`, `--quiet`, `--no-color`. `@last` refers to your most recent run.

### Setup

| Command | What it does |
|---|---|
| `nailstar init` | Create `~/.nailstar`, install Chromium, store the YouTube API key |
| `nailstar doctor` | Check ffmpeg, claude, Chromium, keys, and today's quota use |
| `nailstar config get [key]` / `set <key> <value>` | Read and write config (`youtube.apiKey`, `google.clientId`, `defaults.*`) |

### Runs

| Command | What it does |
|---|---|
| `nailstar run --video <f> --script <f> --title "<t>"` | Full pipeline: research → evolve → deliver |
| `nailstar analyze --video … --script … --title …` | Research and trend report only, no evolution |
| `nailstar status <run> [--watch]` | Progress. With `--watch --json` you get an NDJSON event stream |
| `nailstar runs [--channel s] [--state s]` | List runs |
| `nailstar resume <run>` | Continue a paused, failed or interrupted run |
| `nailstar cancel <run>` | Stop a run |

`run` flags:

| Flag | Default | |
|---|---|---|
| `--channel <slug>` | none | Use a channel's memory and taste, and learn into it |
| `--review human\|agent\|none` | `human` | Who reviews at checkpoints |
| `--review-every <n>` | `2` | Generations between checkpoints |
| `--max-gens <n>` | `6` | Hard generation cap |
| `--threshold <0–10>` | `8.5` | Stop early when the best candidate reaches this and is approved |
| `--time-cap <min>` | `20` | Compute-time cap |
| `--concurrency <n>` | `3` | Parallel `claude` processes |
| `--effort <level>` | per role | Opus effort: `low` … `max` |
| `--max-searches <n>` | `7` | YouTube `search.list` calls per run (100 units each) |
| `--detach` | off | Return the run ID immediately and keep working in the background |

### Review

| Command | What it does |
|---|---|
| `nailstar review <run>` | Show the candidates awaiting review (images, titles, scores, critiques) |
| `nailstar rate <run> <cand> --stars 4 --note "…"` | Rate a candidate. Add `--kill`, `--boost`, `--more` (more like this) or `--title "…"` to pin a title |
| `nailstar approve <run>` | Submit the checkpoint and resume evolution |
| `nailstar ui [--port 4477]` | Local web UI to watch evolution and review (`1–5`, `k`, `b`, `m`, `n`, `⏎`) |

### Results & learning

| Command | What it does |
|---|---|
| `nailstar export <run> [--top 3] [--out dir]` | Write PNGs (1280×720, ≤ 2 MB), titles, genomes and a lineage report |
| `nailstar link <run> <cand> --video <id>` | Tell nailstar which candidate you published |
| `nailstar channel create <slug> [--youtube @handle] [--niche "…"]` | Make a channel with persistent memory |
| `nailstar channel memo <slug> [--edit]` | See or edit what nailstar thinks your taste is |
| `nailstar channel connect <slug>` | Connect YouTube Analytics (OAuth) |
| `nailstar channel sync <slug>` | Pull real CTR for linked videos and recalibrate the judge |
| `nailstar refs <run>` | Reference videos with outlier scores, by pool |
| `nailstar render <file.html>` | Render and lint any HTML with the thumbnail kit (debugging) |

### Exit codes

`0` ok · `1` error · `2` bad usage · `3` **paused for review** · `4` YouTube quota exhausted · `5` missing dependency · `6` Claude usage limit (resume later)

Full contract, including JSON shapes: [`docs/cli.md`](docs/cli.md).

---

## For agents (and the Claude Code users steering them)

nailstar is built to be driven by agents. Everything supports `--json`, nothing prompts when there's no TTY, and runs survive restarts. A Claude Code plugin with a skill and a `/nailstar` command will ship in `plugin/`.

```bash
id=$(nailstar run --video v.mp4 --script s.md --title "…" --review agent --detach --json | jq -r .runId)
nailstar status "$id" --watch --json          # stream until a checkpoint (exit 3) or done
nailstar review "$id" --json                  # agent inspects the image paths and critiques
nailstar rate "$id" g2c1 --stars 5 --note "keep the cracked moon"
nailstar approve "$id"                        # and evolution continues
nailstar export "$id" --json
```

Use `--review none` for fully autonomous runs, where the Claude judge decides alone.

## Good to know

- **Claude access.** nailstar shells out to your installed `claude` CLI and never touches auth tokens. Anthropic doesn't allow subscription logins inside third-party apps. Calling the official CLI is the route nailstar takes, but automated use like this is a gray area, so treat nailstar as a **local, personal tool**. An API-key provider is on the roadmap.
- **YouTube quota.** References, channel baselines and thumbnails are cached heavily, so repeat runs in a niche cost a fraction of a cold run.
- **Data lives in** `~/.nailstar/` (SQLite + run folders). Delete it and nailstar forgets everything, including its grudges.

## Docs

[`PLAN.md`](PLAN.md) · [architecture](docs/architecture.md) · [provider](docs/provider.md) · [YouTube & outliers](docs/youtube.md) · [genome & evolution](docs/genome.md) · [prompts](docs/prompts.md) · [data model](docs/data-model.md) · [CLI contract](docs/cli.md)
