/**
 * Barcode reading with zxing-cpp compiled to WebAssembly. The .wasm file is
 * served from this site (or read from disk in Node), never from a CDN.
 */
import { prepareZXingModule, readBarcodes, type ReadResult } from "zxing-wasm/reader";
import type { Gray } from "./image";
import type { Code, Reader } from "./pipeline";

/** Point the module at a local wasm: a URL in the browser, or its bytes in Node. */
export function initZXing(wasm: { url?: string; binary?: ArrayBuffer }): void {
  prepareZXingModule({
    overrides: wasm.binary
      ? { wasmBinary: wasm.binary }
      : { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") && wasm.url ? wasm.url : prefix + path) },
  });
}

function toCode(r: ReadResult): Code {
  const p = r.position;
  const xs = [p.topLeft.x, p.topRight.x, p.bottomLeft.x, p.bottomRight.x];
  const ys = [p.topLeft.y, p.topRight.y, p.bottomLeft.y, p.bottomRight.y];
  return { text: r.text, format: r.format, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

/** Same settings as zxingcpp.read_barcodes in the Python script (its defaults). */
export const read: Reader = async (im: Gray) => {
  const rgba = new Uint8ClampedArray(im.w * im.h * 4);
  for (let i = 0, j = 0; i < im.d.length; i++, j += 4) {
    const v = im.d[i];
    rgba[j] = rgba[j + 1] = rgba[j + 2] = v;
    rgba[j + 3] = 255;
  }
  const results = await readBarcodes({ width: im.w, height: im.h, data: rgba } as ImageData, {
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    maxNumberOfSymbols: 255,
  });
  return results.filter((r) => r.isValid).map(toCode);
};
