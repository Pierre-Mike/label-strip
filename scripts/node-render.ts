/** Render page 1 with pdf.js in Node, the same way the browser does (src/render.ts). */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { pageText, rgbaToGray } from "../src/core/pdftext";
import { RENDER_DPI } from "../src/core/pipeline";
import type { Gray } from "../src/core/image";

export async function renderPdf(bytes: Uint8Array): Promise<{ page: Gray; text: string }> {
  const task = getDocument({
    data: bytes.slice(),
    standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/",
    cMapUrl: "node_modules/pdfjs-dist/cmaps/",
    cMapPacked: true,
  });
  const doc = await task.promise;
  const p = await doc.getPage(1);
  const vp = p.getViewport({ scale: RENDER_DPI / 72 });
  const w = Math.round(vp.width), h = Math.round(vp.height);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  await p.render({ canvas: canvas as never, canvasContext: ctx as never, viewport: vp }).promise;
  const text = pageText(await p.getTextContent());
  const rgba = ctx.getImageData(0, 0, w, h).data;
  await task.destroy();
  return { page: rgbaToGray(rgba, w, h), text };
}
