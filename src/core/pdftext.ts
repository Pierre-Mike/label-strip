/** Helpers shared by the browser and Node renderers. */
import type { Gray } from "./image";

/** Page text from pdf.js getTextContent(), one line per text run. */
export function pageText(content: { items: ReadonlyArray<object> }): string {
  return content.items
    .map((i) => {
      const it = i as { str?: string; hasEOL?: boolean };
      return (it.str ?? "") + (it.hasEOL ? "\n" : " ");
    })
    .join("");
}

/** Luminance as poppler's gray mode computes it, on a white background. */
export function rgbaToGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const d = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < d.length; i++, j += 4) {
    const a = rgba[j + 3] / 255;
    const r = rgba[j] * a + 255 * (1 - a), g = rgba[j + 1] * a + 255 * (1 - a), b = rgba[j + 2] * a + 255 * (1 - a);
    d[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return { w, h, d };
}
