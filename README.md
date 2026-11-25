# label-strip

Thermal label cropper for Vinted shipping labels. You drop the A4 label PDF (or the email it came in) on a web page, check the preview, and print it on an 80 mm thermal roll. The page reads the label in your browser and sends it nowhere.

It is a browser port of the `print_label.py` script from the `vinted-label-print` skill. On the same rendered page, the two produce the same printer image, pixel for pixel.

## Using it

1. Open the site in Chrome or Edge.
2. Plug the printer in over USB and click **Connecter l'imprimante**. The browser remembers the printer for later visits.
3. Drop the label PDF, or the saved email (`.eml`), on the page.
4. Check the preview and click **Imprimer**.

The page shows each label as a card with the carrier, its length in millimetres and how many codes it read back. A label it can't handle gets a reason in plain French and no print button.

Safari and Firefox have no WebUSB. There, **Imprimer via le navigateur** opens the browser's print dialog straight away, with each label as a page exactly as wide as the roll and as long as the label. Pick the thermal printer and print at 100% ("Taille réelle"). A web page can't skip the print dialog. **Ouvrir le PDF** opens the same labels as a PDF in a new tab, and downloads it if the browser blocks the tab.

## What it does to a label

1. Reads the text of page 1 and picks the first carrier template whose phrases all appear in it. With no match, it uses the automatic layout (below).
2. Renders page 1 at 406 dpi, twice the printer's 203 dpi.
3. Finds every barcode and 2D code. The biggest one anchors the label: the template gives the label's edges in millimetres from its centre.
4. Refuses the label if the crop would cut through a code.
5. Crops, turns the label upright, and trims the white margin.
6. Cuts the label into blocks (recipient, routing, barcode and so on), scales each one up to twice its size or the paper width, and stacks them. Text gets a light threshold, so thin strokes print bold. Codes get a plain threshold.
7. Reads every code back from the printer image. A code that fails is printed again at real size below the label. If it still fails, the page refuses the label.

### Labels with no template

A label from a carrier no template knows still prints. `src/core/generic.ts` builds the layout from fixed rules instead of measurements:

1. **Finds the label.** It looks for a frame of solid or dashed lines, at least 50 mm a side, around the biggest code, and takes the smallest one. With no frame, it first splits the page along dashed "cut here" lines (at least 15 dashes of similar length across 85% of the page) and keeps the part holding the most codes. In that part, it takes the ink around the biggest code up to the first white gap of 8 mm. If that comes out under 50 mm a side, it tries again across 12, 16, then 24 mm gaps.
2. **Turns it upright.** It uses the direction of the PDF text inside the label when 70% of it agrees. Otherwise it uses the 1D barcodes when they all agree. Otherwise it leaves the label as it lies.
3. **Cuts it into blocks** at white gaps at least 2.2 times the label's own line spacing (kept between 2 and 8 mm). Frame and separator lines don't count as ink, and no cut passes within 2 mm of a code. It splits a row into columns only when the row is wider than the roll at real size.
4. **Checks it.** If a code fails the read-back check, it tries the whole label at paper width before refusing.

The card shows "Transporteur inconnu" and a "Mise en page automatique" tag: check the preview before printing. **Voir la découpe** draws the blocks it cut. Text meant only for the sender stays in, since the page can't tell it apart from text the carrier needs. A template removes it.

`bun scripts/try-auto.ts [--out dir] [files]` runs labels through the automatic layout with every template switched off, and prints what it found.

The pipeline runs in a Web Worker. Barcode reading uses zxing-cpp compiled to WebAssembly, and pdf.js renders the page.

## Printers

| Printer | Language | Notes |
|---|---|---|
| Zebra (USB vendor `0a5f`), for example the ZD421 | ZPL | Picked automatically. The image starts at head dot 100, where an 80 mm roll begins. |
| USB receipt printers (USB class 7) | ESC/POS | 80 mm (576 dots) or 58 mm (384 dots) rolls. |
| Anything else | PDF | One page per label, 80 or 58 mm wide, 203 dpi, no margins. |

The settings panel has the roll width, the printer language, the Zebra left offset and the plain layout. The browser stores them in `localStorage`. The **Préparer l'imprimante Zebra** button sends the one-time setup the ZD421 needs: direct thermal mode (no ribbon), then a resume. A Zebra left on thermal transfer pauses with "ribbon out" and holds jobs.

The page reports "Envoyé" once the USB transfer completes. The browser can't tell whether the label actually printed.

Browsers can't open raw TCP connections, and an HTTPS page can't post to a printer's local address, so network printing is out of scope. On Windows, a Zebra may need its driver swapped for WinUSB first: see [docs/windows.md](docs/windows.md).

## Privacy

Labels hold names and home addresses, so:

- The site has no server code, no analytics, no tracking and no error reporting.
- A Content-Security-Policy in the built page only allows files from the site itself. The pdf.js fonts, character maps and decoders, and the barcode reader's `.wasm`, are copied into the build.
- After the first visit, a service worker keeps a copy of the site, so it works offline.
- The repository holds no real labels. Test labels in `fixtures/synthetic/` use made-up names and codes generated by `scripts/make-fixtures.ts`.

## Development

```bash
npm install
npm run dev         # http://localhost:5173
npm test            # unit tests and the synthetic labels, through pdf.js in Node
npm run typecheck
npm run build       # static site in dist/
```

`npm run fixtures` regenerates the synthetic labels and `public/sample.pdf` (needs [Bun](https://bun.sh)). `npm run parity` compares this pipeline with the Python script on real labels you keep locally in `fixtures/private/`, which git ignores. See [fixtures/private/README.md](fixtures/private/README.md).

| Path | Contents |
|---|---|
| `src/core/image.ts` | Grayscale and 1-bit images. The Lanczos and box resamplers are ports of Pillow's `Resample.c`. |
| `src/core/pipeline.ts` | Template matching, locate, extract, stack, read back, real-size fallback. |
| `src/core/generic.ts` | Automatic layout for labels with no template. |
| `src/core/printers.ts` | ZPL and ESC/POS encoders. |
| `src/core/inputs.ts` | PDFs out of emails, duplicates removed. |
| `src/templates.json` | Carrier templates. |
| `src/render.ts`, `src/worker.ts`, `src/usb.ts`, `src/pdfout.ts`, `src/main.ts` | The web page. |
| `test/` | Tests. The snapshots come from the Python script and from Pillow (`test/make-*.py`). |

Pushing to `main` deploys the site to GitHub Pages through `.github/workflows/pages.yml`. Turn on Pages with "GitHub Actions" as the source in the repository settings.

### Matching the script

On the same page image, the output equals the script's, and the tests check this for the resampler, ZPL and ESC/POS bytes. On the twelve real labels used during the port, the pixel difference was 0.000% with poppler rendering the page.

pdf.js anti-aliases differently from poppler, so with pdf.js rendering the page, 2 to 8% of pixels differ. That is mostly a one-pixel shift of text edges, and every code still reads back. One label differed by 25% because a cut line lay on the crop edge. Its grey edge pixels moved the trim. The trim now ignores grey pixels within 2 px of the crop border and counts only solid ink there.

Two other differences from the script:

- The read-back check reads each block on its own first, then the whole strip, so it never refuses a label the script would accept.
- In ZPL and ESC/POS, padding bits at the end of a row stay white. The script prints them black, which only matters for image widths that aren't a multiple of 8.

## Adding a carrier

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. pdf.js and zxing-cpp are Apache-2.0, pdf-lib and postal-mime are MIT.

This project has no link to Vinted or to any carrier.
