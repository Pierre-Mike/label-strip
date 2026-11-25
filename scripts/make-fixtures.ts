/**
 * Synthetic label PDFs, one per carrier template, plus the refusal cases.
 *   bun scripts/make-fixtures.ts
 * Every name and address is made up and every code is generated here, so the
 * files are safe to commit. Each code sits inside a code block of its
 * template and the biggest one sits where the template expects the anchor.
 * The PDF holds the label as an image and the template's phrases as text.
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { createCanvas, type SKRSContext2D, type Canvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";
import { TEMPLATES, RENDER_DPI, type Template } from "../src/core/pipeline";

prepareZXingModule({
  overrides: { wasmBinary: readFileSync("node_modules/zxing-wasm/dist/writer/zxing_writer.wasm").buffer as ArrayBuffer },
});

const PX = RENDER_DPI / 25.4; // pixels per mm
const PT = 72 / 25.4; // PDF points per mm
const A4 = [210, 297];
const FRAME = 1; // mm between the crop box and the drawn border

type Format = "QRCode" | "Code128" | "DataMatrix";

async function symbol(text: string, format: Format) {
  const r = await writeBarcode(text, { format, addQuietZones: false, scale: 1 });
  if (r.error) throw new Error(r.error);
  const s = r.symbol;
  // Linear codes come out 50 modules tall: keep one row and let the caller set the height.
  return { w: s.width, h: format === "Code128" ? 1 : s.height, data: s.data, linear: format === "Code128" };
}

/** Draw a code with its top-left at (x, y) px, `module` px per module; linear codes get `barH` px of height. */
async function drawCode(ctx: SKRSContext2D, text: string, format: Format, x: number, y: number, module: number, barH = 0) {
  const s = await symbol(text, format);
  ctx.fillStyle = "#000";
  for (let my = 0; my < s.h; my++)
    for (let mx = 0; mx < s.w; mx++)
      if (s.data[my * s.w + mx] === 0) ctx.fillRect(x + mx * module, y + my * module, module, s.linear ? barH : module);
  return { w: s.w * module, h: s.linear ? barH : s.h * module };
}

async function codeSize(text: string, format: Format) {
  const s = await symbol(text, format);
  return { w: s.w, h: s.h };
}

const TEXT = [
  ["Camille EXEMPLE", "12 rue de l'Exemple", "75000 PARIS", "FRANCE"],
  ["Dominique TEST", "3 allée des Essais", "69000 LYON"],
  ["ROUTAGE 2B-75", "TRI 0042", "J+2"],
  ["Colis 1/1  0,8 kg", "Réf. 0000-TEST", "Ne pas utiliser"],
];

function drawText(ctx: SKRSContext2D, lines: string[], x: number, y: number, w: number, h: number) {
  const size = Math.min(h / (lines.length * 1.35), (w / 16) * 1.1);
  ctx.fillStyle = "#000";
  ctx.font = `bold ${Math.round(size)}px Helvetica, Arial, sans-serif`;
  ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, x + size * 0.3, y + size * 0.2 + i * size * 1.35, w - size * 0.6));
}

interface Extra {
  /** Code added outside the template's blocks, in page mm from the crop box's top-left (unrotated). */
  straddle?: boolean;
  dense?: boolean; // add a dense Code128 that only reads at real size
  noCodes?: boolean;
  needles?: string[];
  noFrame?: boolean; // no border around the label
  corner?: boolean; // label in the page's top-left corner instead of centred
  clutter?: boolean; // instructions printed on the page around the label
}

