// Builds an A-vs-B comparison sheet: each genome as a row, full-size render (scaled to 560px) plus the
// 168×94 mobile size for each variant. Run: bun spikes/render/compare.ts A-medium B-medium  (render suffixes)
import { chromium } from "playwright";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const [va = "A-medium", vb = "B-medium"] = process.argv.slice(2);
const LABEL: Record<string, string> = { A: "freehand SVG", B: "draft kit" };
const label = (t: string) => `${t}: ${LABEL[t.split("-")[0]] ?? ""}, effort ${t.split("-")[1]}`;
const dir = join(import.meta.dir, "renders");
const ids = readdirSync(join(import.meta.dir, "genomes")).filter((f) => f.endsWith(".json")).sort().map((f) => f.replace(".json", ""));
const img = (name: string, w: number) => {
  const p = join(dir, `${name}.png`);
  return `<img src="data:image/png;base64,${Buffer.from(require("node:fs").readFileSync(p)).toString("base64")}" width="${w}">`;
};
const rows = ids.map((id) => `<tr><th>${id}</th>
  <td>${img(`${id}-${va}`, 560)}</td><td class="m">${img(`${id}-${va}`, 168)}</td>
  <td>${img(`${id}-${vb}`, 560)}</td><td class="m">${img(`${id}-${vb}`, 168)}</td></tr>`).join("");
const html = `<html><body style="margin:0;background:#181818;color:#eee;font:600 18px system-ui">
  <table cellspacing="12"><tr><th></th><th colspan="2">${label(va)}</th><th colspan="2">${label(vb)}</th></tr>${rows}</table>
  <style>th{text-align:left;padding:4px} td.m{vertical-align:top} img{display:block;border-radius:6px}</style></body></html>`;
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1600, height: 400 } });
await page.setContent(html);
const out = join(dir, `compare-${va}-vs-${vb}.png`); // committed copies are converted to .jpg
await page.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out);
