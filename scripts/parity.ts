/**
 * Parity check against print_label.py on private fixtures (local only).
 *   bun scripts/parity.ts [--pdfjs] [files...]
 * For each label: the Python preview (made by the script, next to the input)
 * vs this pipeline on the same page. By default the page is rendered with
 * pdftoppm, like the script, to test the port alone; --pdfjs renders it with
 * pdf.js, like the web app.
 */
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { initZXing, read } from "../src/core/zxing";
import { runLabel, Refused } from "../src/core/pipeline";
import { collect } from "../src/core/inputs";
import type { Gray, Bits } from "../src/core/image";
import { renderPdf } from "./node-render";

initZXing({ binary: readFileSync("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm").buffer as ArrayBuffer });

const args = process.argv.slice(2);
const usePdfjs = args.includes("--pdfjs");
const dir = "fixtures/private";
const files = args.filter((a) => !a.startsWith("--"));
const inputs = (files.length ? files : readdirSync(dir).filter((f) => /\.(pdf|eml)$/i.test(f)).map((f) => join(dir, f)))
  .map((p) => ({ name: basename(p), bytes: new Uint8Array(readFileSync(p)) }));

async function pngGray(path: string): Promise<Gray> {
  const img = await loadImage(readFileSync(path));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const rgba = ctx.getImageData(0, 0, img.width, img.height).data;
  const d = new Uint8Array(img.width * img.height);
  for (let i = 0; i < d.length; i++) d[i] = rgba[i * 4];
  return { w: img.width, h: img.height, d };
}

function popplerPage(pdf: string): { page: Gray; text: string } {
  const tmp = mkdtempSync(join(tmpdir(), "parity-"));
  execFileSync("pdftoppm", ["-r", "406", "-gray", "-singlefile", "-f", "1", "-l", "1", pdf, join(tmp, "p")]);
  const buf = readFileSync(join(tmp, "p.pgm"));
  // P5\n<w> <h>\n255\n<data>
  let i = 0, fields: string[] = [];
  while (fields.length < 4) {
    let s = "";
    while (buf[i] === 0x20 || buf[i] === 0x0a) i++;
    while (buf[i] !== 0x20 && buf[i] !== 0x0a) s += String.fromCharCode(buf[i++]);
    fields.push(s);
  }
  i++;
  const w = +fields[1], h = +fields[2];
  const text = execFileSync("pdftotext", ["-l", "1", pdf, "-"]).toString();
  return { page: { w, h, d: new Uint8Array(buf.subarray(i, i + w * h)) }, text };
}

function diff(a: Bits, b: Gray): number {
  const w = Math.max(a.w, b.w), h = Math.max(a.h, b.h);
  let n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const pa = x < a.w && y < a.h ? a.d[y * a.w + x] : 0;
      const pb = x < b.w && y < b.h ? (b.d[y * b.w + x] < 128 ? 1 : 0) : 0;
      if (pa !== pb) n++;
    }
  return n / (w * h);
}

const tmp = mkdtempSync(join(tmpdir(), "parity-pdf-"));
const { pdfs } = await collect(inputs);
let worst = 0;
for (const f of pdfs) {
  const stem = f.name.replace(/\.pdf$/i, "");
  const ref = join(dir, `${stem}-preview.png`);
  const path = join(tmp, f.name);
  writeFileSync(path, f.bytes);
  const { page, text } = usePdfjs ? await renderPdf(f.bytes) : popplerPage(path);
  try {
    const t0 = performance.now();
    const { template, made } = await runLabel(page, text, read, { solidEdge: usePdfjs });
    const ms = Math.round(performance.now() - t0);
    const mine = join(tmp, `${stem}-js.png`);
    const c = createCanvas(made.image.w, made.image.h);
    const ctx = c.getContext("2d");
    const id = ctx.createImageData(made.image.w, made.image.h);
    for (let i = 0; i < made.image.d.length; i++) {
      const v = made.image.d[i] ? 0 : 255;
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    writeFileSync(mine, c.toBuffer("image/png"));
    let line = `${f.name}: ${template.name}, ${(made.image.h / 8).toFixed(0)} mm, ${made.expected.length} codes OK${made.realSize.length ? `, ${made.realSize.length} at real size` : ""}, ${ms} ms`;
    if (existsSync(ref)) {
      const r = await pngGray(ref);
      const dd = diff(made.image, r);
      worst = Math.max(worst, dd);
      line += ` | python ${r.h} rows vs js ${made.image.h} | diff ${(dd * 100).toFixed(3)}%${dd > 0.005 ? "  <-- CHECK" : ""}`;
    }
    console.log(line, "->", mine);
  } catch (e) {
    if (e instanceof Refused) console.log(`${f.name}: REFUSED ${JSON.stringify(e.reason)}`);
    else throw e;
  }
}
console.log(`worst diff ${(worst * 100).toFixed(3)}%`);
