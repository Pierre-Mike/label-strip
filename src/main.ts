import "./style.css";
import { collect, type InputFile } from "./core/inputs";
import { PAPER_DOTS, type Refusal } from "./core/pipeline";
import { zplRaster, escposRaster, ZEBRA_SETUP, ZPL_LEFT } from "./core/printers";
import { resize, BOX, type Bits, type Gray } from "./core/image";
import { renderPdf } from "./render";
import { labelsPdf, download } from "./pdfout";
import { canvasFor } from "./preview";
import * as usb from "./usb";
import { t, helpSteps, getLang, setLang, type Key } from "./i18n";
import type { Job, Result } from "./worker";

// ---------------------------------------------------------------- settings

interface Settings {
  paper: 80 | 58;
  language: "auto" | "zpl" | "escpos";
  zplLeft: number;
  plain: boolean;
}

const DEFAULTS: Settings = { paper: 80, language: "auto", zplLeft: ZPL_LEFT, plain: false };

function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem("settings") ?? "{}");
    return {
      paper: s.paper === 58 ? 58 : 80,
      language: ["auto", "zpl", "escpos"].includes(s.language) ? s.language : "auto",
      zplLeft: Number.isInteger(s.zplLeft) && s.zplLeft >= 0 && s.zplLeft < 832 ? s.zplLeft : ZPL_LEFT,
      plain: s.plain === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let settings = loadSettings();

function saveSettings(): void {
  try {
    localStorage.setItem("settings", JSON.stringify(settings));
  } catch {
    /* storage blocked: settings last for this visit */
  }
}

// ---------------------------------------------------------------- state

type Status = "working" | "ready" | "refused";

interface Item {
  id: number;
  name: string;
  sample: boolean;
  status: Status;
  page?: Gray;
  text?: string;
  result?: Extract<Result, { ok: true }>;
  reason?: Refusal | { kind: "error"; message: string };
  send?: { state: "sending" | "sent" | "failed"; message?: string };
  showCrop?: boolean;
}

const items: Item[] = [];
let nextId = 1;
let printer = usb.connected();
let banner: { text: string; kind: "info" | "error" } | null = null;

// ---------------------------------------------------------------- worker

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
const pending = new Map<number, (r: Result) => void>();
let jobId = 0;
worker.onmessage = (e: MessageEvent<Result>) => {
  pending.get(e.data.id)?.(e.data);
  pending.delete(e.data.id);
};

function runJob(page: Gray, text: string): Promise<Result> {
  const id = ++jobId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    // The page is copied, not transferred: it is kept to redo the layout when a setting changes.
    const job: Job = { id, page, text, opts: { dots: PAPER_DOTS[settings.paper], plain: settings.plain } };
    worker.postMessage(job);
  });
}

async function layout(item: Item): Promise<void> {
  if (!item.page || item.text === undefined) return;
  item.status = "working";
  item.send = undefined;
  drawItem(item);
  const r = await runJob(item.page, item.text);
  if (r.ok) {
    item.status = "ready";
    item.result = r;
    item.reason = undefined;
  } else {
    item.status = "refused";
    item.result = undefined;
    item.reason = r.reason;
  }
  drawItem(item);
  drawToolbar();
}

// ---------------------------------------------------------------- input

async function addFiles(files: InputFile[], sample = false): Promise<void> {
  if (!sample) {
    // Real labels replace the sample.
    for (const it of items.filter((i) => i.sample)) removeItem(it);
  }
  const { pdfs, empty, ignored } = await collect(files);
  const hasReal = () => items.some((i) => !i.sample);
  if (sample && hasReal()) return;
  const notes = [...empty.map((name) => t("emailEmpty", { name })), ...ignored.map((name) => t("ignored", { name }))];
  banner = notes.length ? { text: notes.join(" "), kind: "error" } : null;
  drawBanner();
  const fresh = pdfs.filter((p) => !items.some((i) => i.name === p.name && !i.sample));
  const created = fresh.map((p) => {
    const item: Item = { id: nextId++, name: p.name, sample, status: "working" };
    items.push(item);
    drawItem(item);
    return { item, bytes: p.bytes };
  });
  drawToolbar();
  // One at a time: a 406 dpi page takes about 16 MB.
  for (const { item, bytes } of created) {
    try {
      const { page, text } = await renderPdf(bytes);
      if (!items.includes(item)) continue; // removed while it was loading
      if (sample && hasReal()) {
        removeItem(item);
        continue;
      }
      item.page = page;
      item.text = text;
      await layout(item);
    } catch (err) {
      item.status = "refused";
      item.reason = { kind: "error", message: err instanceof Error ? err.message : String(err) };
      drawItem(item);
      drawToolbar();
    }
  }
}

