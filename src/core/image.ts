/**
 * Grayscale and 1-bit images, and the handful of Pillow operations the
 * reference script uses. The resampler is a port of Pillow's Resample.c so
 * the threshold edges land on the same pixels as the Python script.
 */

/** 8-bit grayscale, 0 = black, 255 = white, row-major. */
export interface Gray {
  w: number;
  h: number;
  d: Uint8Array;
}

/** 1-bit image, one byte per pixel: 1 = black dot, 0 = white. */
export interface Bits {
  w: number;
  h: number;
  d: Uint8Array;
}

export type Rect = [number, number, number, number]; // x0, y0, x1, y1 (x1, y1 exclusive)

export function gray(w: number, h: number, fill = 255): Gray {
  const d = new Uint8Array(w * h);
  if (fill) d.fill(fill);
  return { w, h, d };
}

export function bits(w: number, h: number): Bits {
  return { w, h, d: new Uint8Array(w * h) };
}

/** Python's round(): halves go to the even neighbour. */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Pillow crop: areas outside the source come out black (0). */
export function crop(im: Gray, [x0, y0, x1, y1]: Rect): Gray {
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const out = gray(w, h, 0);
  const sx0 = Math.max(0, x0);
  const sx1 = Math.min(im.w, x1);
  if (sx1 <= sx0) return out;
  for (let y = Math.max(0, y0); y < Math.min(im.h, y1); y++) {
    const src = y * im.w;
    out.d.set(im.d.subarray(src + sx0, src + sx1), (y - y0) * w + (sx0 - x0));
  }
  return out;
}

export function copy(im: Gray): Gray {
  return { w: im.w, h: im.h, d: im.d.slice() };
}

/** Paint a rectangle (inclusive corners, like ImageDraw.rectangle), clipped to the image. */
export function fillRect(im: Gray, [x0, y0, x1, y1]: Rect, v: number): void {
  const ax = Math.max(0, Math.ceil(x0));
  const bx = Math.min(im.w - 1, Math.floor(x1));
  for (let y = Math.max(0, Math.ceil(y0)); y <= Math.min(im.h - 1, Math.floor(y1)); y++) {
    if (bx >= ax) im.d.fill(v, y * im.w + ax, y * im.w + bx + 1);
  }
}

/** Counter-clockwise rotation by a multiple of 90 degrees (Pillow transpose). */
export function rotate<T extends Gray | Bits>(im: T, degrees: number): T {
  const r = ((degrees % 360) + 360) % 360;
  if (r === 0) return { w: im.w, h: im.h, d: im.d.slice() } as T;
  const { w, h, d } = im;
  if (r === 180) {
    const o = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) o[i] = d[w * h - 1 - i];
    return { w, h, d: o } as T;
  }
  if (r !== 90 && r !== 270) throw new Error(`rotation must be a multiple of 90, got ${degrees}`);
  const o = new Uint8Array(w * h);
  // New image is h wide and w tall.
  for (let ny = 0; ny < w; ny++) {
    for (let nx = 0; nx < h; nx++) {
      // 90 CCW: new(nx, ny) = old(w-1-ny, nx). 270 CCW: new(nx, ny) = old(ny, h-1-nx).
      o[ny * h + nx] = r === 90 ? d[nx * w + (w - 1 - ny)] : d[(h - 1 - nx) * w + ny];
    }
  }
  return { w: h, h: w, d: o } as T;
}

/** Bounding box of pixels darker than `cut`, Pillow getbbox style, or null if none.
 * Within `edge` px of the border a pixel only counts when darker than `edgeCut`. */
