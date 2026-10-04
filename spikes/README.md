# Phase 0 spikes

Throwaway experiments that resolved the plan's "verify" notes (PLAN.md §6, Phase 0). Not production code; Phase 1+ starts fresh in `src/`. Run 2026-10-03 with Claude Code 2.1.289 / Opus 5.5.

```bash
cd spikes && bun install && bunx playwright install chromium   # once
```

| Spike | Run | Findings |
|---|---|---|
| P0.1 provider | `bun spikes/provider/01-isolation.ts` … `06-evaluate-timing.ts` (`make-fixtures.ts` first) | [`docs/provider.md`](../docs/provider.md) |
| P0.2 render | `bun spikes/render/build.ts <low\|medium> <A,B>` then `bun spikes/render/compare.ts A-medium B-medium` | below, plus PLAN §3.5 / R2 / §7 |
| P0.3 YouTube | `bun spikes/youtube/thumbs-nokey.ts` (no key); `bun spikes/youtube/spike.ts` (**needs `YOUTUBE_API_KEY` in `.env`, not run yet**) | [`docs/youtube.md`](../docs/youtube.md) |

Raw outputs go to `*/out/` (gitignored, since they contain account info). Individual render PNGs are gitignored; regenerate one with `bun spikes/render/renderer.ts spikes/render/renders/<name>.html`.

## P0.2 render findings

**Setup.** 5 hand-written genomes (`render/genomes/`), all character-heavy on purpose plus one non-humanoid creature. Each was built by Opus from the render contract + craft canon (`render/build-system.md`) in two variants:
- **A (freehand):** the kit has fonts, CSS effects and marks, but no face or character helpers.
- **B (kit):** the same, plus a draft `kit.face()` (11 emotions) and `kit.character()` (4 bodies × 7 poses, accessories). See `renders/kit-gallery.png`.

The A variant was built at `medium` and `low` effort; B at `medium`.

**Results.**

| | A medium | B medium | A low |
|---|---|---|---|
| Schema-valid HTML | 5/5 | 5/5 | 5/5 |
| Rendered cleanly (ready flag, no JS errors) | 5/5 | 4/5 (one `TypeError` mid-draw → near-empty scene) | 5/5 |
| Build time | 58–118 s | 42–81 s | **19–27 s** |
| Render time | 220–300 ms | 220–290 ms | 220–300 ms |

Sheets: `renders/compare-A-medium-vs-B-medium.jpg`, `renders/compare-A-medium-vs-A-low.jpg` (each row shows full size and 168×94 mobile).

**Judgement (eyeballed, one sample per cell).**
- **Code-drawn characters are viable.** Freehand output reads as clean flat-vector "animated explainer" art: consistent thick outlines, readable exaggerated expressions, and it holds up at 168 px. It isn't illustrator-grade: anatomy is simple and lighting mostly flat.
- **The kit made characters worse, not better.** With `kit.character` available, Opus used it as-is. Characters came out smaller and generic (the king/peasant pair became two blobs), and every niche converged on the same bean style. Freehand characters had more personality and matched the genome's description (robe, throne, tunic). The face kit's expressions were no clearer than Opus's own.
- **Failures were compositional, not drawing skill:** a coin placed between a character's eyes, headline text undersized with dead space, a dark creature that vanished into a dark background, a character covering part of the "97%". These are what the judge's critique → `refine` loop is for.
- **`low` effort ≈ `medium` quality.** Low-effort builds were often bolder (bigger subjects and text, which helps mobile), with slightly less detail (a box throne instead of an ornate one). At ~⅓ the time it's the better default inside an evolutionary loop.

**Decision → PLAN §3.5 / R2.** Drop `kit.character` and the face kit. Keep fonts, CSS effects, marks (arrow, burst, circle) and overlays, all of which got used. Add reusable lighting/shading SVG `<defs>` and a short character style guide in the Builder prompt.

**Renderer notes for Phase 5.**
- Serve the page via request interception on a fake origin; `setContent` can't resolve `/kit/…`.
- Cache the browser *launch promise*. The lazily awaited singleton raced under 3 parallel renders, leaked Chromium instances, and kept the process alive.
- Text-bounds lint needs ink-based measurement: a tall line box flagged a headline whose glyphs were well inside the canvas.

**Font licences.** Anton, Bebas Neue, Archivo Black, Bangers, Titan One are OFL; Luckiest Guy and Permanent Marker are Apache-2.0 (both permit bundling).
