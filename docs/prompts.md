# Prompts & roles

Every role is an Opus call through the `Provider`. Templates live in `prompts/<role>.md`, are versioned (`prompts/VERSION`), and the version is stored with every artifact so caches invalidate when prompts change.

**Ordering rule (for caching):** static role instructions, then the render contract / kit reference, then the run-stable context (brief, trend report, taste memo), then volatile content (candidates, critiques, notes).

## Shared: Thumbnail Craft Canon

This is injected into Direct, Build and Evaluate. It's a compact list of principles the model must apply and the judge must score against:

1. **One idea, readable in 0.3s.** One focal point; at most 3 visual elements.
2. **Text ≤ 4 words**, huge and high-contrast. It **complements** the title and never repeats it.
3. **Design for 168×94 first.** If it doesn't read at mobile sidebar size, it doesn't work.
4. **Contrast is king**: value contrast between subject and background, saturated accents, and depth through rim light, shadow and blur.
5. **Curiosity gap**: show the *stakes* or the *moment before*, not the answer.
6. **Emotion is visible**: exaggerated expressions on characters, dramatic scale, danger, wonder.
7. **Stand out from the feed**: avoid the niche's saturated palette and layout unless the strategy is "proven".
8. **Keep the bottom-right clear** (the timestamp overlay).
9. **Brand consistency** with the video's visual style (from the brief) and the channel memo.

## Render contract (Builder + Repair system prompt core)

```
You write ONE self-contained HTML document that renders a YouTube thumbnail.

CANVAS     <div id="thumb"> exactly 1280×720 CSS px, overflow:hidden. Body margin 0.
ASSETS     Only local kit assets:
           <link rel="stylesheet" href="/kit/kit.css">  <script src="/kit/kit.js"></script>
           Fonts: {{FONT_LIST}}   (font-family names exactly as listed)
           Icons: /kit/icons/{lucide|phosphor|twemoji}/<name>.svg  (catalog: {{ICON_INDEX_URL}})
           No other network requests; they are blocked and will fail lint.
KIT        CSS classes: {{KIT_CSS_SUMMARY}}   JS: {{KIT_JS_API}}  (faces, characters, arrows, bursts…)
TECH       Any HTML/CSS/SVG/Canvas/JS. Deterministic: no Math.random without kit.seed(), no time.
READY      When drawing completes, set window.__NAILSTAR_READY__ = true (2s budget).
SAFE ZONE  Keep important content out of the bottom-right 180×60 px.
LEGIBILITY Headline cap-height ≥ 7% of canvas height (≥ 50px). Strong stroke or shadow behind text.
OUTPUT     JSON: {"html": "<!doctype html>…", "notes": "what you did, ≤ 50 words"}
```

## Roles

### `ingest` → `VideoBrief`
- **In:** contact sheets (images), script, initial title, palette, channel memo.
- **Task:** understand what the video *promises* and *feels like*. Describe subjects so precisely they can be **redrawn in SVG** (shape language, colours, signature features). Propose search queries for similar and adjacent niches.
- **Out:** `VideoBrief` (see PLAN §3.1).

### `tag` → per-thumbnail tags
- **In:** a labelled contact sheet (index → video ID mapping in text) plus titles.
- **Task:** extract structured tags only. No opinions.
- **Out:** `{ items: [{ videoId, archetype, focalType, textWords, wordCount, typeStyle, colorScheme, hueFamily, curiosityDevice[], emotion, background, titleRelation }] }`

### `synthesize` → `TrendReport`
- **In:** tags, deterministic features, titles, outlier scores, pool membership, windows (12mo vs 30d), channel memo.
- **Task:** separate **what wins** (over-represented in high outliers) from **what's merely common** (saturated). Find **rising** traits. Name **stealable** wildcard ideas. Every claim cites video IDs. Pick the 2 anchors.
- **Out:** `TrendReport` (PLAN §3.3).

### `direct` → `DesignBrief` + 3 genomes
- **In:** brief, trend report, taste memo, craft canon, kit summary (what's drawable), initial title.
- **Task:**
  - Write the north star (the 0.3s message and the feeling).
  - Produce 3 **divergent** genomes, one per strategy (proven / steal / contrarian).
  - Generate title variants. At least one genome keeps the initial title verbatim.
  - Prefer subjects that the kit can draw well.
- **Out:** `{ designBrief, genomes: [Genome×3] }`

### `build` → HTML
- **In:** render contract, craft canon, design brief, genome, and for micro-mutations the parent HTML + instruction.
- **Prompt shape (expressive by design):** the genome is restated as an **art-direction paragraph** (mood, light source, depth layers, motion, texture) followed by the precise spec. This gives the model both the vibe and the constraints. Micro-mutations say "change only what the instruction requires; preserve everything else".
- **Out:** `{ html, notes }`

### `repair` → HTML
- **In:** render contract, previous HTML, lint report (machine-readable), and its own render (image).
- **Out:** `{ html, notes }`

### `evaluate` → scores + critiques + plan
- **In:** for each candidate, its full and mobile renders plus its feed composites (light/dark); 2 anchors with known outlier percentiles; design brief; trend summary; genomes; previous critiques; human notes; rubric with weights; operator catalogue; generation number and phase (explore/exploit).
- **Rules:**
  - Judge **comparatively and against anchors**.
  - Write the rationale *before* the scores.
  - Penalise text that repeats the title.
  - Score mobile glanceability from the **168px** render only.
  - Honour human notes as hard requirements.
- **Out:**
```jsonc
{
  "candidates": [{
    "id": "g3c1",
    "rationale": "…",
    "scores": { "glanceability": 8, "focalClarity": 9, "curiosityGap": 7, "titleSynergy": 8, "emotionalPull": 7, "feedStandout": 9, "nicheFit": 8, "craft": 7 },
    "total": 7.95,                         // recomputed by nailstar from weights; the model's value is ignored
    "topFixes": ["…", "…", "…"]
  }],
  "plan": [{ "slot": 1, "operator": "refine", "parents": ["g3c1"], "instruction": "…", "titleChange": null }]
}
```

### `memo` → channel taste memo
- **In:** the previous memo, new ratings + notes (with candidate genomes), optional CTR outcomes.
- **Task:** fold the new evidence into **≤ 400 words** of durable preferences, separating "confirmed" from "tentative". Drop contradicted beliefs.
- **Out:** `{ memo, changes[] }`

## Default rubric weights

| Dimension | Weight |
|---|---|
| glanceability | 0.20 |
| focalClarity | 0.15 |
| curiosityGap | 0.15 |
| feedStandout | 0.15 |
| titleSynergy | 0.10 |
| emotionalPull | 0.10 |
| nicheFit | 0.075 |
| craft | 0.075 |

Per-channel weights are replaced gradually by CTR calibration (see `docs/youtube.md`).
