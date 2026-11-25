/** Draw printer images on canvases, and encode them as PNG. */
import type { Bits, Gray } from "./core/image";
import { toRGBA } from "./core/image";

export function canvasFor(img: Bits | Gray, isBits = true): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.w;
  c.height = img.h;
  c.getContext("2d")!.putImageData(new ImageData(toRGBA(img, isBits), img.w, img.h), 0, 0);
  return c;
}

export async function toPng(img: Bits): Promise<Uint8Array> {
  const c = canvasFor(img);
  const blob = await new Promise<Blob>((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error("PNG encoding failed"))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}