async function labelCanvas(t: Template, extra: Extra) {
  const [dx0, dy0, dx1, dy1] = t.around;
  const wc = dx1 - dx0, hc = dy1 - dy0; // crop box on the page, mm
  const rot = t.rotate ?? 0;
  const [wu, hu] = rot % 180 ? [hc, wc] : [wc, hc]; // upright label, mm
  const anchor = rot === 90 ? [-dy0, dx1] : [-dx0, -dy0]; // anchor centre, upright mm
  const U = createCanvas(Math.round(wu * PX), Math.round(hu * PX));
  const ctx = U.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, U.width, U.height);
  // Border: the trimmed label is this rectangle, so part fractions refer to it.
  const fx0 = FRAME, fy0 = FRAME, fw = wu - 2 * FRAME, fh = hu - 2 * FRAME;
  if (!extra.noFrame) {
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 0.4 * PX;
    ctx.strokeRect((fx0 + 0.2) * PX, (fy0 + 0.2) * PX, (fw - 0.4) * PX, (fh - 0.4) * PX);
  }

  const partMm = (b: number[]) => [fx0 + b[0] * fw, fy0 + b[1] * fh, fx0 + b[2] * fw, fy0 + b[3] * fh];
  const inPart = (b: number[], p: number[]) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
  const anchorPart = t.parts.findIndex(([b, , code]) => code && inPart(partMm(b), anchor));
  let anchorSide = 0;
  let textIdx = 0;
  let n = 0;
  for (const [i, [b, , isCode]] of t.parts.entries()) {
    const [x0, y0, x1, y1] = partMm(b);
    const pw = x1 - x0, ph = y1 - y0;
    if (!isCode) {
      drawText(ctx, TEXT[textIdx++ % TEXT.length], (x0 + 1) * PX, (y0 + 1) * PX, (pw - 2) * PX, (ph - 2) * PX);
      continue;
    }
    if (extra.noCodes) continue;
    const text = `TEST${String(++n).padStart(2, "0")}${t.name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6)}0042`;
    const isAnchor = i === anchorPart;
    // Centre on the anchor for the anchor block, else on the block's centre.
    const [cx, cy] = isAnchor ? anchor : [(x0 + x1) / 2, (y0 + y1) / 2];
    const room = { w: 2 * Math.min(cx - x0, x1 - cx) - 3, h: 2 * Math.min(cy - y0, y1 - cy) - 3 };
    const linear = room.w / room.h > 1.8;
    const format: Format = linear ? "Code128" : "QRCode";
    const size = await codeSize(text, format);
    // Module size in px: 0.5 mm for QR, 0.38 mm for Code128, shrunk to fit.
    let module = Math.round((linear ? 0.38 : 0.5) * PX);
    module = Math.max(2, Math.min(module, Math.floor((room.w * PX) / size.w), linear ? 99 : Math.floor((room.h * PX) / size.h)));
    if (!isAnchor && anchorSide) {
      // Keep every other code smaller than the anchor.
      while (module > 2 && (size.w * module) * (linear ? Math.min(room.h, 14) * PX : size.h * module) >= anchorSide * 0.8) module--;
    }
    const barH = Math.min(room.h, 14) * PX;
    const w = size.w * module, h = linear ? barH : size.h * module;
    const drawn = await drawCode(ctx, text, format, cx * PX - w / 2, cy * PX - h / 2, module, barH);
    if (isAnchor) anchorSide = drawn.w * drawn.h;
  }
  if (anchorPart < 0 && !extra.noCodes) throw new Error(`${t.name}: no code block holds the anchor at ${anchor}`);
  if (extra.dense) {
    // A long, dense Code128 in the last block: 2 px modules at 406 dpi read
    // once halved to real size, but not once the block is shrunk to fit.
    const [x0, y0, x1, y1] = partMm(t.parts[t.parts.length - 1][0]);
    const text = "DENSE-0000000000-TEST-0000000000";
    const size = await codeSize(text, "Code128");
    const w = size.w * 2;
    await drawCode(ctx, text, "Code128", ((x0 + x1) / 2) * PX - w / 2, (y1 - 20) * PX, 2, 10 * PX);
  }
  // Turn the upright label back the way it lies on the page.
  let C: Canvas = U;
  if (rot) {
    C = createCanvas(Math.round(wc * PX), Math.round(hc * PX));
    const c = C.getContext("2d");
    c.translate(C.width, 0);
    c.rotate(Math.PI / 2);
    c.drawImage(U, 0, 0);
  }
  return { canvas: C, wc, hc };
}

