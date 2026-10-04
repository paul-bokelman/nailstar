# Provider: `claude -p`

nailstar makes **every model call** by spawning the user's installed Claude Code in print mode, so calls run on the user's own Claude subscription through the official binary. nailstar never reads, stores or forwards auth tokens.

> ⚠️ **Terms note.** Since early 2026 Anthropic has prohibited using Claude Free, Pro or Max OAuth tokens in third-party tools. nailstar does not do that: it invokes the official `claude` CLI. Still, automated use of the CLI by another tool is a gray area. nailstar is designed for **local, personal use**. An `AnthropicApiProvider` (API key, pay-as-you-go) is a one-file addition behind the same interface.

All numbers below come from the Phase 0 spike (`spikes/provider/`, Claude Code 2.1.289, Opus 5.5, 2026-10-03). Re-run those scripts after a major Claude Code upgrade.

## Interface

```ts
interface Provider {
  complete<T>(req: {
    role: Role;                       // 'ingest' | 'tag' | 'synthesize' | 'direct' | 'build' | 'repair' | 'evaluate' | 'memo'
    system: string;                   // stable prefix first (caching)
    content: Array<{ type: 'text'; text: string } | { type: 'image'; path: string }>;
    schema?: ZodType<T>;              // → JSON Schema (draft-07!) for --json-schema; validated again with zod
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    timeoutMs?: number;
  }): Promise<{ data: T; text: string; usage: Usage; costUsd?: number; ms: number; rateLimit?: RateLimitInfo }>;
}
```

## Invocation (final)

```bash
claude -p \
  --model opus \
  --effort <per role> \
  --input-format stream-json \          # needed for image blocks…
  --output-format stream-json \         # …and stream-json input REQUIRES stream-json output
  --verbose \                           # …which in turn REQUIRES --verbose with -p
  --json-schema "$SCHEMA_JSON" \        # when the role has a schema (draft-07, see below)
  --system-prompt "$SYSTEM" \           # replaces the coding-agent prompt
  --tools "" \                          # pure completion; no tool turns
  --no-session-persistence \
  --safe-mode \                         # no CLAUDE.md, skills, plugins, hooks, auto-memory
  --setting-sources "" \                # no user/project/local settings files
  --strict-mcp-config \                 # no MCP servers (saves ~10k input tokens per call)
  --permission-prompts none
```

Environment: `CLAUDE_CODE_MAX_RETRIES=2` (nailstar owns retry policy, see below). Drop the parent's `CLAUDECODE` / `CLAUDE_CODE_*` variables when spawning (both inherited and scrubbed envs work; scrubbing avoids coupling to a parent session's messaging socket).

- **Do not use `--bare`.** It restricts auth to `ANTHROPIC_API_KEY`, which defeats the subscription provider.
- `cwd` = a temp dir inside the run dir, so no project CLAUDE.md is discovered.
- Message body over stdin as a single `stream-json` user message, then close stdin:
  `{"type":"user","message":{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":"…"}},{"type":"text","text":"…"}]}}`
- Interleave text labels and images freely (`"Candidate g3c1:"`, image, `"Mobile:"`, image…). Verified with 6 images in one message.
- The `Read`-tool fallback for images is **not needed**: base64 image blocks work.

### What each isolation flag does (measured)

| Variant | Auth | Hidden context | Startup overhead (median) | Notes |
|---|---|---|---|---|
| no isolation flags, no `--strict-mcp-config` | OAuth ✅ | **~10,000 tokens** | ~3 s | claude.ai MCP connectors are injected |
| `--strict-mcp-config` only | OAuth ✅ | ~570 tokens | ~2.1 s | user plugins + auto-memory still load |
| `--setting-sources ""` | OAuth ✅ | ~450 tokens | ~1.7 s | auto-memory path still set |
| `--safe-mode` | OAuth ✅ | ~450 tokens | ~1.8 s | user plugins still listed in `init` |
| `--restricted` | OAuth ✅ | ~450 tokens | ~1.5 s | also works; confines file tools (irrelevant with `--tools ""`) |
| **`--safe-mode --setting-sources ""`** | **OAuth ✅** | **~450 tokens** | **~1.3 s** | **chosen** |

Auth was confirmed via the stream-json `init` event (`apiKeySource: "none"` = subscription OAuth) in every variant, including with a scrubbed environment.

Even fully isolated, the CLI adds ~430 tokens nailstar can't remove: a one-line SDK identity prefix before our system prompt, a reminder with the account's email address, an environment block (cwd, OS) and today's date. It is stable within a day, so it doesn't hurt caching. Nothing in nailstar should depend on or echo it.

### Nested inside Claude Code
Works. nailstar run from inside a Claude Code session (env has `CLAUDECODE=1`, `CLAUDE_CODE_*` set) spawns `claude -p` children without problems, inherited or scrubbed env.

## Structured output

- `--json-schema` **rejects zod v4's default `$schema: draft/2020-12`** ("no schema with key or ref"). Generate with `z.toJSONSchema(schema, { target: "draft-7" })`.
- The final `result` event carries the parsed object in **`structured_output`** and the same JSON as a string in `result`. 13/13 schema calls in the spike returned `structured_output` that passed zod.
- Still validate with zod; on failure retry **once** with the validation error appended, then fail the stage.
- **Builder output** uses `{ html, notes }`: verified, HTML comes back intact (no fences).

## Output handling

Read stdout line by line (NDJSON). Event types seen: `system:init`, `assistant`, `rate_limit_event`, `system:api_retry`, `system:thinking_tokens`, `result:<subtype>`.

