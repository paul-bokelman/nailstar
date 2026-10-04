# Provider: `claude -p`

nailstar makes **every model call** by spawning the user's installed Claude Code in print mode, so calls run on the user's own Claude subscription through the official binary. nailstar never reads, stores or forwards auth tokens.

> ⚠️ **Terms note.** Since early 2026 Anthropic has prohibited using Claude Free, Pro or Max OAuth tokens in third-party tools. nailstar does not do that: it invokes the official `claude` CLI. Still, automated use of the CLI by another tool is a gray area. nailstar is designed for **local, personal use**. An `AnthropicApiProvider` (API key, pay-as-you-go) is a one-file addition behind the same interface.

## Interface

```ts
interface Provider {
  complete<T>(req: {
    role: Role;                       // 'ingest' | 'tag' | 'synthesize' | 'direct' | 'build' | 'repair' | 'evaluate' | 'memo'
    system: string;                   // stable prefix first (caching)
    content: Array<{ type: 'text'; text: string } | { type: 'image'; path: string }>;
    schema?: ZodType<T>;              // → JSON Schema for --json-schema; validated again with zod
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    timeoutMs?: number;
  }): Promise<{ data: T; text: string; usage: Usage; costUsd?: number; ms: number }>;
}
```

## Invocation (baseline; finalized in Phase 0)

```bash
claude -p \
  --model opus \
  --effort high \
  --output-format json \
  --input-format stream-json \          # lets us send image content blocks (verify P0.1)
  --json-schema "$SCHEMA_JSON" \        # when the role has a schema
  --system-prompt "$SYSTEM" \           # replaces the coding-agent prompt entirely
  --tools "" \                          # pure completion; no tool turns
  --no-session-persistence \
  --setting-sources "" \                # ignore user/project settings, CLAUDE.md, hooks (verify)
  --strict-mcp-config \                 # no MCP servers
  --permission-prompts none
```

- **Do not use `--bare`.** It restricts auth to `ANTHROPIC_API_KEY`, which defeats the subscription provider.
- `cwd` = a temp dir inside the run dir, so no project CLAUDE.md is discovered.
- Message body over stdin as a single `stream-json` user message:
  `{"type":"user","message":{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":"…"}},{"type":"text","text":"…"}]}}`
- **Fallback if stream-json images don't work:** enable `--tools Read --add-dir <runDir>` and reference image paths in text. This is slower (extra tool turns), so it's only a fallback.

## Output handling

- Parse the final JSON result object. Record `result`, the `structured_output` field when present, `usage`, `total_cost_usd` and `duration_ms` into `llm_calls` (field names verified in P0.1).
- Validate with zod. On failure, retry **once** with the validation error appended. On a second failure, fail the stage with a clear error.
- **Builder output** is HTML, not JSON. Use a schema `{ html: string, notes: string }` so the HTML is never mangled by markdown fences.

## Pooling & limits

- A semaphore of `concurrency` (default 3) live `claude` processes.
- A per-call timeout by role (build 180s, evaluate 240s, others 120s). On timeout: kill the process group and retry once.
- **Usage-limit detection**: if stderr or the result indicates a rate or usage limit, mark the run `failed` with `reason: usage_limit` and print `nailstar resume <id>` guidance. Never hot-loop.
- Measure and log the cold-start overhead per call (P0.1). If it's large, consider one long-lived `stream-json` session per role, with care: it accumulates context.

## Phase 0 checklist
- [ ] Image blocks via `--input-format stream-json` work, and the token cost per 1536px sheet is measured.
- [ ] `--json-schema` returns `structured_output` that validates.
- [ ] `--setting-sources ""` / `--safe-mode` keep OAuth auth working, and the startup latency of each is measured.
- [ ] 3 concurrent processes are stable. Measure throughput with Opus at `high` effort.
- [ ] Works when nailstar itself is run from inside a Claude Code session (nested `claude` process).
- [ ] Rate-limit and usage-limit error shapes are captured for detection.
