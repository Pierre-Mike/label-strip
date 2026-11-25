// Copy pdf.js fonts, character maps, colour profiles and decoders into public/,
// so the site serves them itself and never asks a CDN.
import { cpSync, rmSync } from "node:fs";
rmSync("public/pdfjs", { recursive: true, force: true });
for (const dir of ["standard_fonts", "cmaps", "wasm", "iccs"]) {
  cpSync(`node_modules/pdfjs-dist/${dir}`, `public/pdfjs/${dir}`, { recursive: true });
}