From the `result` event record into `llm_calls`: `is_error`, `subtype`, `terminal_reason`, `api_error_status`, `structured_output`, `result`, `usage` (`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`), `total_cost_usd`, `duration_ms`, `duration_api_ms`, `ttft_ms`. On a subscription `total_cost_usd` is a **notional list price** (`costBasis: "list"`), useful only for comparing calls.

**Success = `is_error === false`.** Don't trust `subtype`: an API error (e.g. unknown model, 404) arrives as `subtype: "success"`, `is_error: true`, `terminal_reason: "api_error"`, exit code 1.

## Latency & throughput (Opus, measured)

| Measure | Value |
|---|---|
| Process overhead (spawn → exit minus API time), isolated | **~1.3 s** median (first byte ~0.6 s, exit lag ~0.2–0.7 s); ~2 s under 6-way contention |
| Output speed | ~100 tokens/s regardless of effort |
| Build at `medium` effort | 42–118 s (median ~60 s), 4.3–11.3k output tokens, of which only 25–35 % is HTML (rest is thinking); notional $0.10–0.25 |
| Build at `low` effort | **19–27 s**, 1.9–2.9k output tokens; notional ~$0.05 |
| Evaluate (3 candidates × full + 168px = 6 images, judge+plan schema) | `high` 40 s (TTFT 14 s), `medium` 28 s; same candidate ranking at both |
| Concurrency | 1 build 29.7 s · 3 parallel 32.7 s · 6 parallel 31.9 s — all succeeded, no throttling |
| Image tokens | 1280×720 PNG ≈ **1,200** · 1536×864 contact sheet ≈ **1,720** (≈ w×h/750) |
| Prompt caching | works across processes: identical system prefixes show `cache_read_input_tokens` on the 2nd+ call |

Cold-start is small next to generation time, so **no long-lived session per role** is needed. Wall clock is output-bound, so **effort is the main latency lever** (see Build effort in PLAN §7).

## Pooling & limits

- A semaphore of `concurrency` (default 3) live `claude` processes. 6 is also stable.
- A per-call timeout by role (build 120s at `low`, evaluate 180s, others 120s). On timeout: SIGKILL the process group (exit 137, no `result` event) and retry once.
- **Transport retries**: by default the CLI silently retries network/overload errors up to 10× with backoff (`system:api_retry` events: `attempt`, `max_retries`, `retry_delay_ms`, `error_status`, `error`), which took >90 s with the network down. With `CLAUDE_CODE_MAX_RETRIES=2` the same failure returns in ~3 s as a clean `result` (`is_error: true`, `terminal_reason: "api_error"`, `result: "API Error: Connection refused …"`). nailstar logs `api_retry` events and owns the outer retry.

### Usage-limit detection

Every call emits a **`rate_limit_event`** before the result, with live subscription state:

```json
{"type":"rate_limit_event","rate_limit_info":{
  "status":"allowed",                         // allowed | allowed_warning | rejected
  "rateLimitType":"five_hour",                // five_hour | seven_day | seven_day_opus | seven_day_sonnet | seven_day_overage_included | overage
  "resetsAt":1791094800,                      // epoch seconds
  "overageStatus":"rejected", "isUsingOverage":false,
  "unifiedWindows":{"five_hour":{"utilization":0.4,"resetsAt":1791094800},
                    "seven_day":{"utilization":0.38,"resetsAt":1791086400}}}}
```

- **Proactive**: after each call, record `unifiedWindows` in `llm_calls`. Before starting a new generation, if any window's `utilization` ≥ 0.95 (configurable) or `status` is `allowed_warning`, pause at the next safe point with `reason: usage_limit_near` and the reset time instead of failing mid-generation.
- **Reactive**: treat a call as a usage-limit failure when `rate_limit_info.status === "rejected"`, or `is_error` with `api_error_status === 429`, or the `result` text starts with `You've hit your` (the CLI's limit message prefix; `…session…` = five_hour, `…weekly…` = seven_day, `…model…` = per-model weekly). Mark the run `failed` with `reason: usage_limit`, store `resetsAt`, exit 6 and print `nailstar resume <id>` (after <time>). Never hot-loop.
- A real `rejected` event could not be provoked on demand. The shapes above come from the event schema in the CLI and the `status`/`rateLimitType` enums it validates. Confirm the first time a real limit is hit, and keep the detector permissive (any of the three signals).

### Subscription cost of a run (rough)
During the spike, ~48 calls (notional $2.67) moved five-hour utilization from 0.40 → 0.63 and seven-day from 0.38 → 0.40. The interactive session driving the spike shared the same account, so this is an upper bound. Per call, a medium-effort build cost about 0.8 % of the five-hour window. A full run (~35 calls with low-effort builds) should land around **10–20 % of a five-hour window** on this plan. Phase 1 should log utilization deltas per run to firm this up.

## Phase 0 checklist
- [x] Image blocks via `--input-format stream-json` work (needs `--output-format stream-json --verbose`). A 1536px sheet costs ≈ 1,720 tokens; a 1280×720 render ≈ 1,200.
- [x] `--json-schema` returns `structured_output` that validates, once the schema is draft-07.
- [x] `--safe-mode` + `--setting-sources ""` keep OAuth working; isolated startup overhead ≈ 1.3 s (vs ≈ 2–3 s unisolated).
- [x] 3 (and 6) concurrent processes are stable; wall time is the slowest call, not the sum.
- [x] Works when nailstar itself runs inside a Claude Code session.
- [x] Error shapes captured: API error, network failure + retries, budget cap (`subtype: "error_max_budget_usd"`), timeout kill, usage-limit signals.

Spike scripts: `spikes/provider/01-isolation.ts` … `06-evaluate-timing.ts` (shared helper `lib.ts`). Raw outputs land in `spikes/provider/out/` (gitignored; they contain account info).
