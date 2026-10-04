// Spike helper: spawn `claude -p` the way nailstar's provider will, and capture everything.
// Never pass --bare (it forces API-key auth).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Block =
  | { type: "text"; text: string }
  | { type: "image"; path: string; mediaType?: string };

export interface CallOpts {
  system?: string;
  content: Block[] | string;
  schema?: object;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  extraArgs?: string[];
  /** "inherit" passes the parent env through; "scrub" drops CLAUDECODE / CLAUDE_CODE_* vars. */
  env?: "inherit" | "scrub";
  outputFormat?: "json" | "stream-json";
  cwd?: string;
  timeoutMs?: number;
}

export interface CallResult {
  args: string[];
  exitCode: number | null;
  wallMs: number;
  firstByteMs: number | null;
  resultMs: number | null; // when the result event arrived (exit lag = wallMs - resultMs)
  stdout: string;
  stderr: string;
  result: any; // parsed final result object, if any
  events: any[]; // stream-json events, if requested
  timedOut: boolean;
}

export function scrubbedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_") || k === "CLAUDE_PID" || k === "CLAUDE_EFFORT") continue;
    env[k] = v;
  }
  return env;
}

async function toContent(content: Block[] | string) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  const out: any[] = [];
  for (const b of content) {
    if (b.type === "text") out.push(b);
    else {
      const bytes = await Bun.file(b.path).arrayBuffer();
      const mediaType = b.mediaType ?? (b.path.endsWith(".png") ? "image/png" : "image/jpeg");
      out.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data: Buffer.from(bytes).toString("base64") },
      });
    }
  }
  return out;
}

export async function callClaude(o: CallOpts): Promise<CallResult> {
  const outputFormat = o.outputFormat ?? "stream-json";
  const args = [
    "-p",
    "--model", "opus",
    "--effort", o.effort ?? "low",
    "--output-format", outputFormat,
    "--input-format", "stream-json",
    "--tools", "",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--permission-prompts", "none",
  ];
  if (outputFormat === "stream-json") args.push("--verbose");
  if (o.system !== undefined) args.push("--system-prompt", o.system);
  if (o.schema) args.push("--json-schema", JSON.stringify(o.schema));
  if (o.extraArgs) args.push(...o.extraArgs);

  const msg = { type: "user", message: { role: "user", content: await toContent(o.content) } };
  const cwd = o.cwd ?? mkdtempSync(join(tmpdir(), "nailstar-spike-"));
  const t0 = performance.now();
  const proc = Bun.spawn(["claude", ...args], {
    cwd,
    env: o.env === "scrub" ? scrubbedEnv() : (process.env as Record<string, string>),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(JSON.stringify(msg) + "\n");
  proc.stdin.end();

  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; proc.kill("SIGKILL"); }, o.timeoutMs ?? 300_000);

  let firstByteMs: number | null = null;
  let resultMs: number | null = null;
  let stdout = "";
  const decoder = new TextDecoder();
  for await (const chunk of proc.stdout) {
    if (firstByteMs === null) firstByteMs = performance.now() - t0;
    stdout += decoder.decode(chunk, { stream: true });
    if (resultMs === null && stdout.includes('"type":"result"')) resultMs = performance.now() - t0;
  }
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  clearTimeout(timer);
  const wallMs = performance.now() - t0;

  const events: any[] = [];
  let result: any = null;
  for (const line of stdout.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const ev = JSON.parse(s);
      events.push(ev);
      if (ev.type === "result") result = ev;
    } catch { /* non-JSON line */ }
  }
  return { args, exitCode, wallMs, firstByteMs, resultMs, stdout, stderr, result, events, timedOut };
}

export function summary(r: CallResult) {
  const u = r.result?.usage ?? {};
  return {
    exit: r.exitCode,
    isError: r.result?.is_error,
    subtype: r.result?.subtype,
    wallMs: Math.round(r.wallMs),
    apiMs: r.result?.duration_api_ms,
    overheadMs: r.result ? Math.round(r.wallMs - r.result.duration_api_ms) : null,
    firstByteMs: r.firstByteMs && Math.round(r.firstByteMs),
    resultMs: r.resultMs && Math.round(r.resultMs),
    exitLagMs: r.resultMs ? Math.round(r.wallMs - r.resultMs) : null,
    ttftMs: r.result?.ttft_ms,
    timeToRequestMs: r.result?.time_to_request_ms,
    in: u.input_tokens,
    cacheCreate: u.cache_creation_input_tokens,
    cacheRead: u.cache_read_input_tokens,
    out: u.output_tokens,
    costUsd: r.result?.total_cost_usd,
    rateLimit: r.events.findLast((e) => e.type === "rate_limit_event")?.rate_limit_info?.unifiedWindows,
    result: typeof r.result?.result === "string" ? r.result.result.slice(0, 120) : r.result?.result,
    stderr: r.stderr.slice(0, 300),
  };
}