async function readFiles(list: FileList | File[]): Promise<InputFile[]> {
  return Promise.all(Array.from(list).map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

function removeItem(item: Item): void {
  const i = items.indexOf(item);
  if (i >= 0) items.splice(i, 1);
  document.getElementById(`item-${item.id}`)?.remove();
  drawToolbar();
}

// ---------------------------------------------------------------- printing

function useZpl(): boolean {
  if (settings.language === "zpl") return true;
  if (settings.language === "escpos") return false;
  return printer?.isZebra ?? false;
}

function bytesFor(img: Bits): Uint8Array {
  return useZpl() ? zplRaster(img, settings.zplLeft) : escposRaster(img);
}

async function printItems(list: Item[]): Promise<void> {
  if (!printer) {
    await connectPrinter();
    if (!printer) return;
  }
  for (const item of list) {
    if (!item.result) continue;
    item.send = { state: "sending" };
    drawItem(item);
    try {
      await usb.send(bytesFor(item.result.image));
      item.send = { state: "sent" };
    } catch (err) {
      item.send = { state: "failed", message: err instanceof Error ? err.message : String(err) };
    }
    drawItem(item);
  }
}

async function connectPrinter(): Promise<void> {
  try {
    printer = await usb.connect();
    banner = null;
  } catch (err) {
    // Closing the chooser without picking a device is not an error worth showing.
    if (!(err instanceof DOMException && err.name === "NotFoundError")) {
      banner = { text: t("sendFailed", { msg: err instanceof Error ? err.message : String(err) }), kind: "error" };
    }
  }
  drawBanner();
  drawToolbar();
}

async function preparePrinter(): Promise<void> {
  if (!confirm(t("prepareConfirm"))) return;
  if (!printer) await connectPrinter();
  if (!printer) return;
  try {
    await usb.send(ZEBRA_SETUP);
    banner = { text: t("prepared"), kind: "info" };
  } catch (err) {
    banner = { text: t("sendFailed", { msg: err instanceof Error ? err.message : String(err) }), kind: "error" };
  }
  drawBanner();
}

async function savePdf(list: Item[]): Promise<void> {
  const imgs = list.filter((i) => i.result).map((i) => i.result!.image);
  if (!imgs.length) return;
  const bytes = await labelsPdf(imgs, settings.paper);
  const name = list.length === 1 ? list[0].name.replace(/\.pdf$/i, "") + "-80mm.pdf" : "etiquettes-80mm.pdf";
  download(bytes, settings.paper === 58 ? name.replace("80mm", "58mm") : name);
}

// ---------------------------------------------------------------- DOM helpers

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | number | EventListener | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const $ = (id: string) => document.getElementById(id)!;

// ---------------------------------------------------------------- drawing

function reasonText(r: NonNullable<Item["reason"]>): string {
  switch (r.kind) {
    case "error":
      return t("readError", { msg: r.message });
    case "crop-cuts":
      return t("crop-cuts", { format: r.format });
    case "unreadable":
      return t("unreadable", { format: r.codes.map((c) => c.format).join(", ") });
    default:
      return t(r.kind as Key);
  }
}

function cropView(item: Item): HTMLElement | null {
  const r = item.result;
  if (!r || !item.page) return null;
  // The page at 1/8 size with the label box and its codes drawn on top.
  const s = 8;
  const small = resize(item.page, Math.floor(item.page.w / s), Math.floor(item.page.h / s), BOX);
  const c = canvasFor(small, false);
  const ctx = c.getContext("2d")!;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#0f6b74";
  const [x0, y0, x1, y1] = r.box;
  ctx.strokeRect(x0 / s, y0 / s, (x1 - x0) / s, (y1 - y0) / s);
  ctx.strokeStyle = "#c2410c";
  for (const code of r.codes) {
    const [a, b, cc, d] = code.box;
    ctx.strokeRect(a / s, b / s, (cc - a) / s, (d - b) / s);
  }
  return h("figure", { class: "crop" }, c, h("figcaption", {}, `${r.template} · ${r.codes.map((x) => x.format).join(", ")}`));
}

function drawItem(item: Item): void {
  const old = document.getElementById(`item-${item.id}`);
  const r = item.result;
  const head = h(
    "header",
    {},
    h("div", { class: "card-title" },
      item.sample ? h("span", { class: "tag" }, t("sample")) : null,
      h("strong", {}, r ? r.label : item.name),
      r ? h("span", { class: "muted" }, " · " + t("length", { mm: Math.round(r.image.h / 8) })) : null,
    ),
    h("button", { class: "icon", type: "button", title: t("remove"), "aria-label": t("remove"), onclick: () => removeItem(item) }, "×"),
  );
  const body: Child[] = [];
  if (!item.sample && r) body.push(h("p", { class: "file muted" }, item.name));
  if (item.sample) body.push(h("p", { class: "muted" }, t("sampleNote")));
  if (item.status === "working") body.push(h("p", { class: "working" }, h("span", { class: "spinner", "aria-hidden": "true" }), t("working")));
  if (item.status === "refused" && item.reason) {
    if (!item.sample) body.unshift(h("p", { class: "file muted" }, item.name));
    body.push(h("p", { class: "refused", role: "alert" }, h("strong", {}, t("refused") + " — "), reasonText(item.reason)));
  }
  if (item.status === "ready" && r) {
    const n = r.expected.length;
    body.push(h("p", { class: "badges" }, h("span", { class: "badge ok" }, "✓ " + (n === 1 ? t("verified1") : t("verified", { n })))));
    if (r.realSize.length) body.push(h("p", { class: "note" }, t("realSize", { n: r.realSize.length })));
    const preview = canvasFor(r.image);
    preview.className = "preview";
    // Real width on screen: dots at 203 dpi.
    preview.style.width = `${(r.image.w / 203) * 25.4}mm`;
    preview.setAttribute("role", "img");
    preview.setAttribute("aria-label", `${r.label}, ${Math.round(r.image.h / 8)} mm`);
    body.push(h("div", { class: "preview-wrap" }, preview));
    const actions = h("div", { class: "actions" });
    if (usb.hasUsb()) {
      actions.append(
        h("button", { type: "button", class: "primary", disabled: item.send?.state === "sending", onclick: () => printItems([item]) },
          item.sample ? t("printTest") : t("print")),
      );
    }
    actions.append(h("button", { type: "button", onclick: () => savePdf([item]) }, t("pdf")));
    actions.append(h("button", { type: "button", class: "link", onclick: () => { item.showCrop = !item.showCrop; drawItem(item); } }, t("details")));
    body.push(actions);
    if (item.send) {
      const s = item.send;
      body.push(h("p", { class: `send ${s.state}`, role: "status" },
        s.state === "sending" ? t("sending") : s.state === "sent" ? "✓ " + t("sent") : t("sendFailed", { msg: s.message ?? "" })));
    }
    if (item.showCrop) body.push(cropView(item));
  }
  const card = h("article", { class: `card ${item.status}${item.sample ? " sample" : ""}`, id: `item-${item.id}` }, head, ...body);
  if (old) old.replaceWith(card);
  else $("labels").append(card);
}

function drawToolbar(): void {
  const ready = items.filter((i) => i.status === "ready" && !i.sample);
  const bar = $("toolbar");
  bar.replaceChildren();
  if (usb.hasUsb()) {
    bar.append(
      h("span", { class: `printer ${printer ? "on" : "off"}` }, printer ? t("connected", { name: printer.name }) : t("notConnected")),
      printer
        ? h("button", { type: "button", class: "link", onclick: async () => { await usb.forget(); printer = null; drawToolbar(); } }, t("forget"))
        : h("button", { type: "button", onclick: connectPrinter }, t("connect")),
    );
    if (ready.length) bar.append(h("button", { type: "button", class: "primary", onclick: () => printItems(ready) }, t("printAll", { n: ready.length })));
  } else {
    bar.append(h("p", { class: "nousb" }, t("noUsb")));
  }
  if (ready.length > 1) bar.append(h("button", { type: "button", onclick: () => savePdf(ready) }, t("pdfAll")));
  if (!usb.hasUsb() || ready.length) bar.append(h("p", { class: "muted small" }, t("pdfHint")));
}

function drawBanner(): void {
  const el = $("banner");
  el.replaceChildren();
  el.hidden = !banner;
  if (banner) {
    el.className = `banner ${banner.kind}`;
    el.append(banner.text);
  }
}

function select<T extends string | number>(id: string, value: T, options: [T, string][], onchange: (v: T) => void) {
  const s = h("select", { id });
  for (const [v, label] of options) s.append(h("option", { value: String(v), selected: v === value }, label));
  s.addEventListener("change", () => {
    const raw = s.value;
    onchange((typeof value === "number" ? Number(raw) : raw) as T);
  });
  return s;
}

function redoLayouts(): void {
  for (const it of items) if (it.page) layout(it);
}

function drawSettings(): void {
  const box = $("settings");
  box.replaceChildren(
    h("summary", {}, t("settings")),
    h("div", { class: "grid" },
      h("label", { for: "s-paper" }, t("paper")),
      select("s-paper", settings.paper, [[80, t("paper80")], [58, t("paper58")]], (v) => {
        settings.paper = v as 80 | 58;
        saveSettings();
        redoLayouts();
      }),
      h("label", { for: "s-lang" }, t("language")),
      select("s-lang", settings.language, [["auto", t("langAuto")], ["zpl", t("langZpl")], ["escpos", t("langEscpos")]], (v) => {
        settings.language = v as Settings["language"];
        saveSettings();
      }),
      h("label", { for: "s-left" }, t("zplLeft")),
      (() => {
        const i = h("input", { id: "s-left", type: "number", min: 0, max: 831, step: 1, value: settings.zplLeft, "aria-describedby": "s-left-hint" });
        i.addEventListener("change", () => {
          const v = Math.round(Number(i.value));
          settings.zplLeft = Number.isFinite(v) && v >= 0 && v < 832 ? v : ZPL_LEFT;
          i.value = String(settings.zplLeft);
          saveSettings();
        });
        return i;
      })(),
      h("p", { class: "muted small span", id: "s-left-hint" }, t("zplLeftHint")),
      h("label", { class: "span check" },
        (() => {
          const c = h("input", { type: "checkbox", checked: settings.plain });
          c.addEventListener("change", () => {
            settings.plain = c.checked;
            saveSettings();
            redoLayouts();
          });
          return c;
        })(),
        " " + t("plain"),
      ),
      usb.hasUsb() ? h("button", { type: "button", class: "span", onclick: preparePrinter }, t("prepare")) : null,
    ),
  );
}

function drawHelp(): void {
  const repo = "https://github.com/Pierre-Mike/label-strip";
  $("help").replaceChildren(
    h("summary", {}, t("help")),
    h("ol", {}, ...helpSteps().map((s) => h("li", {}, s))),
    h("p", {}, t("helpBrowsers"), " ", h("a", { href: `${repo}/blob/main/docs/windows.md`, rel: "noopener" }, t("helpWindows")), "."),
    h("p", { class: "muted small" }, t("offline"), " ", h("a", { href: repo, rel: "noopener" }, t("helpCode")), "."),
  );
}

function drawShell(): void {
  document.documentElement.lang = getLang();
  document.title = t("title");
  $("title").textContent = t("title");
  $("tagline").textContent = t("tagline");
  $("drop-title").textContent = t("drop");
  $("drop-or").textContent = t("dropHint");
  $("choose").textContent = t("choose");
  $("privacy").textContent = t("privacy");
  $("lang").textContent = t("langSwitch");
  drawSettings();
  drawHelp();
  drawToolbar();
  drawBanner();
  for (const it of items) drawItem(it);
}

// ---------------------------------------------------------------- wiring

function wire(): void {
  const zone = $("drop");
  const input = $("file") as HTMLInputElement;
  $("choose").addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    if (input.files?.length) await addFiles(await readFiles(input.files));
    input.value = "";
  });
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  for (const ev of ["dragenter", "dragover"]) zone.addEventListener(ev, (e) => { stop(e); zone.classList.add("over"); });
  zone.addEventListener("dragleave", (e) => { stop(e); zone.classList.remove("over"); });
  zone.addEventListener("drop", async (e) => {
    stop(e);
    zone.classList.remove("over");
    const files = (e as DragEvent).dataTransfer?.files;
    if (files?.length) await addFiles(await readFiles(files));
  });
  // Dropping outside the zone must not make the browser open the PDF instead.
  for (const ev of ["dragover", "drop"]) window.addEventListener(ev, (e) => e.preventDefault());
  $("lang").addEventListener("click", () => {
    setLang(getLang() === "fr" ? "en" : "fr");
    drawShell();
  });
  usb.onDisconnect(() => {
    printer = usb.connected();
    drawToolbar();
  });
}

async function start(): Promise<void> {
  wire();
  drawShell();
  printer = await usb.reconnect().catch(() => null);
  drawToolbar();
  // Built-in sample so the first visit shows what the page does.
  try {
    const res = await fetch(new URL("sample.pdf", document.baseURI));
    if (res.ok && !items.some((i) => !i.sample)) {
      await addFiles([{ name: "exemple.pdf", bytes: new Uint8Array(await res.arrayBuffer()) }], true);
    }
  } catch {
    /* offline on first visit: no sample */
  }
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    navigator.serviceWorker.register(new URL("sw.js", document.baseURI)).catch(() => {});
  }
}

start();
