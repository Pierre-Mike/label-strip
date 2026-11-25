import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { escposRaster, zplRaster } from "../src/core/printers";
import { bits } from "../src/core/image";

const snap = (name: string) => new Uint8Array(readFileSync(new URL(`./snapshots/${name}`, import.meta.url)));

/** Same pattern as the Python script that wrote the snapshots (see test/README.md). */
function pattern() {
  const w = 104, h = 2100;
  const b = bits(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || x === y % w || ((Math.floor(x / 7) + Math.floor(y / 5)) % 3 === 0 && y > 1500))
        b.d[y * w + x] = 1;
  return b;
}

describe("printer bytes match print_label.py", () => {
  it("ZPL, default left offset", () => expect(zplRaster(pattern(), 100)).toEqual(snap("zpl-104x2100-left100.zpl")));
  it("ZPL, custom left offset", () => expect(zplRaster(pattern(), 37)).toEqual(snap("zpl-104x2100-left37.zpl")));
  it("ESC/POS", () => expect(escposRaster(pattern())).toEqual(snap("escpos-104x2100.bin")));
  it("ZPL splits labels taller than 7900 rows", () => {
    const z = zplRaster(bits(576, 8000), 100);
    expect(createHash("sha256").update(z).digest("hex")).toBe(readFileSync(new URL("./snapshots/zpl-576x8000-left100.sha256", import.meta.url), "utf8").trim());
    expect(new TextDecoder().decode(z).match(/\^XA/g)?.length).toBe(2);
  });
});
