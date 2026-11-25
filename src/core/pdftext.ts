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

/** A run of page text, placed on the rendered page. */
export interface TextItem {
  str: string;
  /** Start of its baseline, in rendered page pixels. */
  x: number;
  y: number;
  /** Direction its text reads, in degrees counter-clockwise as seen on the page (0 = left to right). */
  angle: number;
}

type Matrix = number[];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** Text runs from pdf.js getTextContent(), placed with the viewport's transform. */
export function textItems(content: { items: ReadonlyArray<object> }, viewport: Matrix): TextItem[] {
  const out: TextItem[] = [];
  for (const i of content.items) {
    const it = i as { str?: string; transform?: Matrix };
    if (!it.str?.trim() || !it.transform) continue;
    const m = multiply(viewport, it.transform);
    // Device space has y pointing down, so flip it to get the angle as seen.
    out.push({ str: it.str, x: m[4], y: m[5], angle: (Math.atan2(-m[1], m[0]) * 180) / Math.PI });
  }
  return out;
}