async function makePdf(t: Template, extra: Extra = {}): Promise<Uint8Array> {
  const landscape = t.landscape === true;
  const [pw, ph] = landscape ? [A4[1], A4[0]] : A4;
  const { canvas, wc, hc } = await labelCanvas(t, extra);
  // Crop box on the page: centred, leaving 12 mm at the top for the carrier's phrases.
  const bx = extra.corner ? 10 : Math.max(0, (pw - wc) / 2);
  const by = extra.corner ? 12 : Math.min(ph - hc, Math.max(12, (ph - hc) / 2));
  const page = createCanvas(Math.round(pw * PX), Math.round(ph * PX));
  const p = page.getContext("2d");
  p.fillStyle = "#fff";
  p.fillRect(0, 0, page.width, page.height);
  p.drawImage(canvas, Math.round(bx * PX), Math.round(by * PX));
  if (extra.clutter) {
    // Sender instructions well away from the label, as on an A4 label sheet.
    const lines = ["Pliez la feuille en deux", "Collez l'étiquette sur le colis", "Conservez ce reçu"];
    const below = by + hc + 25;
    if (below + 40 < ph) drawText(p, lines, 15 * PX, below * PX, 120 * PX, 30 * PX);
    if (by > 60) drawText(p, lines, 15 * PX, 15 * PX, 120 * PX, 30 * PX);
  }
  if (extra.straddle) {
    // A small QR code across the right edge of the label box.
    await drawCode(p, "STRADDLE-TEST", "QRCode", Math.round((bx + wc - 5) * PX), Math.round((by + hc / 2) * PX), 6);
  }
  const doc = await PDFDocument.create();
  doc.setTitle("Synthetic test label");
  doc.setCreator("label-strip make-fixtures");
  doc.setProducer("label-strip");
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const pg = doc.addPage([pw * PT, ph * PT]);
  const png = await doc.embedPng(page.toBuffer("image/png"));
  pg.drawImage(png, { x: 0, y: 0, width: pw * PT, height: ph * PT });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const needles = extra.needles ?? t.needles;
  pg.drawText(`${needles.join(" - ")} - étiquette de test, données fictives`, {
    x: 8 * PT, y: (ph - 7) * PT, size: 9, font, color: rgb(0, 0, 0),
  });
  return doc.save({ useObjectStreams: false });
}

mkdirSync("fixtures/synthetic", { recursive: true });
for (const t of TEMPLATES) {
  writeFileSync(`fixtures/synthetic/${t.name}.pdf`, await makePdf(t));
  console.log("wrote", t.name);
}
const byName = (n: string) => TEMPLATES.find((t) => t.name === n)!;
// Carriers no template knows: the automatic layout must print them.
const unknown = (name: string, around: Template["around"], parts: Template["parts"], rotate = 0): Template =>
  ({ name, needles: ["Transporteur Exemple"], around, rotate, parts });
writeFileSync("fixtures/synthetic/auto-a6-sideways.pdf", await makePdf(unknown("auto-a6-sideways", [-86.8, -50, 58.2, 50], [
  [[0, 0, 1, 0.25], 2, false],
  [[0, 0.3, 1, 0.5], 2, true],
  [[0, 0.55, 0.6, 0.8], 2, false],
  [[0.6, 0.55, 1, 0.8], 2, true],
  [[0, 0.85, 1, 1], 2, false],
], 90)));
writeFileSync("fixtures/synthetic/auto-corner.pdf", await makePdf(unknown("auto-corner", [-75, -62.25, 75, 37.75], [
  [[0, 0, 0.55, 0.45], 2, false],
  [[0.55, 0, 1, 0.45], 2, true],
  [[0, 0.5, 1, 0.75], 2, true],
  [[0, 0.8, 1, 1], 2, false],
]), { corner: true, clutter: true }));
writeFileSync("fixtures/synthetic/auto-qr-only.pdf", await makePdf(unknown("auto-qr-only", [-35, -35.3, 35, 39.7], [
  [[0, 0, 1, 0.3], 2, false],
  [[0.25, 0.32, 0.75, 0.62], 2, true],
  [[0, 0.62, 1, 0.95], 2, false],
]), { noFrame: true, clutter: true }));
writeFileSync("fixtures/synthetic/refuse-no-code.pdf", await makePdf(byName("colissimo"), { noCodes: true }));
writeFileSync("fixtures/synthetic/refuse-crop-cuts.pdf", await makePdf(byName("colissimo"), { straddle: true }));
writeFileSync("fixtures/synthetic/refuse-unreadable.pdf", await makePdf(byName("mondial-relay"), { dense: true }));
mkdirSync("public", { recursive: true });
copyFileSync("fixtures/synthetic/colissimo.pdf", "public/sample.pdf");
console.log("wrote refusal cases and public/sample.pdf");
