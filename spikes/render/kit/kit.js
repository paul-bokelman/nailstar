// nailstar draft render kit (P0.2 spike): deterministic SVG primitives for code-drawn subjects.
// Every function returns an SVG markup string. Wrap with kit.svg() or embed inside your own <svg>.
(function () {
  let _seed = 1;
  let _uid = 0;
  const uid = (p) => `${p}${++_uid}`;

  // ---------- colour helpers ----------
  function shade(hex, amt) {
    // amt in [-1, 1]: negative darkens, positive lightens
    const n = parseInt(hex.replace("#", ""), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // ---------- face ----------
  // Drawn in a 100×100 box centred on (0,0), then scaled to `size` and placed at (x,y).
  const BROWS = {
    neutral:    [[-27, -25, -9, -25], [9, -25, 27, -25]],
    joy:        [[-27, -27, -9, -31], [9, -31, 27, -27]],
    shock:      [[-28, -34, -9, -38], [9, -38, 28, -34]],
    fear:       [[-27, -24, -9, -33], [9, -33, 27, -24]],
    sad:        [[-27, -23, -9, -31], [9, -31, 27, -23]],
    anger:      [[-28, -31, -8, -21], [8, -21, 28, -31]],
    determined: [[-28, -29, -8, -23], [8, -23, 28, -29]],
    smug:       [[-27, -25, -9, -25], [9, -33, 27, -29]],
    curious:    [[-27, -25, -9, -25], [9, -35, 27, -31]],
    disgust:    [[-28, -27, -8, -22], [9, -27, 27, -30]],
    love:       [[-27, -28, -9, -31], [9, -31, 27, -28]],
  };

  function eyes(e, look, ink) {
    const [lx, ly] = look;
    const one = (cx) => {
      if (e === "joy" || e === "love")
        return e === "love"
          ? `<path d="M${cx} ${-2} c-7 -9 -16 -2 -9 6 l9 8 l9 -8 c7 -8 -2 -15 -9 -6z" fill="#ff2d55" stroke="${ink}" stroke-width="2"/>`
          : `<path d="M${cx - 9} -6 Q${cx} -18 ${cx + 9} -6" fill="none" stroke="${ink}" stroke-width="4.5" stroke-linecap="round"/>`;
      if (e === "determined" || e === "anger" || e === "smug") {
        // half-lidded: clip the top of the eye
        const id = uid("lid");
        const top = e === "smug" ? -4 : -7;
        return `<clipPath id="${id}"><rect x="${cx - 14}" y="${top}" width="28" height="30"/></clipPath>
          <g clip-path="url(#${id})"><ellipse cx="${cx}" cy="-6" rx="9" ry="11" fill="#fff" stroke="${ink}" stroke-width="3"/>
          <circle cx="${cx + lx * 3}" cy="${-4 + ly * 3}" r="5" fill="${ink}"/></g>
          <line x1="${cx - 10}" y1="${top}" x2="${cx + 10}" y2="${top}" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`;
      }
      const big = e === "shock" || e === "fear";
      const rx = big ? 11.5 : 9, ry = big ? 14 : 11, pr = big ? 3.6 : 5;
      return `<ellipse cx="${cx}" cy="-6" rx="${rx}" ry="${ry}" fill="#fff" stroke="${ink}" stroke-width="3"/>
        <circle cx="${cx + lx * 3}" cy="${-5 + ly * 3}" r="${pr}" fill="${ink}"/>
        <circle cx="${cx + lx * 3 + 1.8}" cy="${-7 + ly * 3}" r="${pr * 0.38}" fill="#fff"/>`;
    };
    return one(-18) + one(18);
  }

  function mouth(e, ink) {
    const dark = "#3a0d12", tongue = "#ff6b81", teeth = "#fff";
    switch (e) {
      case "joy": case "love":
        return `<path d="M-20 12 Q0 42 20 12 Z" fill="${dark}" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>
          <path d="M-19 13 L19 13 L17 18 L-17 18 Z" fill="${teeth}"/><path d="M-9 30 Q0 24 9 30 Q0 36 -9 30Z" fill="${tongue}"/>`;
      case "shock":
        return `<ellipse cx="0" cy="22" rx="9" ry="13" fill="${dark}" stroke="${ink}" stroke-width="3"/>
          <ellipse cx="0" cy="29" rx="5.5" ry="4" fill="${tongue}"/>`;
      case "fear":
        return `<rect x="-17" y="14" width="34" height="14" rx="5" fill="${teeth}" stroke="${ink}" stroke-width="3"/>
          <path d="M-17 21 L17 21 M-8 14 L-8 28 M0 14 L0 28 M8 14 L8 28" stroke="${ink}" stroke-width="1.8"/>`;
      case "anger":
        return `<path d="M-17 26 Q0 12 17 26 L17 28 L-17 28Z" fill="${dark}" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>
          <path d="M-14 23 L14 23" stroke="${teeth}" stroke-width="3"/>`;
      case "sad":
        return `<path d="M-13 26 Q0 15 13 26" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`;
      case "smug":
        return `<path d="M-12 22 Q4 27 15 15" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`;
      case "determined":
        return `<path d="M-12 22 Q0 19 12 22" fill="none" stroke="${ink}" stroke-width="4.5" stroke-linecap="round"/>`;
      case "curious":
        return `<ellipse cx="6" cy="22" rx="5" ry="6" fill="${dark}" stroke="${ink}" stroke-width="3"/>`;
      case "disgust":
        return `<path d="M-14 24 Q-7 18 0 24 Q7 30 14 22" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`;
      default:
        return `<path d="M-10 22 Q0 26 10 22" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`;
    }
  }

  function extras(e, ink) {
    let s = "";
    if (e === "joy" || e === "love" || e === "shock")
      s += `<ellipse cx="-29" cy="10" rx="7" ry="4" fill="#ff5d7a" opacity=".45"/><ellipse cx="29" cy="10" rx="7" ry="4" fill="#ff5d7a" opacity=".45"/>`;
    if (e === "fear" || e === "shock")
      s += `<path d="M36 -30 q-6 10 0 14 q6 -4 0 -14z" fill="#7fd3ff" stroke="${ink}" stroke-width="2"/>`;
    if (e === "sad")
      s += `<path d="M-18 6 q-4 9 0 13 q4 -4 0 -13z" fill="#7fd3ff" stroke="${ink}" stroke-width="1.6"/>`;
    if (e === "anger")
      s += `<g transform="translate(32 -38)" stroke="#e8112d" stroke-width="3.2" stroke-linecap="round" fill="none">
        <path d="M-6 -2 q4 0 4 -4 M2 -6 q0 4 4 4 M6 2 q-4 0 -4 4 M-2 6 q0 -4 -4 -4"/></g>`;
    return s;
  }

  /** kit.face({emotion, x, y, size, look:[dx,dy], ink, skin}) — skin draws a head circle behind the face; omit to draw features only. */
  function face(o = {}) {
    const e = o.emotion || "neutral", size = o.size || 100, ink = o.ink || "#1a1a1a";
    const look = o.look || [0, 0], k = size / 100;
    const head = o.skin
      ? `<circle cx="0" cy="0" r="48" fill="${o.skin}" stroke="${ink}" stroke-width="4"/>
         <ellipse cx="-16" cy="-24" rx="16" ry="9" fill="#fff" opacity=".22" transform="rotate(-25 -16 -24)"/>` : "";
    const brows = (BROWS[e] || BROWS.neutral)
      .map(([a, b, c, d]) => `<path d="M${a} ${b} L${c} ${d}" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>`).join("");
    return `<g class="k-face" transform="translate(${o.x || 0} ${o.y || 0}) scale(${k})">${head}${eyes(e, look, ink)}${brows}${mouth(e, ink)}${extras(e, ink)}</g>`;
  }

  // ---------- characters ----------
  // Drawn in a 200×260 box (origin top-left), feet at y≈255. Placed with x,y = top-left and scale = size/260.
  const ARMS = {
    idle:         { l: "M48 130 Q30 165 38 200", r: "M152 130 Q170 165 162 200", hl: [38, 202], hr: [162, 202] },
    "arms-up":    { l: "M48 125 Q18 95 22 45", r: "M152 125 Q182 95 178 45", hl: [22, 42], hr: [178, 42] },
    "hands-cheeks": { l: "M48 135 Q20 125 40 92", r: "M152 135 Q180 125 160 92", hl: [42, 90], hr: [158, 90] },
    "point-right": { l: "M48 130 Q30 165 38 200", r: "M152 128 Q190 120 222 112", hl: [38, 202], hr: [226, 111] },
    "point-left": { l: "M48 128 Q10 120 -22 112", r: "M152 130 Q170 165 162 200", hl: [-26, 111], hr: [162, 202] },
    shrug:        { l: "M48 135 Q20 150 12 120", r: "M152 135 Q180 150 188 120", hl: [12, 117], hr: [188, 117] },
    "hold-up":    { l: "M48 135 Q40 110 70 95", r: "M152 135 Q160 110 130 95", hl: [72, 93], hr: [128, 93] },
  };

  function accessory(a, ink, body) {
    switch (a) {
      case "helmet": return `<circle cx="100" cy="80" r="76" fill="#bfe6ff" fill-opacity=".18" stroke="#dff3ff" stroke-width="6"/>
          <path d="M45 55 Q60 25 95 15" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none" opacity=".7"/>`;
      case "crown": return `<path d="M62 22 L70 -8 L86 12 L100 -14 L114 12 L130 -8 L138 22 Z" fill="#ffd21f" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/>`;
      case "glasses": return `<g fill="none" stroke="${ink}" stroke-width="4"><circle cx="82" cy="74" r="14"/><circle cx="118" cy="74" r="14"/><path d="M96 74 L104 74"/></g>`;
      case "cap": return `<path d="M50 40 Q100 -10 150 40 Z" fill="${shade(body, -0.35)}" stroke="${ink}" stroke-width="4"/><path d="M140 38 L185 46" stroke="${ink}" stroke-width="8" stroke-linecap="round"/>`;
      case "hardhat": return `<path d="M48 44 Q100 -12 152 44 Z" fill="#ffc400" stroke="${ink}" stroke-width="4"/><rect x="38" y="40" width="124" height="10" rx="5" fill="#ffc400" stroke="${ink}" stroke-width="4"/>`;
      case "tie": return `<path d="M100 150 L92 162 L100 205 L108 162 Z" fill="#e8112d" stroke="${ink}" stroke-width="3"/>`;
      default: return "";
    }
  }

  /**
   * kit.character({ body, color, emotion, pose, x, y, size, ink, accessories:[], look, flip })
   *   body:  "bean" | "blob" | "round" | "robot"
   *   pose:  idle | arms-up | hands-cheeks | point-right | point-left | shrug | hold-up
   *   size:  rendered height in px (default 260)
   */
  function character(o = {}) {
    const body = o.body || "bean", color = o.color || "#ffb703", ink = o.ink || "#1a1a1a";
    const emotion = o.emotion || "neutral", pose = ARMS[o.pose || "idle"] || ARMS.idle;
    const k = (o.size || 260) / 260, gid = uid("g"), dark = shade(color, -0.3), light = shade(color, 0.35);
    const grad = `<defs><radialGradient id="${gid}" cx="35%" cy="28%" r="80%"><stop offset="0" stop-color="${light}"/>
      <stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${dark}"/></radialGradient></defs>`;
    const limb = (d) => `<path d="${d}" stroke="${ink}" stroke-width="22" stroke-linecap="round" fill="none"/>
      <path d="${d}" stroke="${o.limbColor || color}" stroke-width="14" stroke-linecap="round" fill="none"/>`;
    const hand = ([x, y]) => `<circle cx="${x}" cy="${y}" r="12" fill="${o.limbColor || color}" stroke="${ink}" stroke-width="4"/>`;
    const legs = `<rect x="68" y="205" width="24" height="48" rx="12" fill="${dark}" stroke="${ink}" stroke-width="4"/>
      <rect x="108" y="205" width="24" height="48" rx="12" fill="${dark}" stroke="${ink}" stroke-width="4"/>`;
    let torso = "", faceSvg = "";
    if (body === "bean") {
      torso = `<rect x="44" y="18" width="112" height="206" rx="56" fill="url(#${gid})" stroke="${ink}" stroke-width="5"/>`;
      faceSvg = face({ emotion, x: 100, y: 82, size: 88, ink, look: o.look });
    } else if (body === "blob") {
      torso = `<path d="M100 22 C160 22 182 90 180 150 C178 210 150 228 100 228 C50 228 22 210 20 150 C18 90 40 22 100 22Z" fill="url(#${gid})" stroke="${ink}" stroke-width="5"/>`;
      faceSvg = face({ emotion, x: 100, y: 110, size: 104, ink, look: o.look });
    } else if (body === "round") {
      torso = `<rect x="62" y="128" width="76" height="96" rx="30" fill="${dark}" stroke="${ink}" stroke-width="5"/>
        <circle cx="100" cy="80" r="62" fill="url(#${gid})" stroke="${ink}" stroke-width="5"/>`;
      faceSvg = face({ emotion, x: 100, y: 84, size: 92, ink, look: o.look });
    } else if (body === "robot") {
      torso = `<line x1="100" y1="18" x2="100" y2="-4" stroke="${ink}" stroke-width="5"/><circle cx="100" cy="-8" r="9" fill="#ff3b30" stroke="${ink}" stroke-width="4"/>
        <rect x="56" y="134" width="88" height="88" rx="16" fill="url(#${gid})" stroke="${ink}" stroke-width="5"/>
        <rect x="34" y="18" width="132" height="112" rx="24" fill="url(#${gid})" stroke="${ink}" stroke-width="5"/>
        <rect x="48" y="32" width="104" height="84" rx="16" fill="#0d1b2a" stroke="${ink}" stroke-width="4"/>
        <circle cx="100" cy="178" r="12" fill="#5ef2ff" stroke="${ink}" stroke-width="3"/>`;
      faceSvg = face({ emotion, x: 100, y: 76, size: 74, ink: "#5ef2ff", look: o.look });
    }
    const flip = o.flip ? `translate(200 0) scale(-1 1)` : "";
    const acc = (o.accessories || []).map((a) => accessory(a, ink, color));
    const accBehind = acc.filter((_, i) => o.accessories[i] !== "helmet").join("");
    const accFront = acc.filter((_, i) => o.accessories[i] === "helmet").join("");
    return `<g class="k-character" transform="translate(${o.x || 0} ${o.y || 0}) scale(${k})"><g transform="${flip}">${grad}
      ${legs}${limb(pose.l)}${limb(pose.r)}${torso}${faceSvg}${accBehind}${hand(pose.hl)}${hand(pose.hr)}${accFront}</g></g>`;
  }

  // ---------- marks ----------
  /** kit.arrow({from:[x,y], to:[x,y], color, width, curve, outline}) — chunky curved arrow. */
  function arrow(o) {
    const [x1, y1] = o.from, [x2, y2] = o.to, w = o.width || 22, c = o.color || "#ff2d2d", bend = o.curve ?? 0.25;
    const mx = (x1 + x2) / 2 - (y2 - y1) * bend, my = (y1 + y2) / 2 + (x2 - x1) * bend;
    const ang = Math.atan2(y2 - my, x2 - mx), hl = w * 2.4;
    const p1 = [x2 - hl * Math.cos(ang - 0.5), y2 - hl * Math.sin(ang - 0.5)];
    const p2 = [x2 - hl * Math.cos(ang + 0.5), y2 - hl * Math.sin(ang + 0.5)];
    const ex = x2 - hl * 0.7 * Math.cos(ang), ey = y2 - hl * 0.7 * Math.sin(ang);
    const shaft = `M${x1} ${y1} Q${mx} ${my} ${ex} ${ey}`, head = `M${x2} ${y2} L${p1} L${p2} Z`;
    const ol = o.outline ?? "#000";
    return `<g class="k-arrow"><path d="${shaft}" stroke="${ol}" stroke-width="${w + 10}" fill="none" stroke-linecap="round"/>
      <path d="${head}" fill="${ol}" stroke="${ol}" stroke-width="10" stroke-linejoin="round"/>
      <path d="${shaft}" stroke="${c}" stroke-width="${w}" fill="none" stroke-linecap="round"/><path d="${head}" fill="${c}"/></g>`;
  }

  /** kit.burst({cx, cy, r, points, inner, color, stroke, text, textColor, font, fontSize, rotate}) — starburst sticker. */
  function burst(o) {
    const n = o.points || 14, r = o.r || 120, ri = r * (o.inner || 0.72), pts = [];
    for (let i = 0; i < n * 2; i++) {
      const a = (Math.PI * i) / n - Math.PI / 2, rr = i % 2 ? ri : r;
      pts.push(`${(o.cx + rr * Math.cos(a)).toFixed(1)},${(o.cy + rr * Math.sin(a)).toFixed(1)}`);
    }
    const t = o.text ? `<text x="${o.cx}" y="${o.cy}" text-anchor="middle" dominant-baseline="central" font-family="${o.font || "Luckiest Guy"}"
      font-size="${o.fontSize || r * 0.5}" fill="${o.textColor || "#000"}">${o.text}</text>` : "";
    return `<g class="k-burst" transform="rotate(${o.rotate || 0} ${o.cx} ${o.cy})"><polygon points="${pts.join(" ")}" fill="${o.color || "#ffd21f"}"
      stroke="${o.stroke || "#000"}" stroke-width="6" stroke-linejoin="round"/>${t}</g>`;
  }

  /** kit.circleMark({cx, cy, rx, ry, color, width}) — hand-drawn highlight circle (double loop). */
  function circleMark(o) {
    const { cx, cy } = o, rx = o.rx || 100, ry = o.ry || rx * 0.8, w = o.width || 10;
    const d = `M${cx + rx * 0.9} ${cy - ry * 0.55} C${cx + rx * 1.15} ${cy + ry * 0.6} ${cx - rx * 0.4} ${cy + ry * 1.2} ${cx - rx * 0.95} ${cy + ry * 0.2}
      C${cx - rx * 1.25} ${cy - ry * 0.7} ${cx + rx * 0.2} ${cy - ry * 1.2} ${cx + rx * 1.05} ${cy - ry * 0.25}`;
    return `<path class="k-circle" d="${d}" fill="none" stroke="${o.color || "#ff2d2d"}" stroke-width="${w}" stroke-linecap="round"/>`;
  }

  /** kit.svg(inner, {width=1280, height=720, viewBox, style}) — wrap markup in a full-canvas <svg>. */
  function svg(inner, o = {}) {
    const w = o.width || 1280, h = o.height || 720;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${o.viewBox || `0 0 ${w} ${h}`}" style="${o.style || "position:absolute;inset:0"}">${inner}</svg>`;
  }

  /** kit.mount(selectorOrEl, markup) — append markup into an element. */
  function mount(target, markup) {
    const el = typeof target === "string" ? document.querySelector(target) : target;
    el.insertAdjacentHTML("beforeend", markup);
    return el;
  }

  function seed(n) { _seed = n >>> 0 || 1; }
  function rand() { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; }
  function ready() { (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { window.__NAILSTAR_READY__ = true; }); }

  window.kit = { face, character, arrow, burst, circleMark, svg, mount, shade, seed, rand, ready, emotions: Object.keys(BROWS), poses: Object.keys(ARMS) };
})();
