/** Render page 1 of a PDF to 406 dpi grayscale with pdf.js, and read its text. */
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { RENDER_DPI } from "./core/pipeline";
import { pageText, rgbaToGray, textItems, type TextItem } from "./core/pdftext";
import type { Gray } from "./core/image";

GlobalWorkerOptions.workerSrc = workerUrl;

// Fonts, character maps and decoders come from this site (copied by scripts/copy-pdfjs-assets.mjs).
const assets = new URL("pdfjs/", document.baseURI).href;

export interface Rendered {
  page: Gray;
  text: string;
  items: TextItem[];
}

export async function renderPdf(bytes: Uint8Array): Promise<Rendered> {
  const task = getDocument({
    data: bytes.slice(),
    standardFontDataUrl: assets + "standard_fonts/",
    cMapUrl: assets + "cmaps/",
    cMapPacked: true,
    wasmUrl: assets + "wasm/",
    iccUrl: assets + "iccs/",
    enableXfa: false,
  });
  try {
    const doc = await task.promise;
    const p = await doc.getPage(1);
    const vp = p.getViewport({ scale: RENDER_DPI / 72 });
    const w = Math.round(vp.width), h = Math.round(vp.height);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    await p.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    const content = await p.getTextContent();
    const text = pageText(content);
    const items = textItems(content, vp.transform);
    const page = rgbaToGray(ctx.getImageData(0, 0, w, h).data, w, h);
    canvas.width = canvas.height = 0; // free the canvas memory now
    return { page, text, items };
  } finally {
    await task.destroy();
  }
}
