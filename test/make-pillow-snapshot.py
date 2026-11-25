# /// script
# dependencies = ["pillow"]
# ///
import json, sys
from PIL import Image
w, h = 53, 41
im = Image.new("L", (w, h))
im.putdata([((x * 37 + y * 91 + (x * y) % 17) * 7) % 256 for y in range(h) for x in range(w)])
out = {"w": w, "h": h, "src": list(im.getdata()), "cases": []}
for (tw, th, f) in [(20, 15, "LANCZOS"), (120, 90, "LANCZOS"), (53, 17, "LANCZOS"), (17, 41, "LANCZOS"), (26, 20, "BOX"), (7, 99, "LANCZOS")]:
    r = im.resize((tw, th), getattr(Image, f))
    out["cases"].append({"w": tw, "h": th, "filter": f, "data": list(r.getdata())})
r = im.rotate(90, expand=True, fillcolor=255)
out["rot90"] = {"w": r.size[0], "h": r.size[1], "data": list(r.getdata())}
json.dump(out, open(sys.argv[1], "w"))
