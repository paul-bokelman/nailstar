// P0.3: real YouTube Data API v3 queries for 3 niches, following docs/youtube.md:
//   - quota actually used vs the ~800-unit cold-run target (every call is metered). Since the 2026
//     quota change, search.list has its OWN bucket (100 calls/day, 1 per call) separate from the
//     10,000-unit bucket shared by every other endpoint, so both buckets are reported.
//   - outlier score distribution (views / channel median, age-adjusted) incl. low-confidence share
//   - thumbnail availability: maxres vs standard vs high (from snippet.thumbnails, no extra quota),
//     plus HEAD checks of maxresdefault/hq720 on i.ytimg.com (no quota)
//
// Needs YOUTUBE_API_KEY (Bun loads .env automatically).
// Run:   bun spikes/youtube/spike.ts                 # all 3 niches
//        bun spikes/youtube/spike.ts --niche space   # one niche
//        bun spikes/youtube/spike.ts --max-baselines 40
// Writes spikes/youtube/out/<niche>.json and prints a summary per niche.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const KEY = process.env.YOUTUBE_API_KEY;
if (!KEY) {
  console.error("YOUTUBE_API_KEY is not set. Put YOUTUBE_API_KEY=... in .env (gitignored) and rerun.");
  process.exit(5); // dependency missing (docs/cli.md)
}

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};
// Baselines draw on the 10k-unit bucket (2 units each), which is nearly idle since search moved to its own bucket: default to all channels.
const MAX_BASELINES = Number(arg("max-baselines", "1000"));
const ONLY = arg("niche", "");
const REGION = arg("region", "US");

// Three deliberately different niches (sizes, formats, audiences). 3 similar queries × 2 windows + 1 adjacent = 7 searches.
const NICHES: Record<string, { similar: string[]; adjacent: string[]; categoryId: string }> = {
  space: { similar: ["moon breaking apart", "space facts explained", "what if the sun disappeared"], adjacent: ["deep sea creatures"], categoryId: "28" },
  finance: { similar: ["inflation explained animated", "why you are always broke", "how to save money fast"], adjacent: ["side hustle ideas"], categoryId: "27" },
  history: { similar: ["worst kings in history", "medieval life explained", "history animated documentary"], adjacent: ["mythology explained"], categoryId: "27" },
};

// bucket "search": search.list calls (100/day default). bucket "units": everything else (10,000/day).
const BUCKET = (endpoint: string) => (endpoint === "search" ? "search" : "units");
const ledger: { endpoint: string; bucket: string; units: number; params: string }[] = [];

async function yt(endpoint: string, params: Record<string, string>) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", KEY!);
  ledger.push({ endpoint, bucket: BUCKET(endpoint), units: 1, params: JSON.stringify(params) });
  const res = await fetch(url);
  const body: any = await res.json();
  if (!res.ok) {
    // capture quota/permission error shapes for docs (reason: quotaExceeded, keyInvalid, accessNotConfigured…)
    const reason = body?.error?.errors?.[0]?.reason;
    throw Object.assign(new Error(`${endpoint} ${res.status} ${reason}: ${body?.error?.message}`), { status: res.status, reason, body });
  }
  return body;
}

const DAY = 86_400_000;
const now = Date.now();
const iso8601ToSec = (d: string) => {
  const m = d.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + (+(m[4] ?? 0));
};
const isShort = (v: any) => iso8601ToSec(v.contentDetails?.duration ?? "PT0S") <= 180 || /#shorts?\b/i.test(v.snippet?.title ?? "");
const ageDays = (v: any) => (now - Date.parse(v.snippet.publishedAt)) / DAY;
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (xs: number[], p: number) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function videosById(ids: string[]) {
  const out: any[] = [];
  for (const c of chunk(ids, 50)) out.push(...(await yt("videos", { part: "snippet,statistics,contentDetails", id: c.join(","), maxResults: "50" })).items);
  return out;
}

