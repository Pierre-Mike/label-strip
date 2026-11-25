# Adding a carrier layout

Carrier templates live in `src/templates.json`. You can add a carrier without touching the pipeline.

## What a template holds

```json
{
  "name": "colissimo",
  "label": "Colissimo",
  "needles": ["Colissimo"],
  "around": [-54.8, -112.2, 58.1, 43.2],
  "rotate": 0,
  "landscape": true,
  "parts": [
    [[0.0, 0.0, 0.665, 0.195], 2.0, false],
    [[0.665, 0.245, 1.0, 0.485], 2.0, true]
  ]
}
```

| Field | Meaning |
|---|---|
| `name` | Short id, shown in the crop view. |
| `label` | Carrier name shown on the card. |
| `needles` | Phrases that only this layout's PDF text contains. Every one must appear. Case and spaces don't matter. |
| `around` | The label's edges in millimetres from the centre of the biggest code on the page: left, top, right, bottom. Left and top are negative. |
| `rotate` | Degrees counter-clockwise that turn the label upright, for labels printed sideways. A multiple of 90. Optional. |
| `landscape` | `true` or `false` when the same phrases appear in a portrait and a landscape layout. Optional. |
| `parts` | The blocks to stack, top to bottom as they print. Each one is `[[x0, y0, x1, y1], maxScale, isCode]`. The box is in fractions of the upright, trimmed label. `maxScale` is how much the block may grow compared with the whole label at paper width (2.0 for most). `isCode` is `true` for blocks holding a barcode or 2D code, which then never get the bold threshold. |

Order matters: the first template whose needles all match wins. Put a specific layout before a general one.

## Measuring a new layout

1. Get two or three real labels from that carrier. Keep them in `fixtures/private/`, which git ignores. Never commit a real label.
2. Render page 1 at 406 dpi and find the codes:

   ```bash
   pdftoppm -r 406 -gray -png -singlefile -f 1 -l 1 label.pdf page
   uv run --with zxing-cpp --with pillow python -c "
   import zxingcpp; from PIL import Image
   for r in zxingcpp.read_barcodes(Image.open('page.png')):
       p = r.position
       print(r.format.name, r.text[:20], p.top_left, p.bottom_right)"
   ```

3. Take the biggest code and its centre. Measure the label's edges from that centre in pixels, then divide by 16 (406 dpi is 15.98 pixels per millimetre) to get `around`. Leave a millimetre or two of white around the label: the pipeline trims it.
4. In the page, open the label and use **Voir la découpe** on a card. It draws the label box in teal and every code in orange on the page. A label refused with "la découpe couperait le code" means `around` cuts through a code.
5. Pick the blocks. Leave out text meant for the sender, such as folding instructions, legal notes and size limits. Keep every code inside one block, with some white around it.
6. Check the preview of each of your labels, then print one and scan every code with a phone.

## Tests

`scripts/make-fixtures.ts` draws a synthetic label for every template from `templates.json`, with made-up text and generated codes placed in the template's code blocks, and `test/pipeline.test.ts` runs each one through the pipeline. After adding a template:

```bash
npm run fixtures   # needs Bun
npm test
```

If you have the Python script, also run the parity check on your real labels (see `fixtures/private/README.md`).

## Pull requests

- Never include real labels, previews of real labels, or screenshots with real names or addresses.
- Keep the "refuse instead of guessing" rule: a change must never let a label with an unreadable code reach the print button.
- Run `npm run typecheck` and `npm test` before opening the pull request.
