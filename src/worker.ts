/// <reference lib="webworker" />
/** Runs the label pipeline off the main thread: locate, crop, stack, read back. */
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { initZXing, read } from "./core/zxing";
import { runLabel, Refused, TEMPLATES, type Options, type Refusal, type CodeRef, type Layout } from "./core/pipeline";
import type { TextItem } from "./core/pdftext";
import type { Gray, Bits, Rect } from "./core/image";
import type { Code } from "./core/pipeline";

initZXing({ url: new URL(wasmUrl, self.location.href).href });

export interface Job {
  id: number;
  page: Gray;
  text: string;
  items: TextItem[];
  opts: Options;
}

export type Result =
  | { id: number; ok: true; template: string; label: string; layout: Layout; blocks?: Rect[]; image: Bits; box: Rect; codes: Code[]; expected: CodeRef[]; realSize: CodeRef[] }
  | { id: number; ok: false; reason: Refusal | { kind: "error"; message: string } };

self.onmessage = async (e: MessageEvent<Job>) => {
  const { id, page, text, items, opts } = e.data;
  let res: Result;
  try {
    const { template, made } = await runLabel(page, text, read, opts, TEMPLATES, items);
    res = {
      id,
      ok: true,
      template: template.name,
      label: template.label ?? template.name,
      layout: made.layout,
      blocks: made.blocks,
      image: made.image,
      box: made.box,
      codes: made.codes,
      expected: made.expected,
      realSize: made.realSize,
    };
    (self as unknown as Worker).postMessage(res, [made.image.d.buffer]);
    return;
  } catch (err) {
    res = {
      id,
      ok: false,
      reason: err instanceof Refused ? err.reason : { kind: "error", message: err instanceof Error ? err.message : String(err) },
    };
  }
  (self as unknown as Worker).postMessage(res);
};