export function inkBox(im: Gray, cut = 160, edge = 0, edgeCut = cut): Rect | null {
  let x0 = im.w, y0 = im.h, x1 = -1, y1 = -1;
  for (let y = 0; y < im.h; y++) {
    const row = y * im.w;
    const rowEdge = y < edge || y >= im.h - edge;
    let first = -1, last = -1;
    for (let x = 0; x < im.w; x++) {
      const c = rowEdge || x < edge || x >= im.w - edge ? edgeCut : cut;
      if (im.d[row + x] < c) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first >= 0) {
      if (first < x0) x0 = first;
      if (last > x1) x1 = last;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

/** 1-bit image: black where the gray value is below `cut`. */
export function threshold(im: Gray, cut: number): Bits {
  const o = new Uint8Array(im.w * im.h);
  for (let i = 0; i < o.length; i++) o[i] = im.d[i] < cut ? 1 : 0;
  return { w: im.w, h: im.h, d: o };
}

/** Copy `src` into `dst` at (x, y), clipped. */
export function paste(dst: Bits, src: Bits, x: number, y: number): void {
  for (let sy = 0; sy < src.h; sy++) {
    const dy = y + sy;
    if (dy < 0 || dy >= dst.h) continue;
    for (let sx = 0; sx < src.w; sx++) {
      const dx = x + sx;
      if (dx >= 0 && dx < dst.w) dst.d[dy * dst.w + dx] = src.d[sy * src.w + sx];
    }
  }
}

/** Stack images of the same width top to bottom. */
export function below(width: number, imgs: Bits[]): Bits {
  const out = bits(width, imgs.reduce((s, i) => s + i.h, 0));
  let y = 0;
  for (const i of imgs) {
    paste(out, i, 0, y);
    y += i.h;
  }
  return out;
}

/** White strip `width` wide with `im` centred and `margin` px above and below. */
export function centred(im: Bits, width: number, margin = 8): Bits {
  const out = bits(width, im.h + 2 * margin);
  paste(out, im, Math.floor((width - im.w) / 2), margin);
  return out;
}

/** RGBA pixels for a canvas or the barcode reader (black = 0, white = 255). */
export function toRGBA(im: Gray | Bits, isBits: boolean): Uint8ClampedArray<ArrayBuffer> {
  const o = new Uint8ClampedArray(im.w * im.h * 4);
  for (let i = 0; i < im.w * im.h; i++) {
    const v = isBits ? (im.d[i] ? 0 : 255) : im.d[i];
    o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = v;
    o[i * 4 + 3] = 255;
  }
  return o;
}

export function bitsToGray(b: Bits): Gray {
  const d = new Uint8Array(b.w * b.h);
  for (let i = 0; i < d.length; i++) d[i] = b.d[i] ? 0 : 255;
  return { w: b.w, h: b.h, d };
}

// ---------------------------------------------------------------------------
// Resampling, ported from Pillow's src/libImaging/Resample.c (8 bits per channel).

interface Filter {
  support: number;
  fn: (x: number) => number;
}

function sinc(x: number): number {
  if (x === 0) return 1;
  x *= Math.PI;
  return Math.sin(x) / x;
}

export const LANCZOS: Filter = {
  support: 3,
  fn: (x) => (x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0),
};

export const BOX: Filter = {
  support: 0.5,
  fn: (x) => (x > -0.5 && x <= 0.5 ? 1 : 0),
};

const PRECISION_BITS = 32 - 8 - 2;

interface Coeffs {
  ksize: number;
  bounds: Int32Array; // xmin, count per output pixel
  kk: Int32Array; // fixed-point weights
}

function precompute(inSize: number, in0: number, in1: number, outSize: number, f: Filter): Coeffs {
  const scale = (in1 - in0) / outSize;
  const filterscale = Math.max(1, scale);
  const support = f.support * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const pre = new Float64Array(outSize * ksize);
  const bounds = new Int32Array(outSize * 2);
  const ss = 1 / filterscale;
  for (let xx = 0; xx < outSize; xx++) {
    const center = in0 + (xx + 0.5) * scale;
    let ww = 0;
    let xmin = Math.trunc(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;
    const k = xx * ksize;
    for (let x = 0; x < xmax; x++) {
      const w = f.fn((x + xmin - center + 0.5) * ss);
      pre[k + x] = w;
      ww += w;
    }
    for (let x = 0; x < xmax; x++) if (ww !== 0) pre[k + x] /= ww;
    bounds[xx * 2] = xmin;
    bounds[xx * 2 + 1] = xmax;
  }
  const kk = new Int32Array(pre.length);
  const one = 1 << PRECISION_BITS;
  for (let i = 0; i < pre.length; i++) {
    kk[i] = pre[i] < 0 ? Math.trunc(-0.5 + pre[i] * one) : Math.trunc(0.5 + pre[i] * one);
  }
  return { ksize, bounds, kk };
}

function clip8(v: number): number {
  if (v >= 1 << PRECISION_BITS << 8) return 255;
  if (v <= 0) return 0;
  return v >> PRECISION_BITS;
}

const HALF = 1 << (PRECISION_BITS - 1);

/** Pillow Image.resize((w, h), filter) for mode "L" with the default box. */
export function resize(im: Gray, w: number, h: number, f: Filter = LANCZOS): Gray {
  if (w === im.w && h === im.h) return copy(im);
  const needH = w !== im.w;
  const needV = h !== im.h;
  const hc = precompute(im.w, 0, im.w, w, f);
  const vc = precompute(im.h, 0, im.h, h, f);
  const yFirst = vc.bounds[0];
  const yLast = vc.bounds[h * 2 - 2] + vc.bounds[h * 2 - 1];
  let src = im;
  let vb = vc.bounds;
  if (needH) {
    vb = vc.bounds.slice();
    for (let i = 0; i < h; i++) vb[i * 2] -= yFirst;
    const tmp = gray(w, yLast - yFirst, 0);
    const { ksize, bounds, kk } = hc;
    for (let yy = 0; yy < tmp.h; yy++) {
      const row = (yy + yFirst) * im.w;
      for (let xx = 0; xx < w; xx++) {
        const xmin = bounds[xx * 2];
        const xmax = bounds[xx * 2 + 1];
        const k = xx * ksize;
        let ss0 = HALF;
        for (let x = 0; x < xmax; x++) ss0 += im.d[row + x + xmin] * kk[k + x];
        tmp.d[yy * w + xx] = clip8(ss0);
      }
    }
    src = tmp;
  }
  if (!needV) return src === im ? copy(im) : src;
  const out = gray(w, h, 0);
  const { ksize, kk } = vc;
  for (let yy = 0; yy < h; yy++) {
    const ymin = vb[yy * 2];
    const ymax = vb[yy * 2 + 1];
    const k = yy * ksize;
    for (let xx = 0; xx < w; xx++) {
      let ss0 = HALF;
      for (let y = 0; y < ymax; y++) ss0 += src.d[(y + ymin) * w + xx] * kk[k + y];
      out.d[yy * w + xx] = clip8(ss0);
    }
  }
  return out;
}
