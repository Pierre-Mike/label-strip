import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BOX, LANCZOS, resize, rotate, pyRound, crop, inkBox, type Gray } from "../src/core/image";

const ref = JSON.parse(readFileSync(new URL("./snapshots/pillow-resize.json", import.meta.url), "utf8"));
const src: Gray = { w: ref.w, h: ref.h, d: Uint8Array.from(ref.src) };

describe("resize matches Pillow byte for byte", () => {
  for (const c of ref.cases) {
    it(`${c.filter} ${ref.w}x${ref.h} -> ${c.w}x${c.h}`, () => {
      const out = resize(src, c.w, c.h, c.filter === "BOX" ? BOX : LANCZOS);
      expect([out.w, out.h]).toEqual([c.w, c.h]);
      expect(Array.from(out.d)).toEqual(c.data);
    });
  }
});

describe("image helpers", () => {
  it("rotate 90 matches Pillow rotate(90, expand=True)", () => {
    const r = rotate(src, 90);
    expect([r.w, r.h]).toEqual([ref.rot90.w, ref.rot90.h]);
    expect(Array.from(r.d)).toEqual(ref.rot90.data);
  });
  it("rotate 270 then 90 is the identity", () => {
    expect(Array.from(rotate(rotate(src, 270), 90).d)).toEqual(Array.from(src.d));
  });
  it("pyRound rounds halves to even like Python", () => {
    expect([0.5, 1.5, 2.5, -0.5, 2.4, 2.6].map(pyRound)).toEqual([0, 2, 2, 0, 2, 3]);
  });
  it("crop outside the image is black, like Pillow", () => {
    const c = crop({ w: 2, h: 2, d: Uint8Array.of(255, 255, 255, 255) }, [-1, -1, 2, 2]);
    expect(Array.from(c.d)).toEqual([0, 0, 0, 0, 255, 255, 0, 255, 255]);
  });
  it("inkBox finds the dark pixels and can ignore gray at the border", () => {
    const g: Gray = { w: 5, h: 5, d: new Uint8Array(25).fill(255) };
    g.d[2 * 5 + 2] = 0;
    g.d[4] = 140; // gray at the top-right corner
    expect(inkBox(g, 160)).toEqual([2, 0, 5, 3]);
    expect(inkBox(g, 160, 1, 96)).toEqual([2, 2, 3, 3]);
  });
});
