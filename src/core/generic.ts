/**
 * Layout for labels no template knows. Fixed rules, no measurements:
 * find the label on the page, turn it upright, cut it into blocks at its
 * white gaps. The result has the same shape as a measured template, so the
 * rest of the pipeline (extract, stack, read back) runs unchanged.
 */
import type { Gray, Rect } from "./image";
import type { TextItem } from "./pdftext";
import type { Code, Part } from "./pipeline";

/** Pixels per millimetre in the 406 dpi render. */
const MM = 406 / 25.4;
const INK = 160; // darker than this counts as ink, as in the trim
const px = (mm: number) => Math.round(mm * MM);

// ------------------------------------------------------------------ geometry

/** Where a box lands after Pillow's rotate(r, expand) of a w × h image. */
export function rotateBox([x0, y0, x1, y1]: Rect, r: number, w: number, h: number): Rect {
  switch (((r % 360) + 360) % 360) {
    case 90:
      return [y0, w - x1, y1, w - x0];
    case 180:
      return [w - x1, h - y1, w - x0, h - y0];
    case 270:
      return [h - y1, x0, h - y0, x1];
    default:
      return [x0, y0, x1, y1];
  }
}

const overlaps = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const contains = (a: Rect, b: Rect) => b[0] >= a[0] && b[1] >= a[1] && b[2] <= a[2] && b[3] <= a[3];
const areaOf = (r: Rect) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
const grow = (r: Rect, m: number): Rect => [r[0] - m, r[1] - m, r[2] + m, r[3] + m];
const clip = (r: Rect, w: number, h: number): Rect => [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(w, r[2]), Math.min(h, r[3])];

// ------------------------------------------------------------------ 1. find the label

/** A straight line on the page: `at` is its row (horizontal) or column (vertical), `from`/`to` its extent. */
interface Line {
  at0: number;
  at1: number;
  from: number;
  to: number;
}

const LINE_MIN = px(40); // shortest frame side
const LINE_GAP = px(3); // widest gap inside a dashed line
const LINE_THICK = px(1.5); // thicker than this is a bar, not a line
const LINE_DENSITY = 0.6; // dashes cover at least this much of a dashed line

/** Long straight lines on the page, solid or dashed. `horizontal` false scans columns. */
export function lines(im: Gray, horizontal: boolean, minLen = LINE_MIN): Line[] {
  const along = horizontal ? im.w : im.h;
  const across = horizontal ? im.h : im.w;
  const at = (i: number, j: number) => (horizontal ? im.d[i * im.w + j] : im.d[j * im.w + i]);
  // Segments per row (or column): runs of ink with gaps under LINE_GAP, long and dense enough.
  const segs: { i: number; from: number; to: number }[] = [];
  for (let i = 0; i < across; i++) {
    let start = -1, last = -1, count = 0;
    const close = () => {
      if (start >= 0 && last + 1 - start >= minLen && count / (last + 1 - start) >= LINE_DENSITY) segs.push({ i, from: start, to: last + 1 });
    };
    for (let j = 0; j < along; j++) {
      if (at(i, j) >= INK) continue;
      if (start >= 0 && j - last > LINE_GAP) {
        close();
        start = -1;
      }
      if (start < 0) {
        start = j;
        count = 0;
      }
      last = j;
      count++;
    }
    close();
  }
  // Neighbouring rows with overlapping segments are one line, if it is thin.
  const open: (Line & { last: number })[] = [];
  const done: Line[] = [];
  for (const s of segs) {
    const g = open.find((o) => o.last >= s.i - 1 && Math.min(o.to, s.to) - Math.max(o.from, s.from) > 0.5 * (s.to - s.from));
    if (g) {
      g.at1 = s.i + 1;
      g.last = s.i;
      g.from = Math.min(g.from, s.from);
      g.to = Math.max(g.to, s.to);
    } else open.push({ at0: s.i, at1: s.i + 1, from: s.from, to: s.to, last: s.i });
  }
  for (const o of open) if (o.at1 - o.at0 <= LINE_THICK) done.push({ at0: o.at0, at1: o.at1, from: o.from, to: o.to });
  return done;
}

