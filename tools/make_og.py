"""Generate frontend/og.png — the social share card.

Placeholder in the site's palette (dark #0b0d0e, amber #d9a13b junction
glow). Replace with a Nano Banana / designed render any time; keep
1200x630 and the same filename.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 630
BG = (11, 13, 14)
LINE = (30, 35, 38)
TEXT = (232, 230, 225)
MUTED = (139, 144, 150)
AMBER = (217, 161, 59)
GREEN = (95, 174, 126)
RED = (184, 88, 79)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# junction on the right — same geometry language as the hero sim
cx, cy, road = 880, 315, 86

glow = Image.new("RGB", (W, H), BG)
gd = ImageDraw.Draw(glow)
gd.rectangle([cx - road, 0, cx + road, H], fill=(24, 27, 30))
gd.rectangle([0, cy - road, W, cy + road], fill=(24, 27, 30))
glow = glow.filter(ImageFilter.GaussianBlur(18))
img = Image.blend(img, glow, 0.9)
d = ImageDraw.Draw(img)

# road edges
for o in (-road, road):
    d.line([(0, cy + o), (cx - road, cy + o)], fill=LINE, width=2)
    d.line([(cx + road, cy + o), (W, cy + o)], fill=LINE, width=2)
    d.line([(cx + o, 0), (cx + o, cy - road)], fill=LINE, width=2)
    d.line([(cx + o, cy + road), (cx + o, H)], fill=LINE, width=2)
# centre dashes
for x in range(0, cx - road, 40):
    d.line([(x, cy), (x + 18, cy)], fill=(50, 55, 60), width=2)
for x in range(cx + road, W, 40):
    d.line([(x, cy), (x + 18, cy)], fill=(50, 55, 60), width=2)
for y in range(0, cy - road, 40):
    d.line([(cx, y), (cx, y + 18)], fill=(50, 55, 60), width=2)
for y in range(cy + road, H, 40):
    d.line([(cx, y), (cx, y + 18)], fill=(50, 55, 60), width=2)
# junction cell
d.rounded_rectangle([cx - road, cy - road, cx + road, cy + road],
                    radius=10, outline=(70, 76, 82), width=2)

# signal gates: green E-W, red N-S, with soft glow
gates = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gg = ImageDraw.Draw(gates)
stop = road + 18
gg.line([(cx - stop, cy + 8), (cx - stop, cy + road - 8)], fill=GREEN + (255,), width=6)
gg.line([(cx + stop, cy - road + 8), (cx + stop, cy - 8)], fill=GREEN + (255,), width=6)
gg.line([(cx - road + 8, cy - stop), (cx - 8, cy - stop)], fill=RED + (255,), width=6)
gg.line([(cx + 8, cy + stop), (cx + road - 8, cy + stop)], fill=RED + (255,), width=6)
blur = gates.filter(ImageFilter.GaussianBlur(7))
img.paste(blur, (0, 0), blur)
img.paste(gates, (0, 0), gates)
d = ImageDraw.Draw(img)

# a few cars
def car(x, y, horiz, bright):
    body = (210, 208, 200) if bright else (120, 124, 130)
    if horiz:
        d.rounded_rectangle([x, y - 5, x + 26, y + 5], radius=3, fill=body)
    else:
        d.rounded_rectangle([x - 5, y, x + 5, y + 26], radius=3, fill=body)

car(cx - 260, cy + road // 2, True, True)
car(cx - 190, cy + road // 2, True, True)
car(cx + 150, cy - road // 2, True, True)
car(cx - road // 2, cy - 230, False, False)
car(cx + road // 2, cy + 170, False, False)

# text — IBM Plex if available locally, else default
def font(names, size):
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
    return ImageFont.load_default(size)

f_kick = font(["IBMPlexMono-Medium.ttf", "consola.ttf"], 22)
f_h1 = font(["IBMPlexSans-Bold.ttf", "arialbd.ttf"], 92)
f_sub = font(["IBMPlexSans-Regular.ttf", "arial.ttf"], 30)

lx = 84
d.text((lx, 150), "REINFORCEMENT-LEARNING SIGNAL CONTROL", font=f_kick, fill=AMBER)
d.text((lx, 196), "Signals", font=f_h1, fill=TEXT)
d.text((lx, 300), "that learn.", font=f_h1, fill=TEXT)
d.text((lx, 440), "60% less delay than fixed-time control.", font=f_sub, fill=MUTED)
d.text((lx, 482), "No GPU required.", font=f_sub, fill=MUTED)
d.text((lx, 560), "TRAF", font=font(["IBMPlexSans-Bold.ttf", "arialbd.ttf"], 26), fill=TEXT)
d.text((lx + 74, 560), "FIX", font=font(["IBMPlexSans-Bold.ttf", "arialbd.ttf"], 26), fill=AMBER)

out = Path(__file__).resolve().parent.parent / "frontend" / "og.png"
img.save(out, "PNG")
print(f"wrote {out} ({out.stat().st_size // 1024} KB)")
