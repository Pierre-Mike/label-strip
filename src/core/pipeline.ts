/**
 * Label pipeline: match a carrier template, find the label from its biggest
 * code, crop it upright, stack its blocks at printer width, and check that
 * every code still reads. A port of print_label.py; function names follow it.
 */
import {
  type Bits,
  type Gray,
  type Rect,
  BOX,
  below,
  centred,
  copy,
  crop,
  fillRect,
  inkBox,
  pyRound,
  resize,
  rotate,
  threshold,
} from "./image";
import templatesJson from "../templates.json";
import { blocks, findLabel, rotateBox, toParts, upright } from "./generic";
import type { TextItem } from "./pdftext";

export const RENDER_DPI = 406;
/** Pixels at the crop border ignored when trimming (see extract). */
export const TRIM_EDGE = 2;
export const PAPER_DOTS: Record<number, number> = { 80: 576, 58: 384 };

export type Box = [number, number, number, number];
export type Part = [Box, number, boolean]; // fractional box, most it may grow, holds a code

export interface Template {
  name: string;
  label?: string;
  needles: string[];
  around: Box;
  rotate?: number;
  landscape?: boolean;
  parts: Part[];
}

export const TEMPLATES = templatesJson as Template[];

export interface Code {
  text: string;
  format: string;
  box: Rect; // pixels: x0, y0, x1, y1
  /** Reading direction, degrees counter-clockwise as seen (0 = left to right). */
  angle?: number;
}

/** Reads every code in an image. Injected so the pipeline runs in a worker, in Node, or in tests. */
export type Reader = (im: Gray) => Promise<Code[]>;

export type Refusal =
  | { kind: "no-code" }
  | { kind: "crop-cuts"; format: string; text: string }
  | { kind: "unreadable"; codes: CodeRef[] };

export interface CodeRef {
  format: string;
  text: string;
}

export class Refused extends Error {
  constructor(public reason: Refusal) {
    super(reason.kind);
  }
}

export interface Options {
  dots?: number; // printer width: 576 for 80 mm, 384 for 58 mm
  plain?: boolean; // whole label at paper width, no stacking, no bold
  /** Near the crop border, only solid ink counts for the trim (default true,
   * for pdf.js renders). False reproduces the script exactly on poppler renders. */
  solidEdge?: boolean;
}

/** How the label was laid out: a measured template, the automatic blocks, or the whole label at paper width. */
export type Layout = "template" | "auto" | "whole";

export interface Made {
  image: Bits;
  layout: Layout;
  /** Automatic layout only: each block's box on the page, in pixels. */
  blocks?: Rect[];
  /** Label box on the page, in pixels, and every code inside it. */
  box: Rect;
  codes: Code[];
  expected: CodeRef[];
  /** Codes that only read back at real size and were printed again below. */
  realSize: CodeRef[];
}

const area = (c: Code) => (c.box[2] - c.box[0]) * (c.box[3] - c.box[1]);
const ref = (c: Code): CodeRef => ({ format: c.format, text: c.text });

