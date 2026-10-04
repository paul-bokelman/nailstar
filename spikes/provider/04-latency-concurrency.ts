// P0.1: cold-start latency breakdown, and stability/throughput of 3 (and 6) concurrent Opus processes
// at effort=high on a build-sized task.
// Run: bun spikes/provider/04-latency-concurrency.ts
import { z } from "zod";
import { callClaude, summary } from "./lib";

const iso = ["--safe-mode", "--setting-sources", ""];
const Html = z.object({ html: z.string(), notes: z.string() });
const schema = z.toJSONSchema(Html, { target: "draft-7" });
const task = (i: number) =>
  `Write a self-contained HTML document: a 1280x720 div#thumb with a bold YouTube-thumbnail-style ` +
  `composition about "variant ${i}: the ocean is getting louder". Inline CSS/SVG only. Keep it under 120 lines.`;

const out: Record<string, any> = {};
const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// 1) startup latency, trivial prompt, 5 sequential runs (isolated vs not)
for (const [name, extra] of Object.entries({ isolated: iso, notIsolated: [] as string[] })) {
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const r = await callClaude({ system: "Terse.", content: "Reply: ok", extraArgs: extra, effort: "low" });
    rows.push(summary(r));
  }
  out[`startup_${name}`] = {
    rows,
    medianWallMs: median(rows.map((r) => r.wallMs)),
    medianFirstByteMs: median(rows.map((r: any) => r.firstByteMs)),
    medianApiMs: median(rows.map((r) => r.apiMs)),
    medianOverheadMs: median(rows.map((r: any) => r.overheadMs)),
    medianExitLagMs: median(rows.map((r: any) => r.exitLagMs)),
  };
  console.log(`startup_${name}`, JSON.stringify({ ...out[`startup_${name}`], rows: undefined }));
}

// 2) build-sized task at effort=high: 1 alone, then 3 concurrent, then 6 concurrent
async function batch(n: number) {
  const t0 = performance.now();
  const rs = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      callClaude({ system: "You write HTML thumbnails.", content: task(i), schema, extraArgs: iso, effort: "high" }),
    ),
  );
  const rows = rs.map((r) => ({ ...summary(r), result: undefined, htmlLen: r.result?.structured_output?.html?.length, zodOk: Html.safeParse(r.result?.structured_output).success }));
  return { n, batchWallMs: Math.round(performance.now() - t0), allOk: rows.every((r) => r.exit === 0 && r.zodOk), rows };
}
for (const n of [1, 3, 6]) {
  out[`build_x${n}`] = await batch(n);
  console.log(`build_x${n}`, JSON.stringify(out[`build_x${n}`]));
}
await Bun.write(`${import.meta.dir}/out/04-latency-concurrency.json`, JSON.stringify(out, null, 2));
