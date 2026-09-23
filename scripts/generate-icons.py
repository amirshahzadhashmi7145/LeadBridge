from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1] / "public"
ROOT.mkdir(exist_ok=True)

SIZES = [16, 32, 48, 96, 128]


def draw_icon(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    pad = max(1, size // 16)
    draw.rounded_rectangle(
        (pad, pad, size - pad - 1, size - pad - 1),
        radius=max(3, size // 5),
        fill=(18, 48, 77, 255),
    )
    draw.rounded_rectangle(
        (pad, pad, size - pad - 1, size - pad - 1),
        radius=max(3, size // 5),
        outline=(31, 111, 235, 255),
        width=max(1, size // 18),
    )

    mid = size // 2
    y = int(size * 0.62)
    draw.arc(
        (int(size * 0.18), int(size * 0.28), int(size * 0.82), int(size * 0.95)),
        start=200,
        end=340,
        fill=(94, 176, 255, 255),
        width=max(2, size // 10),
    )
    draw.ellipse((mid - size // 10, int(size * 0.28), mid + size // 10, int(size * 0.48)), fill=(232, 241, 255, 255))
    if size >= 32:
        try:
            font = ImageFont.load_default()
            text = "LB"
            box = draw.textbbox((0, 0), text, font=font)
            tw, th = box[2] - box[0], box[3] - box[1]
            draw.text(((size - tw) / 2, y - th), text, fill=(255, 255, 255, 230), font=font)
        except Exception:
            pass
    return image


for size in SIZES:
    draw_icon(size).save(ROOT / f"icon-{size}.png")
    print(f"wrote icon-{size}.png")