/** The innermost rectangle of lines around `code`, at least 50 mm a side, with matching corners. */
export function findFrame(page: Gray, code: Rect): Rect | null {
  const tol = px(4);
  const hs = lines(page, true);
  const vs = lines(page, false);
  const spans = (l: Line, a: number, b: number) => l.from <= a + tol && l.to >= b - tol;
  const byDistance = (ls: Line[], d: (l: Line) => number) => ls.sort((a, b) => d(a) - d(b)).slice(0, 8);
  const tops = byDistance(hs.filter((l) => l.at1 <= code[1] && spans(l, code[0], code[2])), (l) => code[1] - l.at1);
  const bottoms = byDistance(hs.filter((l) => l.at0 >= code[3] && spans(l, code[0], code[2])), (l) => l.at0 - code[3]);
  const lefts = byDistance(vs.filter((l) => l.at1 <= code[0] && spans(l, code[1], code[3])), (l) => code[0] - l.at1);
  const rights = byDistance(vs.filter((l) => l.at0 >= code[2] && spans(l, code[1], code[3])), (l) => l.at0 - code[2]);
  const near = (a: number, b: number) => Math.abs(a - b) <= tol;
  let best: Rect | null = null;
  for (const t of tops)
    for (const b of bottoms)
      for (const l of lefts)
        for (const r of rights) {
          const box: Rect = [l.at0, t.at0, r.at1, b.at1];
          if (box[2] - box[0] < px(50) || box[3] - box[1] < px(50)) continue;
          const corners =
            near(t.from, l.at0) && near(t.to, r.at1) && near(b.from, l.at0) && near(b.to, r.at1) &&
            near(l.from, t.at0) && near(l.to, b.at1) && near(r.from, t.at0) && near(r.to, b.at1);
          if (corners && (!best || areaOf(box) < areaOf(best))) best = box;
        }
  return best ? clip(grow(best, px(1)), page.w, page.h) : null;
}

/** The ink around `code`, grown over gaps narrower than `gapMm`, on a 1 mm grid. */
export function island(page: Gray, code: Rect, gapMm = 8, bounds: Rect = [0, 0, page.w, page.h]): Rect {
  const cell = 16; // ≈ 1 mm
  const gw = Math.ceil(page.w / cell), gh = Math.ceil(page.h / cell);
  const counts = new Uint16Array(gw * gh);
  // Only ink inside the bounds (the part of the page between cut lines) counts.
  for (let y = Math.max(0, bounds[1]); y < Math.min(page.h, bounds[3]); y++) {
    const row = y * page.w, gy = ((y / cell) | 0) * gw;
    for (let x = Math.max(0, bounds[0]); x < Math.min(page.w, bounds[2]); x++) if (page.d[row + x] < INK) counts[gy + ((x / cell) | 0)]++;
  }
  const inked = new Uint8Array(gw * gh);
  for (let i = 0; i < inked.length; i++) inked[i] = counts[i] >= 3 ? 1 : 0; // ignore specks
  const [cx0, cy0, cx1, cy1] = [Math.floor(code[0] / cell), Math.floor(code[1] / cell), Math.ceil(code[2] / cell), Math.ceil(code[3] / cell)];
  for (let y = Math.max(0, cy0); y < Math.min(gh, cy1); y++) for (let x = Math.max(0, cx0); x < Math.min(gw, cx1); x++) inked[y * gw + x] = 1;
  // Grow every inked cell by half the gap, so ink closer than the gap joins up.
  const r = Math.ceil(gapMm / 2);
  const tmp = new Uint8Array(gw * gh), grown = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      let v = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(gw - 1, x + r) && !v; k++) v = inked[y * gw + k];
      tmp[y * gw + x] = v;
    }
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      let v = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(gh - 1, y + r) && !v; k++) v = tmp[k * gw + x];
      grown[y * gw + x] = v;
    }
  // Flood fill from the code over the grown cells; the box covers the real ink reached.
  const seen = new Uint8Array(gw * gh);
  const start = Math.min(gh - 1, Math.max(0, (cy0 + cy1) >> 1)) * gw + Math.min(gw - 1, Math.max(0, (cx0 + cx1) >> 1));
  const stack = [start];
  seen[start] = 1;
  let bx0 = gw, by0 = gh, bx1 = -1, by1 = -1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % gw, y = (i / gw) | 0;
    if (inked[i]) {
      bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
    }
    for (const j of [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1, y > 0 ? i - gw : -1, y < gh - 1 ? i + gw : -1]) {
      if (j >= 0 && !seen[j] && grown[j]) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  const [l, t, r2, b] = clip([(bx0 - 1) * cell, (by0 - 1) * cell, (bx1 + 2) * cell, (by1 + 2) * cell], page.w, page.h);
  return [Math.max(l, bounds[0]), Math.max(t, bounds[1]), Math.min(r2, bounds[2]), Math.min(b, bounds[3])];
}

