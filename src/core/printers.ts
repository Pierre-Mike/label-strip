/** Printer languages: ZPL for Zebra label printers, ESC/POS for receipt printers. */
import type { Bits } from "./image";

const enc = new TextEncoder();

/** Rows packed MSB first, bit 1 = print a dot, rows padded to whole bytes. */
export function pack(img: Bits, y0 = 0, y1 = img.h): Uint8Array {
  const rowBytes = (img.w + 7) >> 3;
  const out = new Uint8Array(rowBytes * (y1 - y0));
  for (let y = y0; y < y1; y++) {
    const o = (y - y0) * rowBytes;
    for (let x = 0; x < img.w; x++) if (img.d[y * img.w + x]) out[o + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

/** ESC @, GS v 0 raster in bands of 128 rows so the buffer never overflows, then feed and partial cut. */
export function escposRaster(img: Bits): Uint8Array {
  const rowBytes = (img.w + 7) >> 3;
  const parts: Uint8Array[] = [Uint8Array.of(0x1b, 0x40)];
  for (let y0 = 0; y0 < img.h; y0 += 128) {
    const y1 = Math.min(y0 + 128, img.h);
    const bh = y1 - y0;
    parts.push(Uint8Array.of(0x1d, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, bh & 0xff, bh >> 8));
    parts.push(pack(img, y0, y1));
  }
  parts.push(Uint8Array.of(0x0a, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00));
  return concat(parts);
}

export const ZPL_HEAD = 832; // dots across a 4-inch, 203 dpi Zebra head (ZD421 and similar)
export const ZPL_PAPER = 635; // printable width of an 80 mm roll on that head, in dots
export const ZPL_MAX_LL = 7900; // longest label the ZD421 takes in one format (about 39 in)
export const ZPL_LEFT = 100; // head dot where an 80 mm roll starts on the ZD421

const HEX = "0123456789ABCDEF";

function hex(data: Uint8Array): string {
  let s = "";
  for (const b of data) s += HEX[b >> 4] + HEX[b & 15];
  return s;
}

/** ZPL ^GFA graphic for a Zebra on continuous paper. ^PW stays at the full head
 * width: a narrower ^PW trims both sides and shifts the image right. Labels
 * longer than one format allows go out as several formats. */
export function zplRaster(img: Bits, left = ZPL_LEFT): Uint8Array {
  const x = left + Math.max(0, Math.floor((ZPL_PAPER - img.w) / 2));
  const rowBytes = (img.w + 7) >> 3;
  let out = "";
  for (let y0 = 0; y0 < img.h; y0 += ZPL_MAX_LL) {
    const ph = Math.min(y0 + ZPL_MAX_LL, img.h) - y0;
    out += `^XA^MNN^LH0,0^PW${ZPL_HEAD}^LL${ph + 40}\n`;
    for (let b0 = 0; b0 < ph; b0 += 1024) {
      const data = pack(img, y0 + b0, y0 + Math.min(b0 + 1024, ph));
      out += `^FO${x},${b0}^GFA,${data.length},${data.length},${rowBytes},${hex(data)}^FS\n`;
    }
    out += "^XZ\n";
  }
  return enc.encode(out);
}

/** One-time Zebra setup: direct thermal (no ribbon), then resume if paused. */
export const ZEBRA_SETUP = enc.encode('! U1 setvar "ezpl.print_method" "direct thermal"\r\n~PS\r\n');
