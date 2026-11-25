import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { initZXing, read } from "../src/core/zxing";
import { runLabel, Refused, TEMPLATES, type Refusal } from "../src/core/pipeline";
import { collect } from "../src/core/inputs";
import { renderPdf } from "../scripts/node-render";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/synthetic/${name}`, import.meta.url)));

beforeAll(() => {
  initZXing({ binary: readFileSync("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm").buffer as ArrayBuffer });
});

async function run(name: string, opts = {}, templates = TEMPLATES) {
  const { page, text, items } = await renderPdf(fixture(name));
  return runLabel(page, text, read, opts, templates, items);
}

async function refusal(name: string): Promise<Refusal> {
  try {
    await run(name);
  } catch (e) {
    if (e instanceof Refused) return e.reason;
    throw e;
  }
  throw new Error(`${name} was not refused`);
}

describe("every carrier template", () => {
  for (const t of TEMPLATES) {
    it(`${t.name}: matched, cropped, every code read back`, async () => {
      const { template, made } = await run(`${t.name}.pdf`);
      expect(template.name).toBe(t.name);
      expect(made.image.w).toBe(576);
      expect(made.expected.length).toBe(t.parts.filter((p) => p[2]).length);
      // Long enough to be a label, short enough to be one label.
      expect(made.image.h / 8).toBeGreaterThan(100);
      expect(made.image.h / 8).toBeLessThan(450);
    });
  }
});

describe("fallback and options", () => {
  it("prints a code again at real size when it does not read once scaled", async () => {
    const { made } = await run("chronopost-a4.pdf");
    expect(made.realSize.length).toBeGreaterThan(0);
  });
  it("58 mm paper gives a 384-dot image", async () => {
    const { made } = await run("colissimo.pdf", { dots: 384 });
    expect(made.image.w).toBe(384);
  });
  it("plain layout keeps the whole label at paper width", async () => {
    const { made } = await run("colissimo.pdf", { plain: true });
    expect(made.image.w).toBe(576);
    expect(made.expected.length).toBe(2);
  });
});

describe("automatic layout", () => {
  // The template fixtures again, with every template switched off.
  for (const t of TEMPLATES) {
    it(`${t.name} without its template: every code read back`, async () => {
      const { template, made } = await run(`${t.name}.pdf`, {}, []);
      expect(template.name).toBe("auto");
      expect(["auto", "whole"]).toContain(made.layout);
      expect(made.expected.length).toBe(t.parts.filter((p) => p[2]).length);
      // Turned the same way as the measured template.
      expect(template.rotate ?? 0).toBe(t.rotate ?? 0);
    });
  }

  const cases: [string, number, number][] = [
    // fixture, codes, turn
    ["auto-a6-sideways.pdf", 2, 90],
    ["auto-corner.pdf", 2, 0],
    ["auto-qr-only.pdf", 1, 0],
  ];
  for (const [name, codes, turn] of cases) {
    it(`${name}: unknown carrier, printed in blocks`, async () => {
      const { template, made } = await run(name);
      expect(made.layout).toBe("auto");
      expect(made.expected.length).toBe(codes);
      expect(template.rotate).toBe(turn);
      expect(made.blocks!.length).toBeGreaterThan(codes);
      // No block edge crosses a code: each code lies inside exactly one block.
      for (const c of made.codes) {
        const holding = made.blocks!.filter((b) => b[0] <= c.box[0] && b[1] <= c.box[1] && b[2] >= c.box[2] && b[3] >= c.box[3]);
        const touching = made.blocks!.filter((b) => b[0] < c.box[2] && c.box[0] < b[2] && b[1] < c.box[3] && c.box[1] < b[3]);
        expect(holding.length).toBe(1);
        expect(touching.length).toBe(1);
      }
    });
  }

  it("leaves out the instructions printed around the label", async () => {
    const { made } = await run("auto-corner.pdf");
    // The label is 150 × 100 mm in the corner; the instructions start 25 mm below it.
    expect((made.box[3] - made.box[1]) / 16).toBeLessThan(110);
  });

  it("plain layout prints the whole label", async () => {
    const { made } = await run("auto-corner.pdf", { plain: true });
    expect(made.layout).toBe("whole");
  });
});

describe("refusals", () => {
  it("no code on the page", async () => expect(await refusal("refuse-no-code.pdf")).toEqual({ kind: "no-code" }));
  it("crop cuts through a code", async () =>
    expect(await refusal("refuse-crop-cuts.pdf")).toMatchObject({ kind: "crop-cuts", text: "STRADDLE-TEST" }));
  it("code unreadable even at real size", async () =>
    expect(await refusal("refuse-unreadable.pdf")).toMatchObject({ kind: "unreadable", codes: [{ format: "Code128" }] }));
});

describe("inputs", () => {
  const pdf = fixture("colissimo.pdf");
  const b64 = Buffer.from(pdf).toString("base64").replace(/.{76}/g, "$&\r\n");
  const inner = [
    "From: Expediteur <expediteur@example.com>", "Subject: Bordereau", "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="in"', "", "--in", "Content-Type: text/plain", "", "Bonjour", "--in",
    "Content-Type: application/pdf", 'Content-Disposition: attachment; filename="Bordereau-Test-1.pdf"',
    "Content-Transfer-Encoding: base64", "", b64, "--in--", "",
  ].join("\r\n");
  const direct = new TextEncoder().encode(inner);
  const forwarded = new TextEncoder().encode([
    "From: Moi <moi@example.com>", "Subject: Fwd: Bordereau", "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="out"', "", "--out", "Content-Type: text/plain", "", "Voir ci-dessous", "--out",
    "Content-Type: message/rfc822", 'Content-Disposition: attachment; filename="fwd.eml"', "", inner, "--out--", "",
  ].join("\r\n"));

  it("takes the PDF out of an email", async () => {
    const r = await collect([{ name: "mail.eml", bytes: direct }]);
    expect(r.pdfs.map((p) => p.name)).toEqual(["Bordereau-Test-1.pdf"]);
    expect(r.pdfs[0].bytes).toEqual(pdf);
  });
  it("opens forwarded emails, and keeps a label seen twice once", async () => {
    const r = await collect([
      { name: "fwd.eml", bytes: forwarded },
      { name: "mail.eml", bytes: direct },
      { name: "Bordereau-Test-1.pdf", bytes: pdf },
    ]);
    expect(r.pdfs.map((p) => p.name)).toEqual(["Bordereau-Test-1.pdf"]);
  });
  it("reports emails without a PDF and other files", async () => {
    const r = await collect([
      { name: "empty.eml", bytes: new TextEncoder().encode("Subject: x\r\nContent-Type: text/plain\r\n\r\nhi") },
      { name: "photo.jpg", bytes: Uint8Array.of(0xff, 0xd8, 0xff) },
    ]);
    expect(r.empty).toEqual(["empty.eml"]);
    expect(r.ignored).toEqual(["photo.jpg"]);
  });
});