/**
 * Dashed "cut here" lines across the page, as on A4 label sheets: thin rows
 * of at least 15 dashes spanning 85% of the page, most of them the same
 * length. Text never looks like that; a solid rule inside a label is not one.
 * Returns the middle row (or column) of each.
 */
export function cutLines(im: Gray, horizontal: boolean): number[] {
  const along = horizontal ? im.w : im.h;
  const across = horizontal ? im.h : im.w;
  const at = (i: number, j: number) => (horizontal ? im.d[i * im.w + j] : im.d[j * im.w + i]);
  const hits: number[] = [];
  for (let i = 0; i < across; i++) {
    const runs: number[] = [];
    let first = -1, last = -1, start = -1, maxGap = 0;
    for (let j = 0; j <= along; j++) {
      const ink = j < along && at(i, j) < INK;
      if (ink) {
        if (start < 0) {
          start = j;
          if (last >= 0) maxGap = Math.max(maxGap, j - last - 1);
        }
        if (first < 0) first = j;
        last = j;
      } else if (start >= 0) {
        runs.push(j - start);
        start = -1;
      }
    }
    if (runs.length < 15 || last - first < 0.85 * along || maxGap > px(5)) continue;
    const sorted = [...runs].sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    const alike = runs.filter((r) => Math.abs(r - med) <= 0.4 * med).length;
    if (alike >= 0.8 * runs.length && med >= px(0.5)) hits.push(i);
  }
  // Neighbouring rows are one line, if it is thin.
  const out: number[] = [];
  for (let k = 0; k < hits.length; ) {
    let e = k;
    while (e + 1 < hits.length && hits[e + 1] === hits[e] + 1) e++;
    if (hits[e] - hits[k] + 1 <= LINE_THICK) out.push((hits[k] + hits[e]) >> 1);
    k = e + 1;
  }
  return out;
}

/**
 * The dashed cut lines split the page into parts. The label is in the part with the most codes,
 * the biggest codes breaking a tie.
 */
export function labelPart(page: Gray, codes: Code[]): { bounds: Rect; codes: Code[] } {
  const cutsY = cutLines(page, true);
  const cutsX = cutLines(page, false);
  const span = (cuts: number[], v: number, end: number): [number, number] => {
    let lo = 0, hi = end;
    for (const c of cuts) {
      if (c <= v) lo = Math.max(lo, c);
      else hi = Math.min(hi, c);
    }
    return [lo, hi];
  };
  const parts = new Map<string, { bounds: Rect; codes: Code[] }>();
  for (const c of codes) {
    const [x0, x1] = span(cutsX, (c.box[0] + c.box[2]) / 2, page.w);
    const [y0, y1] = span(cutsY, (c.box[1] + c.box[3]) / 2, page.h);
    const key = `${x0},${y0}`;
    if (!parts.has(key)) parts.set(key, { bounds: [x0, y0, x1, y1], codes: [] });
    parts.get(key)!.codes.push(c);
  }
  const weight = (p: { codes: Code[] }) => p.codes.reduce((s, c) => s + areaOf(c.box), 0);
  return [...parts.values()].reduce((a, b) =>
    b.codes.length > a.codes.length || (b.codes.length === a.codes.length && weight(b) > weight(a)) ? b : a);
}

const area = (c: Code) => areaOf(c.box);

