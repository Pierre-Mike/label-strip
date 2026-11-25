/** Print-ready PDF fallback: one page per label, exactly as wide as the roll, at 203 dpi, no margins. */
import { PDFDocument } from "pdf-lib";
import type { Bits } from "./core/image";
import { toPng } from "./preview";

const PT_PER_DOT = 72 / 203;
const MM = 72 / 25.4;

export async function labelsPdf(labels: Bits[], paperMm: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Étiquettes thermiques");
  doc.setProducer("label-strip");
  doc.setCreator("label-strip");
  for (const img of labels) {
    const png = await doc.embedPng(await toPng(img));
    const w = paperMm * MM;
    const h = img.h * PT_PER_DOT;
    const page = doc.addPage([w, h]);
    const iw = img.w * PT_PER_DOT;
    page.drawImage(png, { x: (w - iw) / 2, y: 0, width: iw, height: h });
  }
  return doc.save();
}

/**
 * Shows the PDF in the browser's own viewer, which has a print button, instead of saving it.
 * Call `blankTab()` synchronously in the click handler: a tab opened after an await gets blocked.
 */
export function blankTab(message: string): Window | null {
  const tab = window.open("", "_blank");
  if (tab) {
    tab.document.title = message;
    tab.document.body.textContent = message;
  }
  return tab;
}

export function showPdf(tab: Window | null, bytes: Uint8Array, name: string): void {
  if (!tab || tab.closed) {
    download(bytes, name);
    return;
  }
  // Not revoked: the viewer may read the blob again when the user prints or saves.
  tab.location.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
}

export function download(bytes: Uint8Array, name: string, type = "application/pdf"): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
