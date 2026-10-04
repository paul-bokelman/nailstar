// P0.1 (extra): latency + token cost of a realistic Evaluate call — 3 candidates at full size and
// 168px mobile size (6 images), effort=high, judge+planner schema. Also measures per-image tokens
// for a 1280×720 PNG. Requires the P0.2 renders. Run: bun spikes/provider/06-evaluate-timing.ts
import { z } from "zod";
import { $ } from "bun";
import { callClaude, summary } from "./lib";

const renders = `${import.meta.dir}/../render/renders`;
const ids = ["1-moon-A-low", "2-savings-A-low", "3-king-A-low"];
const tmp = `${import.meta.dir}/out/eval-mobile`;
await $`mkdir -p ${tmp}`;
for (const id of ids) await $`sips -z 94 168 ${renders}/${id}.png --out ${tmp}/${id}.png`.quiet();

const Dim = z.number().min(0).max(10);
const Judge = z.object({
  candidates: z.array(z.object({
    id: z.string(),
    rationale: z.string(),
    scores: z.object({ glanceability: Dim, focalClarity: Dim, curiosityGap: Dim, titleSynergy: Dim, emotionalPull: Dim, feedStandout: Dim, nicheFit: Dim, craft: Dim }),
    topFixes: z.array(z.string()).max(3),
  })),
  plan: z.array(z.object({ slot: z.number().int(), operator: z.string(), parents: z.array(z.string()), instruction: z.string() })),
});
const schema = z.toJSONSchema(Judge, { target: "draft-7" });

const titles: Record<string, string> = {
  "1-moon-A-low": "The Moon Is Slowly Breaking Apart",
  "2-savings-A-low": "Why Your Savings Are Quietly Disappearing",
  "3-king-A-low": "The Worst King Who Ever Lived",
};
const content: any[] = [];
for (const id of ids) {
  content.push({ type: "text", text: `Candidate ${id} — title: "${titles[id]}". Full size:` });
  content.push({ type: "image", path: `${renders}/${id}.png` });
  content.push({ type: "text", text: `Candidate ${id} at 168×94 mobile size:` });
  content.push({ type: "image", path: `${tmp}/${id}.png` });
}
content.push({ type: "text", text: "Judge these three thumbnails comparatively (they are unrelated videos; treat as a calibration exercise). Rationale before scores. Then plan 2 next-generation children using operators refine | text-swap | palette-shift | emphasis | simplify | layout-swap | crossover." });

const system = "You are the nailstar Evaluator: a strict YouTube thumbnail judge and evolution planner. Score glanceability only from the 168px render.";
const iso = ["--safe-mode", "--setting-sources", ""];

const out: Record<string, any> = {};
// per-image token cost: 1 full-size image vs text only
const one = await callClaude({ system, content: [{ type: "image", path: `${renders}/${ids[0]}.png` }, { type: "text", text: "Reply: ok" }], extraArgs: iso, effort: "low" });
const none = await callClaude({ system, content: "Reply: ok", extraArgs: iso, effort: "low" });
const tot = (r: any) => (r.result?.usage?.input_tokens ?? 0) + (r.result?.usage?.cache_creation_input_tokens ?? 0) + (r.result?.usage?.cache_read_input_tokens ?? 0);
out.tokensPer1280x720Png = tot(one) - tot(none);
console.log("tokensPer1280x720Png", out.tokensPer1280x720Png);

for (const effort of ["high", "medium"] as const) {
  const r = await callClaude({ system, content, schema, extraArgs: iso, effort, timeoutMs: 400_000 });
  const parsed = Judge.safeParse(r.result?.structured_output);
  out[`evaluate_${effort}`] = { ...summary(r), result: undefined, zodOk: parsed.success, scores: parsed.success ? parsed.data.candidates.map((c) => ({ id: c.id, ...c.scores })) : r.result?.result };
  console.log(`evaluate_${effort}`, JSON.stringify(out[`evaluate_${effort}`]));
}
await Bun.write(`${import.meta.dir}/out/06-evaluate-timing.json`, JSON.stringify(out, null, 2));
