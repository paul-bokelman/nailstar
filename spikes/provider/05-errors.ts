// P0.1: what do failures look like? Capture every stream-json event type and the shapes of
// provokable errors (bad model, network down, budget cap, timeout kill). Real usage-limit /
// rate-limit errors can't be provoked on demand; see docs/provider.md for how those were derived.
// Run: bun spikes/provider/05-errors.ts
import { callClaude, scrubbedEnv } from "./lib";

const iso = ["--safe-mode", "--setting-sources", ""];
const out: Record<string, any> = {};

function shape(r: Awaited<ReturnType<typeof callClaude>>) {
  const types = r.events.map((e) => (e.subtype ? `${e.type}:${e.subtype}` : e.type));
  const nonCore = r.events.filter((e) => !["system", "assistant", "result", "user"].includes(e.type));
  const res = r.result ? { ...r.result, usage: undefined, modelUsage: undefined, subagent_stats: undefined } : null;
  return { exit: r.exitCode, timedOut: r.timedOut, eventTypes: [...new Set(types)], nonCoreEvents: nonCore, result: res, stderr: r.stderr.slice(0, 1000), stdoutTail: r.result ? undefined : r.stdout.slice(-1000) };
}

// normal call: which event types show up? (looking for rate_limit_event etc.)
out.normal = shape(await callClaude({ system: "Terse.", content: "Reply: ok", extraArgs: iso }));
console.log("normal", JSON.stringify(out.normal).slice(0, 2500));

// unknown model
out.badModel = shape(await callClaude({ system: "Terse.", content: "Reply: ok", extraArgs: [...iso, "--model", "opus-nonexistent-9"] }));
console.log("badModel", JSON.stringify(out.badModel).slice(0, 2500));

// network down: point the API at a dead local port (auth stays OAuth; we only break transport)
{
  const env = { ...scrubbedEnv(), ANTHROPIC_BASE_URL: "http://127.0.0.1:9" };
  const t0 = performance.now();
  const proc = Bun.spawn(["claude", "-p", "--model", "opus", "--output-format", "stream-json", "--verbose", "--tools", "", "--no-session-persistence", "--strict-mcp-config", ...iso, "Reply: ok"], { env, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill("SIGKILL"), 90_000);
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  clearTimeout(timer);
  const events = stdout.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
  out.networkDown = { exit, ms: Math.round(performance.now() - t0), eventTypes: events.map((e: any) => e.subtype ? `${e.type}:${e.subtype}` : e.type ?? "raw"), result: events.find((e: any) => e.type === "result"), retryEvents: events.filter((e: any) => e.type === "system" && e.subtype !== "init").slice(0, 3), stderr: stderr.slice(0, 1000) };
  console.log("networkDown", JSON.stringify(out.networkDown).slice(0, 2500));
}

// budget cap hit
out.budget = shape(await callClaude({ system: "Terse.", content: "Write 300 words about tides.", extraArgs: [...iso, "--max-budget-usd", "0.0001"] }));
console.log("budget", JSON.stringify(out.budget).slice(0, 2500));

// our own timeout kill (what the pool sees when it SIGKILLs a slow call)
out.timeoutKill = shape(await callClaude({ system: "Terse.", content: "Write 2000 words about tides.", extraArgs: iso, timeoutMs: 4000 }));
console.log("timeoutKill", JSON.stringify(out.timeoutKill).slice(0, 1500));

await Bun.write(`${import.meta.dir}/out/05-errors.json`, JSON.stringify(out, null, 2));
