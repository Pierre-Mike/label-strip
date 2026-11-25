# Private fixtures

Put real label PDFs and saved emails (`.eml`) here to run the parity check. Git ignores them.

```bash
uv run ~/.claude/skills/vinted-label-print/scripts/print_label.py fixtures/private/*.pdf fixtures/private/*.eml
npm run parity             # pages rendered by poppler, like the script
npm run parity -- --pdfjs  # pages rendered by pdf.js, like the browser
```

The first command writes `<label>-preview.png` next to each input. The parity script compares its own image with that preview and prints the share of pixels that differ.
