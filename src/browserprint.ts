/**
 * Prints labels through the browser's print dialog, from a hidden frame, without opening a tab.
 * Each label is a page exactly as wide as the roll and as long as the label, with no margins.
 * Browsers always show their print dialog: a web page can't print silently.
 */
import type { Bits } from "./core/image";
import { toPng } from "./preview";

const mm = (dots: number) => (dots / 203) * 25.4;

export async function printInBrowser(labels: Bits[], paperMm: number): Promise<void> {
  const urls = await Promise.all(labels.map(async (img) => URL.createObjectURL(new Blob([(await toPng(img)) as BlobPart], { type: "image/png" }))));

  // An about:blank frame filled through the DOM: no navigation, so the page's CSP needs no frame-src.
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  // Off screen rather than display:none, which makes Safari print an empty page.
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;";
  document.body.append(frame);
  const doc = frame.contentDocument!;
  const win = frame.contentWindow!;

  // Page height rounded up so the image never spills onto an empty second page.
  const pageH = (img: Bits) => (Math.ceil(mm(img.h) * 100) / 100).toFixed(2);
  const pages = labels.map((img, i) => `@page p${i} { size: ${paperMm}mm ${pageH(img)}mm; margin: 0; }`).join("\n");
  const style = doc.createElement("style");
  style.textContent = `${pages}
html, body { margin: 0; padding: 0; background: #fff; }
.label { break-after: page; display: flex; justify-content: center; }
.label:last-child { break-after: auto; }
img { display: block; image-rendering: pixelated; }`;
  doc.head.append(style);
  doc.title = "Étiquettes thermiques";

  await Promise.all(
    labels.map((img, i) => {
      const page = doc.createElement("div");
      page.className = "label";
      page.style.setProperty("page", `p${i}`);
      page.style.width = `${paperMm}mm`;
      const el = doc.createElement("img");
      el.style.width = `${mm(img.w)}mm`;
      el.style.height = `${mm(img.h)}mm`;
      el.alt = "";
      page.append(el);
      doc.body.append(page);
      el.src = urls[i];
      return el.decode().catch(() => undefined);
    }),
  );

  const cleanup = () => {
    frame.remove();
    for (const u of urls) URL.revokeObjectURL(u);
  };
  // Chrome blocks in print() until the dialog closes; Safari and Firefox return at once,
  // so wait for afterprint before removing the frame.
  win.addEventListener("afterprint", () => setTimeout(cleanup, 1000), { once: true });
  setTimeout(cleanup, 10 * 60 * 1000);
  win.focus();
  win.print();
}
