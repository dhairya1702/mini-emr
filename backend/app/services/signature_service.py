from __future__ import annotations

from io import BytesIO

try:
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None


def normalize_signature_image(raw_bytes: bytes, content_type: str) -> tuple[bytes, str]:
    if not raw_bytes:
        raise ValueError("Signature file is empty.")
    if Image is None:
        return raw_bytes, content_type

    try:
        image = Image.open(BytesIO(raw_bytes)).convert("RGBA")
    except Exception as exc:  # pragma: no cover
        raise ValueError("Signature image could not be processed.") from exc

    cleaned_pixels = []
    for red, green, blue, alpha in image.getdata():
        if alpha == 0:
            cleaned_pixels.append((red, green, blue, 0))
            continue
        if red >= 235 and green >= 235 and blue >= 235:
            cleaned_pixels.append((255, 255, 255, 0))
        else:
            cleaned_pixels.append((red, green, blue, alpha))
    image.putdata(cleaned_pixels)

    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue(), "image/png"