/** The label's box on the page: a cut-line frame around the biggest code, else the ink island around it. */
export function findLabel(page: Gray, codes: Code[]): { box: Rect; how: "frame" | "island" } {
  const biggest = (cs: Code[]) => cs.reduce((a, b) => (area(b) > area(a) ? b : a));
  const frame = findFrame(page, biggest(codes).box);
  if (frame) return { box: frame, how: "frame" };
  const part = labelPart(page, codes);
  const big = biggest(part.codes);
  // No label is smaller than 50 mm a side: an island that small stopped short
  // of the address, so try again across wider gaps.
  let box = island(page, big.box, 8, part.bounds);
  for (const gap of [12, 16, 24]) {
    if (box[2] - box[0] >= px(50) && box[3] - box[1] >= px(50)) break;
    box = island(page, big.box, gap, part.bounds);
  }
  return { box, how: "island" };
}

// ------------------------------------------------------------------ 2. turn it upright

const TWO_D = new Set(["QRCode", "MicroQRCode", "rMQRCode", "DataMatrix", "Aztec", "PDF417", "MaxiCode"]);

const quarter = (deg: number) => ((Math.round(deg / 90) * 90) % 360 + 360) % 360;

/** Degrees counter-clockwise that turn the label upright (the `rotate` of a template). */
export function upright(items: TextItem[], codes: Code[], box: Rect): number {
  // 1. Text inside the label, weighted by length: use it when 70% of it agrees.
  const votes = new Map<number, number>();
  let total = 0;
  for (const it of items) {
    if (it.x < box[0] || it.x > box[2] || it.y < box[1] || it.y > box[3]) continue;
    const n = it.str.trim().length;
    const q = quarter(it.angle);
    votes.set(q, (votes.get(q) ?? 0) + n);
    total += n;
  }
  if (total) {
    const [q, n] = [...votes].reduce((a, b) => (b[1] > a[1] ? b : a));
    if (n >= 0.7 * total) return (360 - q) % 360;
  }
  // 2. 1D barcodes read along the text: use them when they all agree.
  const linear = codes.filter((c) => !TWO_D.has(c.format) && c.angle !== undefined).map((c) => quarter(c.angle!));
  if (linear.length && linear.every((q) => q === linear[0])) return (360 - linear[0]) % 360;
  // 3. Not sure: leave it as it lies.
  return 0;
}

// ------------------------------------------------------------------ 3. cut it into blocks

export interface Block {
  box: Rect;
  isCode: boolean;
}

const STRAY = 2; // a row with this many ink pixels or fewer still counts as white
const CODE_PAD = px(2);

/** Ink mask of the upright label: long rules removed, codes filled solid. */
function mask(label: Gray, codes: Rect[]): Uint8Array {
  const { w, h } = label;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = label.d[i] < INK ? 1 : 0;
  // Rules (borders, separators) would block every cut across them.
  const sub: Gray = { w, h, d: label.d };
  for (const l of lines(sub, true, Math.max(LINE_MIN, 0.4 * w)))
    for (let y = l.at0; y < l.at1; y++) m.fill(0, y * w + l.from, y * w + l.to);
  for (const l of lines(sub, false, Math.max(LINE_MIN, 0.4 * h)))
    for (let x = l.at0; x < l.at1; x++) for (let y = l.from; y < l.to; y++) m[y * w + x] = 0;
  for (const c of codes) {
    const [x0, y0, x1, y1] = clip(grow(c, CODE_PAD), w, h);
    for (let y = y0; y < y1; y++) m.fill(1, y * w + x0, y * w + x1);
  }
  return m;
}

/** Ink counts per row and per column inside `r`. */
function profiles(m: Uint8Array, w: number, r: Rect): { rows: Uint32Array; cols: Uint32Array } {
  const [x0, y0, x1, y1] = r;
  const rows = new Uint32Array(y1 - y0), cols = new Uint32Array(x1 - x0);
  for (let y = y0; y < y1; y++) {
    const row = y * w;
    for (let x = x0; x < x1; x++)
      if (m[row + x]) {
        rows[y - y0]++;
        cols[x - x0]++;
      }
  }
  return { rows, cols };
}

