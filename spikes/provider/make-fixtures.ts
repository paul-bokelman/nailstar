// Renders probe images with known, unguessable content so we can tell whether the model really saw them.
// Run: bun spikes/provider/make-fixtures.ts
import { chromium } from "playwright";

const dir = `${import.meta.dir}/fixtures`;
const probes = [
  { file: "probe-a.png", code: "ZEPHYR-4417", shape: "three red circles", w: 1536, h: 864 },
  { file: "probe-b.png", code: "MARLIN-0932", shape: "two green triangles", w: 1536, h: 864 },
];

const browser = await chromium.launch();
for (const p of probes) {
  const page = await browser.newPage({ viewport: { width: p.w, height: p.h } });
  const shapes = p.shape.includes("circle")
    ? [200, 500, 800].map((x) => `<circle cx="${x}" cy="650" r="90" fill="#e11"/>`).join("")
    : [300, 900].map((x) => `<polygon points="${x},560 ${x + 120},760 ${x - 120},760" fill="#1b2"/>`).join("");
  await page.setContent(`<body style="margin:0;background:#1b2a4a">
    <svg width="${p.w}" height="${p.h}">${shapes}
      <text x="50%" y="320" text-anchor="middle" font-family="Arial" font-size="130" font-weight="bold" fill="#fff">${p.code}</text>
    </svg></body>`);
  await page.screenshot({ path: `${dir}/${p.file}` });
  await page.close();
}
await browser.close();
await Bun.write(`${dir}/probes.json`, JSON.stringify(probes, null, 2));
console.log("ok");
