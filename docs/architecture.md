# Architecture

## Module boundaries

```
cli ──┐                          ┌── providers/claude-code  (claude -p pool)
      ├──► core/run (orchestrator)├── store (bun:sqlite + files)
server┘        │                 └── assets/kit (render kit)
               ▼
   ingest → research → analyze → direct → [build ⇄ evaluate → evolve → review]* → deliver
                                                                       │
                                                                     learn
```

- **`core/run`** is the only module that sequences stages. Stages are pure-ish functions `(ctx, input) → output` that read and write through `store` and call models only through the `Provider`.
- **`cli`** and **`server`** are thin adapters over `core/run` and `store`. The server never starts runs (the web UI is view + review only). It writes ratings and calls `resume`.
- **Every model call goes through `Provider.complete()`.** Nothing else knows about `claude -p`.

## Run state machine

```
created → ingesting → researching → analyzing → directing
        → evolving(g) ⇄ awaiting_review(g) → delivering → done
any → failed | cancelled          failed/cancelled → (resume) → last good state
```

- State and the current generation are persisted in `runs` after every step. Each stage writes its artifact to the run dir *before* advancing state.
- **Resume** = load the run and re-enter the current state. Stages are idempotent: if the artifact exists and its input hash matches, skip.
- `awaiting_review` is a durable pause. The process exits (or the detached worker idles out), and `nailstar resume <id>` or the UI's "Submit & resume" restarts the worker.

## Process model

- `nailstar run` runs the orchestrator in-process by default and streams progress.
- `--detach` spawns `nailstar __worker <runId>` (Bun subprocess, `unref`), writes its PID to the run row, and returns `{runId}` immediately.
- A **file lock** per run (`runs/<id>/.lock`) prevents two workers on the same run.
- The web UI (`nailstar ui`) tails `events.jsonl` for SSE. It needs no IPC with the worker.

## Run directory

```
~/.nailstar/runs/<runId>/
  run.json                    # resolved options snapshot
  events.jsonl                # append-only event log (also the SSE + --watch source)
  input/script.md             # copied; video is referenced by absolute path + sha256
  ingest/
    frames/f00.jpg …          # keyframes (768px)
    sheets/sheet-0.jpg …      # labelled contact sheets
    palette.json
    brief.json                # VideoBrief
  research/
    references.json           # all candidates + stats + outlier + pool
    pools.json                # selected similar/wildcard/own ids
  analyze/
    sheets/refs-0.jpg …
    tags.json
    trend-report.json
    trend-report.md
  direct/design-brief.json
  gens/g<N>/
    c<K>/
      genome.json
      index.html
      full.png  mobile.png  feed.png
      lint.json
    feed-light.png  feed-dark.png
    evaluation.json           # scores, critiques, next-gen plan
    review.json               # human/agent ratings (if checkpoint)
  result/
    1.png 1.json  2.png 2.json  3.png 3.json   # json = title, genome, scores, lineage
    report.html               # static lineage report
```

## Event log

One JSON object per line: `{ts, runId, type, data}`. Types:
`state`, `stage.start`, `stage.done`, `llm.call` (role, ms, tokens, cost), `quota` (searches, units), `candidate.rendered`, `candidate.lint`, `evaluation`, `checkpoint`, `review.submitted`, `result`, `warn`, `error`.

`nailstar status <id> --watch --json` replays and then tails the file, which makes it easy for agents to monitor (and works with Claude Code's Monitor tool).

## Concurrency

- `Provider` pool size = `--concurrency` (default 3). Builds in a generation run in parallel, and evaluation waits for all three.
- Chromium: one browser per worker, one `BrowserContext` per render (isolation), max 3 concurrent pages.
- YouTube calls are serialized per endpoint, with `ids` batched up to 50.