/** First and last inked index, and the widest white run between them. */
function scan(p: Uint32Array): { first: number; last: number; run: number; at: number } | null {
  let first = -1, last = -1;
  for (let i = 0; i < p.length; i++) if (p[i] > STRAY) {
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0) return null;
  let run = 0, at = -1, cur = 0;
  for (let i = first; i <= last; i++) {
    if (p[i] > STRAY) cur = 0;
    else if (++cur > run) {
      run = cur;
      at = i - ((cur - 1) >> 1);
    }
  }
  return { first, last, run, at };
}

/** White runs between inked rows of the whole label: their median is its line spacing. */
function lineGap(m: Uint8Array, w: number, h: number): number {
  const { rows } = profiles(m, w, [0, 0, w, h]);
  const runs: number[] = [];
  let cur = 0, seenInk = false;
  for (const v of rows) {
    if (v > STRAY) {
      if (seenInk && cur >= 2) runs.push(cur);
      seenInk = true;
      cur = 0;
    } else cur++;
  }
  if (!runs.length) return 0;
  runs.sort((a, b) => a - b);
  return runs[runs.length >> 1];
}

/**
 * Blocks of an upright, trimmed label, in reading order. `codes` are code
 * boxes in label pixels, `dots` the printer width.
 */
export function blocks(label: Gray, codes: Rect[], dots: number): Block[] {
  const { w, h } = label;
  const m = mask(label, codes);
  const gap = Math.min(px(8), Math.max(px(2), Math.round(2.2 * lineGap(m, w, h))));
  const out: Block[] = [];

  // "text" mode: the label's own gap, columns only when too wide. "code" mode frees a code that
  // shares its block with text: any gap of 1 mm, any columns, but only while the piece holds a code.
  const cut = (r: Rect, mode: "text" | "code"): void => {
    const minGap = mode === "code" ? px(1) : gap;
    const { rows, cols } = profiles(m, w, r);
    const sr = scan(rows), sc = scan(cols);
    if (!sr || !sc) return;
    const ink: Rect = [r[0] + sc.first, r[1] + sr.first, r[0] + sc.last + 1, r[1] + sr.last + 1];
    // Columns only when the row, kept whole, would shrink below real size (406 dpi is twice the printer's).
    const columns = mode === "code" || ink[2] - ink[0] > 2 * dots;
    const hOk = sr.run >= minGap, vOk = columns && sc.run >= minGap;
    const child = (c: Rect) => cut(c, mode === "code" && codes.some((k) => overlaps(k, c)) ? "code" : "text");
    if (hOk && (!vOk || sr.run >= sc.run)) {
      const y = r[1] + sr.at;
      child([ink[0], ink[1], ink[2], y]);
      child([ink[0], y, ink[2], ink[3]]);
      return;
    }
    if (vOk) {
      const x = r[0] + sc.at;
      child([ink[0], ink[1], x, ink[3]]);
      child([x, ink[1], ink[2], ink[3]]);
      return;
    }
    const inside = codes.filter((c) => overlaps(c, ink));
    const bw = ink[2] - ink[0], bh = ink[3] - ink[1];
    if (!inside.length) {
      // Dust, specks, stray marks.
      let n = 0;
      for (let y = ink[1]; y < ink[3]; y++) for (let x = ink[0]; x < ink[2]; x++) n += m[y * w + x];
      if (bw < px(3) || bh < px(3) || n < 0.005 * bw * bh) return;
    }
    const codeArea = inside.reduce((s, c) => s + areaOf(clip(grow(c, CODE_PAD), w, h)), 0);
    if (inside.length && codeArea < 0.5 * bw * bh && mode === "text") {
      // A code sharing its block with text: cut it out, so the text still prints bold.
      const before = out.length;
      cut(ink, "code");
      if (out.length - before > 1) return;
      out.length = before;
    }
    out.push({ box: ink, isCode: inside.length > 0 });
  };

  cut([0, 0, w, h], "text");
  return out;
}

/** Blocks as template parts: fractions of the label, a little white around each, at most 2× bigger. */
export function toParts(bs: Block[], w: number, h: number): Part[] {
  return bs.map(({ box, isCode }) => {
    const [x0, y0, x1, y1] = clip(grow(box, px(0.5)), w, h);
    return [[x0 / w, y0 / h, x1 / w, y1 / h], 2.0, isCode] as Part;
  });
}

export { contains, overlaps };
