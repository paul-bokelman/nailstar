# CLI contract

Conventions:
- **Global flags:** `--json` (machine output), `--home <dir>` (default `~/.nailstar`), `--quiet`, `--no-color`.
- In **`--json` mode** stdout carries only JSON (one object, or NDJSON for streams). Logs go to stderr.
- When **stdout is not a TTY**, nothing ever prompts. Missing input means exit 2 with a message.
- **IDs:** runs are `ns_<ulid>` and candidates are `g<gen>c<slot>` (`ns_…:g3c1` when global). `@last` aliases the most recent run.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | runtime error (see `error.code` in JSON) |
| 2 | usage / validation error |
| 3 | run paused: **awaiting review** |
| 4 | YouTube quota exhausted and no cached references |
| 5 | dependency missing (`ffmpeg`, `claude`, chromium, API key) |
| 6 | Claude usage limit reached; resume later |

## Commands

### Setup
```
nailstar init                         # create ~/.nailstar, install chromium, prompt for YouTube API key (TTY only)
nailstar doctor [--json]              # check deps, auth, quota used today
nailstar config get [key]
nailstar config set <key> <value>     # youtube.apiKey, google.clientId, defaults.maxGens, …
```

### Channels
```
nailstar channel create <slug> [--name "…"] [--youtube <@handle|UC…>] [--niche "…"]
nailstar channel list | show <slug> | rm <slug>
nailstar channel memo <slug> [--edit]          # view/edit taste memo
nailstar channel connect <slug>                # Google OAuth (opens browser, loopback)
nailstar channel sync <slug>                   # pull CTR for linked videos; recalibrate
```

### Runs
```
nailstar run --video <path> --script <path> --title "<initial title>"
             [--channel <slug>]
             [--review human|agent|none]   (default human)
             [--review-every <n>]          (default 2)
             [--max-gens <n>]              (default 6)
             [--threshold <0-10>]          (default 8.5)
             [--time-cap <minutes>]        (default 20)
             [--concurrency <n>]           (default 3)
             [--effort low|medium|high|xhigh|max]   (default per role)
             [--max-searches <n>]          (default 7)
             [--detach]                    # return {runId} immediately; work continues in background
nailstar analyze --video … --script … --title … [--channel …]   # ingest+research+analyze only, no evolution
nailstar status <run> [--watch] [--json]       # --watch --json = NDJSON event stream until pause/finish
nailstar runs [--channel <slug>] [--state <s>] [--limit n]
nailstar resume <run> [--detach]
nailstar cancel <run>
```

### Review
```
nailstar review <run> [--json]                 # pending candidates: ids, image paths, titles, scores, critiques
nailstar rate <run> <cand> [--stars 1-5] [--note "…"] [--kill|--boost|--more]
              [--title "…"]                    # override/pin a title
nailstar approve <run> [--resume]              # submit the checkpoint (resume unless --no-resume)
```

### Results
```
nailstar export <run> [--top 3] [--out <dir>] [--format png|jpg]
nailstar open <run>                            # open the report in the web UI
nailstar link <run> <cand> --video <youtubeVideoId>   # what you actually published
```

### Tools
```
nailstar ui [--port 4477] [--open]
nailstar render <file.html> [--out x.png] [--lint]    # kit/debug
nailstar refs <run> [--pool similar|wildcard|…]       # list references with outlier scores
```

## JSON shapes (abridged)

`nailstar run --detach --json`
```json
{ "runId": "ns_01J…", "state": "ingesting", "home": "/Users/me/.nailstar/runs/ns_01J…" }
```

`nailstar status <run> --watch --json` (NDJSON)
```json
{"ts":1759…,"type":"stage.done","data":{"stage":"research","quotaUnits":712,"references":20}}
{"ts":1759…,"type":"evaluation","data":{"generation":2,"best":{"id":"g2c0","total":8.1}}}
{"ts":1759…,"type":"checkpoint","data":{"generation":2,"reviewMode":"agent","next":"nailstar review ns_01J… --json"}}
```

`nailstar review <run> --json`
```json
{
  "runId": "ns_01J…", "generation": 2, "reviewMode": "agent",
  "designBrief": "…",
  "candidates": [{
    "id": "g2c0", "title": "…", "full": "/…/full.png", "mobile": "/…/mobile.png", "feed": "/…/feed.png",
    "scores": { "total": 8.1, "glanceability": 9 }, "topFixes": ["…"], "lineage": ["g0c0:fresh", "g1c0:refine"]
  }]
}
```

`nailstar export <run> --json`
```json
{ "out": "./thumbs", "results": [{ "rank": 1, "png": "./thumbs/1.png", "title": "…", "fitness": 8.7 }] }
```
