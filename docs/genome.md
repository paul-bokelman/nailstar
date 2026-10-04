# Genome, operators & selection

The **genome** is a structured design spec. The **phenotype** is the HTML the Builder writes from it. Evolution reasons over genomes (cheap to diff, compare and recombine). Micro-mutations also carry the parent HTML so good details survive.

## Genome schema (v1)

```jsonc
{
  "id": "g3c1",
  "parents": ["g2c0"],
  "operator": "refine",            // how it was born (see operators)
  "strategy": "proven",            // proven | steal | contrarian (inherited lineage tag)
  "concept": "Tiny astronaut dwarfed by a cracked, glowing moon",   // one-line idea
  "hook": "scale + danger",        // curiosity device in words

  "title": "The Moon Is Slowly Breaking Apart",
  "titleRelation": "complement",   // repeat | complement | tease

  "layout": {
    "archetype": "subject-right-text-left",  // see archetypes
    "focalPoint": { "x": 0.68, "y": 0.45 },  // normalized
    "depth": "foreground-subject + midground-object + gradient-bg"
  },
  "subjects": [
    { "kind": "character", "description": "round-helmet astronaut, oversized visor reflecting red", "emotion": "shock", "scale": 0.35, "drawWith": "kit.character + kit.face(shock)" },
    { "kind": "object", "description": "moon with glowing magma crack", "scale": 0.8 }
  ],
  "text": {
    "words": "IT'S CRACKING",
    "maxWords": 3,
    "font": "Anton",
    "treatment": "white fill, 10px black stroke, hard drop shadow, slight -4° tilt",
    "sizeRatio": 0.22,              // cap-height ÷ canvas height
    "position": "top-left"
  },
  "palette": { "bg": ["#0b0f2a", "#3a0d4f"], "accent": "#ff4d1a", "text": "#ffffff", "contrastStrategy": "warm-on-cool" },
  "background": "deep-space radial gradient, faint stars, subtle grain",
  "accents": ["red glow on crack", "thin white arrow from text to crack"],
  "effects": ["vignette", "rim-light on subject"],
  "emotion": "awe + dread",
  "borrowedFrom": ["yt:abc123"],   // reference ids whose traits were used (traceability)
  "humanNotes": ["bigger text"]    // carried forward until satisfied
}
```

**Layout archetypes** (an enum the judge can reason about): `subject-right-text-left`, `subject-left-text-right`, `center-subject-text-top`, `split-before-after`, `vs-split`, `big-number`, `object-closeup`, `scene-wide-small-subject`, `text-dominant`, `collage-3`, `pov`, `minimal-icon`.

**Genome distance** is a weighted Hamming/Jaccard distance over archetype, palette hue family, font, text words, subject kinds, strategy and hook. It drives the diversity guard and elitism tie-breaks.

## Operators

| Operator | Scale | Input to Builder | Typical trigger |
|---|---|---|---|
| `refine` | micro | parent HTML + the judge's top-3 fixes | good candidate, specific flaws |
| `text-swap` | micro | parent HTML + new words / treatment | text weak, too long, or repeats the title |
| `palette-shift` | micro | parent HTML + new palette | blends into feed (low standout) |
| `emphasis` | micro | parent HTML + "scale X up, simplify Y" | low glanceability at mobile size |
| `simplify` | micro | parent HTML + elements to remove | clutter |
| `title-mutate` | micro | none (no rebuild unless text depends on title) | weak title synergy |
| `layout-swap` | macro | genome with a new archetype → full rebuild | composition is the problem |
| `focal-swap` | macro | genome with a different primary subject | subject is unclear or undrawable |
| `wildcard-inject` | macro | genome + one trait from a wildcard reference | stagnation, low novelty |
| `crossover` | macro | two parent genomes → planner picks traits from each (e.g. A's layout + B's text and palette) | two good candidates with complementary strengths |
| `fresh` | macro | new genome from a different strategy | diversity guard, "kill" leaves a gap |
| `more-like-this` | macro | human-boosted parent, varied on one axis | human request |

The **planner** (inside the Evaluate call) chooses an operator and a concrete instruction per open slot. Rules it's given:
- At least **one macro** per generation until gen 4, then mostly micro (explore → exploit).
- **Never** two children from the same operator and parent.
- **Human notes** are binding constraints on the affected lineage.
- A `title-mutate` can be combined with any other operator (the title is part of the genome).

## Selection

```
fitness(c) = judgeTotal(c) − lintPenalty(c)                               // 0–10
           → if human-rated: 0.5·judgeTotal + 0.5·(stars × 2)
kill  → removed, slot opens
boost → forced elite (counts toward the elite cap)

elite = top-1; plus #2 if (fit1 − fit2 ≤ 0.5) and distance(#1, #2) ≥ δ
fill  = 3 − |elite| children from the plan
diversity guard: any pair with distance < δ or pHash < 8 → the lower one is replaced by `fresh` or `wildcard-inject`
```

Elites are **not rebuilt**. They carry their render and score forward, and they're re-judged in the next generation alongside the children, because judging is comparative and anchored.

## Termination

| Condition | Default |
|---|---|
| Best fitness ≥ τ **and** approved at the last checkpoint (or `--review=none`) | τ = 8.5 |
| Max generations | 6 (`--max-gens`) |
| Compute time cap | 20 min (`--time-cap`) |
| Plateau | best Δ < 0.2 over 2 gens, only after gen 4 |

"Approved" means a human or agent rated the candidate ≥ 4 stars and didn't attach a blocking note. A final checkpoint at delivery lets the reviewer reorder or veto the top 3 (review modes `human` and `agent`).

## Delivery

The top 3 **distinct** candidates come from the whole run (the hall of fame, not just the last generation), by fitness with a distance check. Each is exported as:
- `N.png`: 1280×720, ≤ 2 MB (re-encoded to JPEG q≈90 if larger)
- `N.json`: title, genome, scores per dimension, lineage (ancestor chain with operators), critiques
- `report.html`: a static report with lineage tree, mock feeds and scores
