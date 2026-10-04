// P0.3 (no API key needed): which thumbnail variants exist on i.ytimg.com, and at what size?
// Video IDs come from each channel's public /videos tab (long-form uploads only; the RSS feed
// endpoint returned 404 for most channels during the spike, so it isn't used).
// Run: bun spikes/youtube/thumbs-nokey.ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const HANDLES = ["kurzgesagt", "veritasium", "MrBeast", "SimpleHistory", "TheInfographicsShow", "OverSimplified", "TwoMinutePapers", "Fireship", "TheMoneyGuy", "sciencewithkatie"];
const VARIANTS = ["maxresdefault", "hq720", "sddefault", "hqdefault"];

async function videoIds(handle: string) {
  const html = await (await fetch(`https://www.youtube.com/@${handle}/videos`, { headers: { "accept-language": "en" } })).text();
  return [...new Set([...html.matchAll(/"videoId":"([\w-]{11})"/g)].map((m) => m[1]))].slice(0, 15);
}

function jpegSize(buf: Uint8Array) {
  // scan for SOF0/SOF2 marker to read dimensions
  for (let i = 2; i < buf.length - 9; ) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xc0 || m === 0xc2) return `${(buf[i + 7] << 8) | buf[i + 8]}x${(buf[i + 5] << 8) | buf[i + 6]}`;
    i += 2 + ((buf[i + 2] << 8) | buf[i + 3]);
  }
  return "?";
}

const rows: any[] = [];
for (const h of HANDLES) {
  const ids = await videoIds(h).catch(() => [] as string[]);
  for (const id of ids) {
    const row: any = { handle: h, id, short: false };
    for (const v of VARIANTS) {
      const res = await fetch(`https://i.ytimg.com/vi/${id}/${v}.jpg`);
      const buf = new Uint8Array(await res.arrayBuffer());
      row[v] = res.status === 200 ? jpegSize(buf) : res.status;
    }
    rows.push(row);
  }
  console.log(`@${h}: ${ids.length} videos`);
}

const longform = rows.filter((r) => !r.short);
const summary = {
  videos: rows.length, longform: longform.length, shorts: rows.length - longform.length,
  longformAvailability: Object.fromEntries(VARIANTS.map((v) => [v, longform.filter((r) => typeof r[v] === "string").length])),
  sizes: Object.fromEntries(VARIANTS.map((v) => [v, [...new Set(rows.map((r) => r[v]))]])),
  longformMissingMaxres: longform.filter((r) => typeof r.maxresdefault !== "string").map((r) => ({ handle: r.handle, id: r.id, hq720: r.hq720 })),
};
console.log(JSON.stringify(summary, null, 2));
mkdirSync(join(import.meta.dir, "out"), { recursive: true });
await Bun.write(join(import.meta.dir, "out", "thumbs-nokey.json"), JSON.stringify({ summary, rows }, null, 2));