async function runNiche(name: string, n: (typeof NICHES)[string]) {
  const start = ledger.length;
  const windows = { "12mo": new Date(now - 365 * DAY).toISOString(), "30d": new Date(now - 30 * DAY).toISOString() };
  const hits = new Map<string, Set<string>>(); // videoId -> sources

  // 1) search: similar × windows, adjacent × 12mo
  const searches: { q: string; window: string; pool: string }[] = [
    ...n.similar.flatMap((q) => Object.keys(windows).map((w) => ({ q, window: w, pool: "similar" }))),
    ...n.adjacent.map((q) => ({ q, window: "12mo", pool: "adjacent" })),
  ];
  for (const s of searches) {
    const r = await yt("search", {
      part: "id", type: "video", q: s.q, order: "viewCount", maxResults: "50",
      publishedAfter: windows[s.window as keyof typeof windows], relevanceLanguage: "en", regionCode: REGION,
    });
    for (const it of r.items) {
      const id = it.id.videoId;
      if (!hits.has(id)) hits.set(id, new Set());
      hits.get(id)!.add(`${s.pool}:${s.window}`);
    }
  }

  // 2) video details; filter shorts and too-young videos
  const all = await videosById([...hits.keys()]);
  const shorts = all.filter(isShort);
  const longform = all.filter((v) => !isShort(v) && ageDays(v) >= 3);

  // 3) channels
  const channelIds = [...new Set(longform.map((v) => v.snippet.channelId))];
  const channels = new Map<string, any>();
  for (const c of chunk(channelIds, 50))
    for (const ch of (await yt("channels", { part: "statistics,contentDetails", id: c.join(",") })).items) channels.set(ch.id, ch);

  // 4) baselines: highest-views/subscriber candidates first, capped (each baseline = playlistItems + videos = 2 units)
  const subs = (cid: string) => Number(channels.get(cid)?.statistics?.subscriberCount ?? 0);
  const rankedChannels = [...new Set(
    longform.slice().sort((a, b) => Number(b.statistics.viewCount) / Math.max(1, subs(b.snippet.channelId)) - Number(a.statistics.viewCount) / Math.max(1, subs(a.snippet.channelId))).map((v) => v.snippet.channelId),
  )];
  const baselines = new Map<string, { median: number; n: number }>();
  for (const cid of rankedChannels.slice(0, MAX_BASELINES)) {
    const uploads = channels.get(cid)?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) continue;
    try {
      const pl = await yt("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: "50" });
      const vids = await videosById(pl.items.map((i: any) => i.contentDetails.videoId));
      const eligible = vids.filter((v) => !isShort(v) && ageDays(v) >= 7 && ageDays(v) <= 365).slice(0, 30);
      baselines.set(cid, { median: median(eligible.map((v) => Number(v.statistics.viewCount ?? 0))), n: eligible.length });
    } catch (e: any) {
      baselines.set(cid, { median: NaN, n: 0 });
    }
  }

  // 5) outlier scores
  const scored = longform.map((v) => {
    const views = Number(v.statistics.viewCount ?? 0);
    const b = baselines.get(v.snippet.channelId);
    const age = ageDays(v);
    const ageFactor = Math.min(1, Math.pow(age / 28, 0.6));
    let outlier: number | null = null, basis = "none";
    if (b && b.n >= 5 && b.median > 0) { outlier = views / (b.median * ageFactor); basis = "median"; }
    else if (subs(v.snippet.channelId) > 0) { outlier = views / (subs(v.snippet.channelId) * 0.1 * ageFactor); basis = "subsFallback"; }
    const th = v.snippet.thumbnails ?? {};
    return {
      id: v.id, title: v.snippet.title, channelId: v.snippet.channelId, views, ageDays: Math.round(age), durationSec: iso8601ToSec(v.contentDetails.duration),
      sources: [...(hits.get(v.id) ?? [])], categoryId: v.snippet.categoryId, outlier, log2: outlier ? Math.log2(outlier) : null, basis,
      thumbs: { maxres: !!th.maxres, standard: !!th.standard, high: !!th.high, maxresSize: th.maxres ? `${th.maxres.width}x${th.maxres.height}` : null },
    };
  });

  // 6) global top performers in the niche's category (1 unit)
  let mostPopular: any[] = [];
  try {
    mostPopular = (await yt("videos", { part: "snippet,statistics,contentDetails", chart: "mostPopular", videoCategoryId: n.categoryId, regionCode: REGION, maxResults: "10" })).items
      .map((v: any) => ({ id: v.id, title: v.snippet.title, views: Number(v.statistics.viewCount), short: isShort(v) }));
  } catch (e: any) { mostPopular = [{ error: e.message }]; }

  // 7) thumbnail HEAD checks on i.ytimg.com (no quota): maxresdefault vs hq720 for a 40-video sample
  const sample = scored.slice(0, 40);
  const head = async (u: string) => (await fetch(u, { method: "HEAD" })).status;
  const cdn = await Promise.all(sample.map(async (s) => ({
    id: s.id, apiMaxres: s.thumbs.maxres,
    maxresdefault: await head(`https://i.ytimg.com/vi/${s.id}/maxresdefault.jpg`),
    hq720: await head(`https://i.ytimg.com/vi/${s.id}/hq720.jpg`),
  })));

  // summary
  const searchCalls = ledger.slice(start).filter((l) => l.bucket === "search").length;
  const units = ledger.slice(start).filter((l) => l.bucket === "units").reduce((a, l) => a + l.units, 0);
  const legacyUnits = searchCalls * 100 + units; // what the pre-2026 model (search = 100 units) would have charged
  const byEndpoint = ledger.slice(start).reduce((a: any, l) => ((a[l.endpoint] = (a[l.endpoint] ?? 0) + l.units), a), {});
  const o = scored.filter((s) => s.outlier !== null).map((s) => s.outlier!);
  const oMedianBasis = scored.filter((s) => s.basis === "median").map((s) => s.outlier!);
  const summary = {
    niche: name,
    quota: { searchCalls, units, legacyUnits, byEndpoint, searches: searches.length, baselinesComputed: baselines.size, channelsSeen: channelIds.length },
    counts: { searchHits: hits.size, shortsDropped: shorts.length, longform: longform.length, scored: o.length, lowConfidence: scored.filter((s) => s.basis === "subsFallback").length, unscored: scored.filter((s) => s.basis === "none").length },
    outlier: o.length ? { p10: pct(o, 0.1), p25: pct(o, 0.25), p50: pct(o, 0.5), p75: pct(o, 0.75), p90: pct(o, 0.9), p99: pct(o, 0.99), max: Math.max(...o), over2x: o.filter((x) => x > 2).length, over5x: o.filter((x) => x > 5).length, over10x: o.filter((x) => x > 10).length } : null,
    outlierMedianBasisOnly: oMedianBasis.length ? { n: oMedianBasis.length, p50: pct(oMedianBasis, 0.5), p90: pct(oMedianBasis, 0.9), over5x: oMedianBasis.filter((x) => x > 5).length } : null,
    // Aug 27 2026: YouTube began counting long-form views from the first frame (incl. autoplay). If counts
    // aren't restated, newer uploads look like outliers vs older baselines. Compare medians either side.
    viewCountChange: (() => {
      const cut = Date.parse("2026-08-27T00:00:00Z");
      const pub = (id: string) => Date.parse(longform.find((v) => v.id === id)!.snippet.publishedAt);
      const med = scored.filter((x) => x.basis === "median");
      const after = med.filter((x) => pub(x.id) >= cut).map((x) => x.outlier!), before = med.filter((x) => pub(x.id) < cut).map((x) => x.outlier!);
      return { nAfter: after.length, p50After: after.length ? pct(after, 0.5) : null, nBefore: before.length, p50Before: before.length ? pct(before, 0.5) : null };
    })(),
    window30dLongform: scored.filter((s) => s.sources.some((x) => x.endsWith(":30d"))).length,
    thumbs: { apiMaxres: scored.filter((s) => s.thumbs.maxres).length, apiStandard: scored.filter((s) => s.thumbs.standard).length, total: scored.length, maxresSizes: [...new Set(scored.map((s) => s.thumbs.maxresSize).filter(Boolean))] },
    cdnSample: { n: cdn.length, maxres200: cdn.filter((c) => c.maxresdefault === 200).length, hq720_200: cdn.filter((c) => c.hq720 === 200).length, apiAgreesWithCdn: cdn.filter((c) => c.apiMaxres === (c.maxresdefault === 200)).length },
    categories: scored.reduce((a: any, s) => ((a[s.categoryId] = (a[s.categoryId] ?? 0) + 1), a), {}),
    top10: scored.filter((s) => s.outlier).sort((a, b) => b.outlier! - a.outlier!).slice(0, 10).map((s) => ({ id: s.id, outlier: +s.outlier!.toFixed(1), basis: s.basis, views: s.views, ageDays: s.ageDays, title: s.title.slice(0, 70) })),
    mostPopular,
  };
  mkdirSync(join(import.meta.dir, "out"), { recursive: true });
  await Bun.write(join(import.meta.dir, "out", `${name}.json`), JSON.stringify({ summary, scored, baselines: Object.fromEntries(baselines), cdn, ledger: ledger.slice(start) }, null, 2));
  return summary;
}

const results: any[] = [];
for (const [name, n] of Object.entries(NICHES)) {
  if (ONLY && ONLY !== name) continue;
  try {
    const s = await runNiche(name, n);
    results.push(s);
    console.log(JSON.stringify(s, null, 2));
  } catch (e: any) {
    console.error(`niche ${name} failed:`, e.message, JSON.stringify(e.body ?? {}).slice(0, 600));
    if (e.reason === "quotaExceeded") break;
  }
}
console.log("TOTAL search calls:", ledger.filter((l) => l.bucket === "search").length, "| other units:", ledger.filter((l) => l.bucket === "units").length);
