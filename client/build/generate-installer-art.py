# Generates NSIS wizard bitmaps in the Konsmon dark theme.
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
GFX = ROOT / "gfx"
OUT = Path(__file__).resolve().parent

BG = (11, 13, 14)
BG_TOP = (15, 20, 22)
ACCENT = (14, 165, 255)
ACCENT_DIM = (8, 90, 140)
TEXT = (230, 238, 243)
MUTED = (130, 140, 146)


def font(size, bold=True):
    for name in ("segoeuib.ttf" if bold else "segoeui.ttf", "arialbd.ttf" if bold else "arial.ttf"):
        path = Path(r"C:\Windows\Fonts") / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def gradient(size, top=BG_TOP, bottom=BG):
    image = Image.new("RGB", size, bottom)
    draw = ImageDraw.Draw(image)
    width, height = size
    for y in range(height):
        t = y / max(height - 1, 1)
        color = tuple(int(a + (b - a) * t) for a, b in zip(top, bottom))
        draw.line([(0, y), (width, y)], fill=color)
    return image


def load_mark(max_width, max_height):
    eye = Image.open(GFX / "eye.png").convert("RGBA")
    eye = ImageEnhance.Brightness(eye).enhance(1.15)
    eye.thumbnail((max_width, max_height), Image.Resampling.LANCZOS)
    return eye


def fit_text(draw, text, max_width, sizes, bold=True):
    for size in sizes:
        current = font(size, bold=bold)
        if draw.textlength(text, font=current) <= max_width:
            return current
    return font(sizes[-1], bold=bold)


def sidebar(subtitle):
    width, height = 164, 314
    image = gradient((width, height))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 4, height), fill=ACCENT)
    draw.rectangle((0, 0, width, 3), fill=ACCENT_DIM)

    mark = load_mark(128, 128)
    mark_x = (width - mark.width) // 2 + 2
    image.paste(mark, (mark_x, 42), mark)

    title = font(18)
    title_text = "KONSMON"
    title_w = draw.textlength(title_text, font=title)
    draw.text(((width - title_w) // 2 + 2, 188), title_text, font=title, fill=TEXT)

    sub = fit_text(draw, subtitle, width - 24, [11, 10, 9], bold=False)
    sub_w = draw.textlength(subtitle, font=sub)
    draw.text(((width - sub_w) // 2 + 2, 214), subtitle, font=sub, fill=MUTED)

    draw.rectangle((28, 242, width - 24, 244), fill=ACCENT)
    footer = font(9, bold=False)
    footer_text = "Desktop Client"
    footer_w = draw.textlength(footer_text, font=footer)
    draw.text(((width - footer_w) // 2 + 2, 258), footer_text, font=footer, fill=MUTED)
    return image


def header():
    width, height = 150, 57
    image = gradient((width, height), top=(18, 24, 28), bottom=BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 4, height), fill=ACCENT)
    title = font(18)
    draw.text((16, 10), "KONSMON", font=title, fill=TEXT)
    sub = font(10, bold=False)
    draw.text((16, 32), "Setup wizard", font=sub, fill=ACCENT)
    draw.rectangle((0, height - 3, width, height), fill=ACCENT)
    return image


def save_bmp(image, name):
    path = OUT / name
    image.convert("RGB").save(path, format="BMP")
    image.convert("RGB").save(path.with_suffix(".png"), format="PNG")
    print("wrote", path)


if __name__ == "__main__":
    save_bmp(sidebar("Install"), "installerSidebar.bmp")
    save_bmp(sidebar("Uninstall"), "uninstallerSidebar.bmp")
    save_bmp(header(), "installerHeader.bmp")
