/** Run labels through the automatic layout only (templates off) and print what it found.
 *   bun scripts/try-auto.ts [files…]   (default: fixtures/synthetic/*.pdf) */
import { readFileSync, readdirSync } from "node:fs";
import { initZXing, read } from "../src/core/zxing";
import { runLabel, Refused, TEMPLATES } from "../src/core/pipeline";
import { findLabel } from "../src/core/generic";
import { renderPdf } from "./node-render";
import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync, mkdirSync } from "node:fs";
import { toRGBA, type Bits } from "../src/core/image";

const outAt = process.argv.indexOf("--out");
const outDir = outAt > 0 ? process.argv.splice(outAt, 2)[1] : "";
function savePng(img: Bits, path: string) {
  const c = createCanvas(img.w, img.h);
  const ctx = c.getContext("2d"); const id = ctx.createImageData(img.w, img.h); id.data.set(toRGBA(img, true)); ctx.putImageData(id, 0, 0);
  writeFileSync(path, c.toBuffer("image/png"));
}

initZXing({ binary: readFileSync("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm").buffer as ArrayBuffer });
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync("fixtures/synthetic").filter((f) => f.endsWith(".pdf")).map((f) => `fixtures/synthetic/${f}`);
for (const f of files) {
  const { page, text, items } = await renderPdf(new Uint8Array(readFileSync(f)));
  const name = f.split("/").pop()!.replace(/\.pdf$/, "");
  const want = TEMPLATES.find((t) => t.name === name);
  try {
    const codes = await read(page);
    const how = codes.length ? findLabel(page, codes).how : "-";
    const { template, made } = await runLabel(page, text, read, {}, [], items);
    console.log(
      name.padEnd(22), made.layout.padEnd(6), how.padEnd(7),
      `turn ${template.rotate}${want ? ` (template ${want.rotate ?? 0})` : ""}`.padEnd(22),
      `${template.parts.length} blocks`.padEnd(10), `${made.expected.length} codes`, `${Math.round(made.image.h / 8)} mm`,
      made.realSize.length ? `realSize ${made.realSize.length}` : "",
      codes.map((c) => `${c.format}@${c.angle}`).join(" "),
    );
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      savePng(made.image, `${outDir}/${name}.png`);
    }
  } catch (e) {
    console.log(name.padEnd(22), "REFUSED", e instanceof Refused ? JSON.stringify(e.reason) : e);
  }
}
