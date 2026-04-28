from __future__ import annotations

from io import BytesIO

try:
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURES = (b"\xff\xd8\xff",)


def _looks_like_supported_image(raw_bytes: bytes, content_type: str) -> bool:
    normalized = content_type.strip().lower()
    if normalized == "image/png":
        return raw_bytes.startswith(PNG_SIGNATURE)
    if normalized == "image/jpeg":
        return any(raw_bytes.startswith(signature) for signature in JPEG_SIGNATURES)
    return False


def normalize_signature_image(raw_bytes: bytes, content_type: str) -> tuple[bytes, str]:
    if not raw_bytes:
        raise ValueError("Signature file is empty.")
    if Image is None:
        return raw_bytes, content_type

    try:
        image = Image.open(BytesIO(raw_bytes)).convert("RGBA")
    except Exception as exc:  # pragma: no cover
        if _looks_like_supported_image(raw_bytes, content_type):
            return raw_bytes, content_type
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
