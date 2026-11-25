/// <reference lib="webworker" />
/** Runs the label pipeline off the main thread: locate, crop, stack, read back. */
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { initZXing, read } from "./core/zxing";
import { runLabel, Refused, type Options, type Refusal, type CodeRef } from "./core/pipeline";
import type { Gray, Bits, Rect } from "./core/image";
import type { Code } from "./core/pipeline";

initZXing({ url: new URL(wasmUrl, self.location.href).href });

export interface Job {
  id: number;
  page: Gray;
  text: string;
  opts: Options;
}

export type Result =
  | { id: number; ok: true; template: string; label: string; image: Bits; box: Rect; codes: Code[]; expected: CodeRef[]; realSize: CodeRef[] }
  | { id: number; ok: false; reason: Refusal | { kind: "error"; message: string } };

self.onmessage = async (e: MessageEvent<Job>) => {
  const { id, page, text, opts } = e.data;
  let res: Result;
  try {
    const { template, made } = await runLabel(page, text, read, opts);
    res = {
      id,
      ok: true,
      template: template.name,
      label: template.label ?? template.name,
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
