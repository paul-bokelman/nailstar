// Spike renderer: persistent Chromium, fresh context per candidate, /kit served via request
// interception, every other request blocked. Screenshots #thumb at 1280×720 and reports basic lint.
// CLI: bun spikes/render/renderer.ts <file.html> [out.png]
import { chromium, type Browser } from "playwright";
import { join } from "node:path";

const KIT_DIR = join(import.meta.dir, "kit");
const ORIGIN = "http://nailstar.local";
const ICONS_DIR = join(import.meta.dir, "..", "node_modules", "lucide-static", "icons");

const TYPES: Record<string, string> = { css: "text/css", js: "text/javascript", ttf: "font/ttf", svg: "image/svg+xml", png: "image/png" };

export interface RenderReport {
  ms: number;
  readyFlag: boolean;
  consoleErrors: string[];
  blockedRequests: string[];
  missingAssets: string[];
  lint: { textOutOfCanvas: string[]; minHeadlinePx: number | null; safeZoneHits: string[] };
}

// Cache the launch *promise*: `browser ??= await launch()` races when 3 workers render at once and
// leaks extra Chromium instances (found in this spike; the process then never exits).
let browser: Promise<Browser> | null = null;
export function getBrowser() {
  browser ??= chromium.launch();
  return browser;
}
export async function closeBrowser() {
  if (browser) await (await browser).close();
  browser = null;
}

export async function render(html: string, outPng: string): Promise<RenderReport> {
  const t0 = performance.now();
  const b = await getBrowser();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [], blockedRequests: string[] = [], missingAssets: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) { blockedRequests.push(url.href.slice(0, 120)); return route.abort(); }
    if (url.pathname === "/") return route.fulfill({ status: 200, contentType: "text/html", body: html });
    let file: string | null = null;
    if (url.pathname.startsWith("/kit/icons/lucide/")) file = join(ICONS_DIR, url.pathname.slice("/kit/icons/lucide/".length));
    else if (url.pathname.startsWith("/kit/")) file = join(KIT_DIR, url.pathname.slice(5));
    const f = file ? Bun.file(file) : null;
    if (!f || !(await f.exists())) { missingAssets.push(url.pathname); return route.fulfill({ status: 404, body: "" }); }
    const ext = url.pathname.split(".").pop() ?? "";
    return route.fulfill({ status: 200, contentType: TYPES[ext] ?? "application/octet-stream", body: Buffer.from(await f.arrayBuffer()) });
  });

  await page.goto(ORIGIN + "/", { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const readyFlag = await page
    .waitForFunction(() => (window as any).__NAILSTAR_READY__ === true, null, { timeout: 2000 })
    .then(() => true, () => false);

  const lint = await page.evaluate(() => {
    const thumb = document.querySelector("#thumb") ?? document.body;
    const tb = thumb.getBoundingClientRect();
    const out: string[] = [], safe: string[] = [];
    let maxFont = 0;
    const walker = document.createTreeWalker(thumb, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode as Text;
      const t = n.textContent?.trim();
      if (!t) continue;
      const el = n.parentElement!;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width === 0) continue;
      maxFont = Math.max(maxFont, parseFloat(cs.fontSize) || 0);
      if (r.left < tb.left - 1 || r.top < tb.top - 1 || r.right > tb.right + 1 || r.bottom > tb.bottom + 1) out.push(t.slice(0, 40));
      if (r.right > tb.right - 180 && r.bottom > tb.bottom - 60) safe.push(t.slice(0, 40));
    }
    return { textOutOfCanvas: out, minHeadlinePx: maxFont || null, safeZoneHits: safe };
  });

  const thumbEl = (await page.$("#thumb")) ?? undefined;
  if (thumbEl) await thumbEl.screenshot({ path: outPng });
  else await page.screenshot({ path: outPng, clip: { x: 0, y: 0, width: 1280, height: 720 } });
  await ctx.close();
  return { ms: Math.round(performance.now() - t0), readyFlag, consoleErrors, blockedRequests, missingAssets, lint };
}

if (import.meta.main) {
  const [file, out] = process.argv.slice(2);
  const rep = await render(await Bun.file(file).text(), out ?? file.replace(/\.html$/, ".png"));
  console.log(JSON.stringify(rep, null, 2));
  await closeBrowser();
}
