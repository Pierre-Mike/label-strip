# /// script
# dependencies = ["pillow", "pyusb", "zxing-cpp"]
# ///
import sys, importlib.util
spec = importlib.util.spec_from_file_location("pl", sys.argv[1]); pl = importlib.util.module_from_spec(spec); spec.loader.exec_module(pl)
from PIL import Image
# Fixed 1-bit test pattern: 100x2100 so ZPL bands (1024) are exercised; diagonal, border, checker.
w, h = 104, 2100
im = Image.new("1", (w, h), 1)
px = im.load()
for y in range(h):
    for x in range(w):
        if x == 0 or y == 0 or x == w - 1 or y == h - 1 or x == y % w or ((x // 7 + y // 5) % 3 == 0 and y > 1500):
            px[x, y] = 0
open(sys.argv[2] + "/zpl-104x2100-left100.zpl", "wb").write(pl.zpl_raster(im, 100))
open(sys.argv[2] + "/zpl-104x2100-left37.zpl", "wb").write(pl.zpl_raster(im, 37))
open(sys.argv[2] + "/escpos-104x2100.bin", "wb").write(pl.escpos_raster(im))
big = Image.new("1", (576, 8000), 1)
open(sys.argv[2] + "/zpl-576x8000-left100.zpl", "wb").write(pl.zpl_raster(big, 100))
