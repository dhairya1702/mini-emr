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

    processed_pixels = []
    has_visible_ink = False
    for red, green, blue, alpha in image.getdata():
        if alpha == 0:
            processed_pixels.append((0, 0, 0, 0))
            continue

        brightness = (red + green + blue) / 3
        darkness = max(0.0, min(255.0, 255.0 - brightness))
        if darkness < 22:
            processed_pixels.append((255, 255, 255, 0))
            continue

        normalized_alpha = int(max(70, min(255, darkness * 2.1)))
        processed_pixels.append((red, green, blue, normalized_alpha))
        has_visible_ink = True

    image.putdata(processed_pixels)
    if not has_visible_ink:
        raise ValueError("Signature image appears blank after cleanup. Upload a darker signature on a light background.")

    bbox = image.getbbox()
    if bbox:
        image = image.crop(bbox)

    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue(), "image/png"
