// P0.2: genomes → Opus Builder → HTML → Playwright PNG, in two variants:
//   A "freehand": no face/character helpers; Opus draws characters itself in SVG.
//   B "kit":      the draft kit.face / kit.character primitives are available.
// Run: bun spikes/render/build.ts [effort=medium] [variant=A,B]
import { z } from "zod";
import { readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { callClaude, summary } from "../provider/lib";
import { render, closeBrowser } from "./renderer";

const effort = (process.argv[2] ?? "medium") as "low" | "medium" | "high";
const variants = (process.argv[3] ?? "A,B").split(",");
const dir = import.meta.dir;
const outDir = join(dir, "renders");
mkdirSync(join(dir, "out"), { recursive: true });

const MARKS = "kit.arrow({from:[x,y],to:[x,y],color,width,curve}), kit.burst({cx,cy,r,points,text,font,fontSize,color,rotate}), " +
  "kit.circleMark({cx,cy,rx,ry,color,width}), kit.svg(innerMarkup,{width,height}) → full-canvas <svg>, kit.mount(selector, markup), kit.seed(n), kit.rand(), kit.ready(). All return SVG markup strings.";
const KIT_API: Record<string, string> = {
  A: MARKS + " There are NO face or character helpers: draw any characters or creatures yourself in inline SVG.",
  B: MARKS + `
           kit.face({emotion, x, y, size, look:[dx,dy], skin?, ink?}) → expressive cartoon face (features only unless skin is given).
             emotions: neutral, joy, shock, fear, sad, anger, determined, smug, curious, disgust, love
           kit.character({body, color, emotion, pose, x, y, size, accessories:[], look, flip, limbColor}) → full cartoon character with face.
             body: bean | blob | round | robot. pose: idle | arms-up | hands-cheeks | point-right | point-left | shrug | hold-up.
             accessories: helmet, crown, glasses, cap, hardhat, tie. x,y = top-left; size = height in px. Style: thick black outline, soft gradient shading.
           Use these for humanoid characters (you may add your own SVG props/clothing on top). Draw non-humanoid creatures yourself.`,
};

const Out = z.object({ html: z.string(), notes: z.string() });
const schema = z.toJSONSchema(Out, { target: "draft-7" });
const baseSystem = await Bun.file(join(dir, "build-system.md")).text();
const iso = ["--safe-mode", "--setting-sources", ""];

const genomes = readdirSync(join(dir, "genomes")).filter((f) => f.endsWith(".json")).sort();
const jobs = variants.flatMap((v) => genomes.map((g) => ({ v, g })));

// semaphore of 3, the plan's default pool size
let next = 0;
const results: any[] = [];
async function worker() {
  while (next < jobs.length) {
    const { v, g } = jobs[next++];
    const genome = await Bun.file(join(dir, "genomes", g)).text();
    const name = `${g.replace(".json", "")}-${v}-${effort}`;
    const t0 = performance.now();
    const r = await callClaude({
      system: baseSystem.replace("{{KIT_JS_API}}", KIT_API[v]),
      content: `Design brief north star: make a viewer feel the hook in 0.3s.\n\nGenome:\n${genome}\n\nBuild this thumbnail.`,
      schema, effort, extraArgs: iso, timeoutMs: 400_000,
    });
    const parsed = Out.safeParse(r.result?.structured_output);
    const row: any = { name, variant: v, genome: g, effort, llm: { ...summary(r), result: undefined }, buildMs: Math.round(performance.now() - t0) };
    if (parsed.success) {
      await Bun.write(join(outDir, `${name}.html`), parsed.data.html);
      row.notes = parsed.data.notes;
      row.render = await render(parsed.data.html, join(outDir, `${name}.png`));
    } else row.error = r.result?.result ?? r.stderr;
    results.push(row);
    console.log(JSON.stringify({ name, ok: parsed.success, wallMs: row.llm.wallMs, out: row.llm.out, renderMs: row.render?.ms, ready: row.render?.readyFlag, errs: row.render?.consoleErrors?.length, blocked: row.render?.blockedRequests, lint: row.render?.lint, rl: row.llm.rateLimit }));
  }
}
await Promise.all([worker(), worker(), worker()]);
await closeBrowser();
await Bun.write(join(dir, "out", `build-${effort}-${variants.join("")}.json`), JSON.stringify(results, null, 2));