/** Lower-cased text with all whitespace removed, so needles match however pdf.js splits words. */
function squash(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

export function match(text: string, landscape: boolean, templates = TEMPLATES): Template | null {
  const low = squash(text);
  for (const t of templates) {
    const ok = t.needles.every((n) => low.includes(squash(n)));
    if (ok && (t.landscape === undefined || t.landscape === null || t.landscape === landscape)) return t;
  }
  return null;
}

/** A code's box plus a white quiet zone (40 px = 2.5 mm at 406 dpi). */
export function pad(b: Rect, m = 40): Rect {
  return [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
}

/** Label box on the page, anchored on the largest code, and the codes inside it. */
export async function locate(page: Gray, t: Template, read: Reader): Promise<{ box: Rect; inside: Code[] }> {
  const codes = await readPage(page, read);
  const a = codes.reduce((best, c) => (area(c) > area(best) ? c : best));
  const cx = (a.box[0] + a.box[2]) / 2;
  const cy = (a.box[1] + a.box[3]) / 2;
  const mm = RENDER_DPI / 25.4;
  const [dx0, dy0, dx1, dy1] = t.around;
  const box: Rect = [
    Math.max(0, pyRound(cx + dx0 * mm)),
    Math.max(0, pyRound(cy + dy0 * mm)),
    Math.min(page.w, pyRound(cx + dx1 * mm)),
    Math.min(page.h, pyRound(cy + dy1 * mm)),
  ];
  return { box, inside: insideBox(codes, box) };
}

async function readPage(page: Gray, read: Reader): Promise<Code[]> {
  const codes = await read(page);
  if (!codes.length) throw new Refused({ kind: "no-code" });
  return codes;
}

/** Codes inside the box. Refuses when the box cuts through one. */
function insideBox(codes: Code[], box: Rect): Code[] {
  const inside: Code[] = [];
  for (const c of codes) {
    const [x0, y0, x1, y1] = c.box;
    if (x0 >= box[0] && y0 >= box[1] && x1 <= box[2] && y1 <= box[3]) inside.push(c);
    else if (x1 > box[0] && x0 < box[2] && y1 > box[1] && y0 < box[3]) {
      throw new Refused({ kind: "crop-cuts", format: c.format, text: c.text });
    }
  }
  return inside;
}

/** Where the trim lands in the cropped, turned label. */
function trimBox(page: Gray, t: Template, box: Rect, solidEdge: boolean): { turned: Gray; ink: Rect | null } {
  let im = crop(page, box);
  if (t.rotate) im = rotate(im, t.rotate);
  return { turned: im, ink: solidEdge ? inkBox(im, 160, TRIM_EDGE, 96) : inkBox(im, 160) };
}

/** Crop, turn upright and trim the label. Codes in `blank` are painted white,
 * keeping the trim of the original so the template's blocks still line up. */
export function extract(page: Gray, t: Template, box: Rect, blank: Code[] = [], solidEdge = true): Gray {
  let orig = crop(page, box);
  let work = blank.length ? copy(orig) : orig;
  for (const c of blank) {
    const [x0, y0, x1, y1] = pad(c.box);
    fillRect(work, [x0 - box[0], y0 - box[1], x1 - box[0], y1 - box[1]], 255);
  }
  if (t.rotate) {
    orig = rotate(orig, t.rotate);
    work = blank.length ? rotate(work, t.rotate) : orig;
  }
  // A cut line lying on the crop edge can leave a column of gray anti-aliased
  // pixels inside the crop with pdf.js, where poppler snaps it outside. Near
  // the border only solid ink counts, so the trim does not depend on the renderer.
  // Off when the page comes from poppler, to match the script exactly.
  const ink = solidEdge ? inkBox(orig, 160, TRIM_EDGE, 96) : inkBox(orig, 160);
  return ink ? crop(work, ink) : work;
}

/** Scale to `width` dots and threshold. `bold` uses a lighter cut-off so the
 * gray edges of thin strokes print black. Never used on codes. */
export function toPrinter(im: Gray, width: number, bold = false): Bits {
  const h = Math.max(1, pyRound((im.h * width) / im.w));
  return threshold(resize(im, width, h), bold ? 210 : 140);
}

/** The label's blocks, each scaled, thresholded and centred on its own strip. */
export function stacked(label: Gray, parts: Part[], dots: number, bold: boolean): Bits[] {
  const { w: bw, h: bh } = label;
  const blocks: Bits[] = [];
  for (const [[x0, y0, x1, y1], maxScale, isCode] of parts) {
    const part = crop(label, [pyRound(x0 * bw), pyRound(y0 * bh), pyRound(x1 * bw), pyRound(y1 * bh)]);
    if (part.w < 1 || part.h < 1) continue;
    const natural = (part.w * dots) / bw; // its width in the plain layout
    const target = Math.max(1, Math.min(dots, pyRound(natural * maxScale)));
    blocks.push(centred(toPrinter(part, target, bold && !isCode), dots));
  }
  return blocks;
}

/** A code at real size: half the 406 dpi render is 203 dpi. Turned to run
 * along the paper if it is wider than the print width. */
export function native(page: Gray, c: Code, dots: number): Bits {
  const im = crop(page, pad(c.box));
  let g = resize(im, Math.floor(im.w / 2), Math.floor(im.h / 2), BOX);
  if (g.w > dots) g = rotate(g, 90);
  return centred(threshold(g, 128), dots);
}

/** Codes that do not read back. Each block is read on its own (the reader
 * shrinks tall images first, which loses small codes that print fine), then
 * the whole strip, so nothing the script would accept is refused here. */
export async function unreadable(blocks: Bits[], expected: Code[], read: Reader, dots: number): Promise<Code[]> {
  const got = new Set<string>();
  const missing = () => expected.filter((c) => !got.has(c.text));
  for (const b of blocks) {
    for (const c of await read(bitsToGray(b))) got.add(c.text);
    if (!missing().length) return [];
  }
  if (blocks.length > 1) for (const c of await read(bitsToGray(below(dots, blocks)))) got.add(c.text);
  return missing();
}

function bitsToGray(b: Bits): Gray {
  const d = new Uint8Array(b.w * b.h);
  for (let i = 0; i < d.length; i++) d[i] = b.d[i] ? 0 : 255;
  return { w: b.w, h: b.h, d };
}

/** Printer image for one label, checked. Throws Refused if a code is lost. */
export async function make(page: Gray, t: Template, read: Reader, opts: Options = {}): Promise<Made> {
  const { box, inside } = await locate(page, t, read);
  return build(page, t, box, inside, read, opts, opts.plain ? "whole" : "template");
}

async function build(page: Gray, t: Template, box: Rect, inside: Code[], read: Reader, opts: Options, layout: Layout): Promise<Made> {
  const dots = opts.dots ?? 576;
  const plain = layout === "whole";

  const build = (blank: Code[] = []): Bits[] => {
    const label = extract(page, t, box, blank, opts.solidEdge ?? true);
    return plain ? [toPrinter(label, dots)] : stacked(label, t.parts, dots, true);
  };

  let blocks = build();
  let bad = await unreadable(blocks, inside, read, dots);
  let realSize: CodeRef[] = [];
  if (bad.length) {
    // Too small once scaled: print those codes again at real size.
    realSize = bad.map(ref);
    blocks = [...build(bad), ...bad.map((c) => native(page, c, dots))];
    bad = await unreadable(blocks, inside, read, dots);
  }
  if (bad.length) throw new Refused({ kind: "unreadable", codes: bad.map(ref) });
  return { image: below(dots, blocks), layout, box, codes: inside, expected: inside.map(ref), realSize };
}

/**
 * Label with no template: find it, turn it upright and cut it into blocks
 * (see generic.ts). If a code is lost, try the whole label at paper width
 * before refusing.
 */
export async function makeAuto(page: Gray, items: TextItem[], read: Reader, opts: Options = {}): Promise<{ template: Template; made: Made }> {
  const dots = opts.dots ?? 576;
  const solidEdge = opts.solidEdge ?? true;
  const codes = await readPage(page, read);
  const { box } = findLabel(page, codes);
  const inside = insideBox(codes, box);
  const turn = upright(items, inside, box);
  const t: Template = { name: "auto", needles: [], around: [0, 0, 0, 0], rotate: turn, parts: [] };

  // Codes and blocks in the label's own pixels, and back on the page.
  const cw = box[2] - box[0], ch = box[3] - box[1];
  const { turned, ink } = trimBox(page, t, box, solidEdge);
  const [tx, ty] = ink ? [ink[0], ink[1]] : [0, 0];
  const label = extract(page, t, box, [], solidEdge);
  const toLabel = (r: Rect): Rect => {
    const [a, b, c, d] = rotateBox([r[0] - box[0], r[1] - box[1], r[2] - box[0], r[3] - box[1]], turn, cw, ch);
    return [a - tx, b - ty, c - tx, d - ty];
  };
  const toPage = (r: Rect): Rect => {
    const [a, b, c, d] = rotateBox([r[0] + tx, r[1] + ty, r[2] + tx, r[3] + ty], 360 - turn, turned.w, turned.h);
    return [a + box[0], b + box[1], c + box[0], d + box[1]];
  };
  const found = blocks(label, inside.map((c) => toLabel(c.box)), dots);
  t.parts = toParts(found, label.w, label.h);

  if (!opts.plain && t.parts.length) {
    try {
      const made = await build(page, t, box, inside, read, opts, "auto");
      return { template: t, made: { ...made, blocks: found.map((b) => toPage(b.box)) } };
    } catch (err) {
      if (!(err instanceof Refused) || err.reason.kind !== "unreadable") throw err;
    }
  }
  return { template: t, made: await build(page, t, box, inside, read, opts, "whole") };
}

/** Whole job for one rendered page: a matching template, else the automatic layout. */
export async function runLabel(
  page: Gray,
  text: string,
  read: Reader,
  opts: Options = {},
  templates = TEMPLATES,
  items: TextItem[] = [],
): Promise<{ template: Template; made: Made }> {
  const t = match(text, page.w > page.h, templates);
  if (!t) return makeAuto(page, items, read, opts);
  return { template: t, made: await make(page, t, read, opts) };
}
