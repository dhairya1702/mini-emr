from __future__ import annotations

from io import BytesIO
from math import sqrt

try:
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURES = (b"\xff\xd8\xff",)
BACKGROUND_SAMPLE_SIZE = 4
BACKGROUND_DISTANCE_THRESHOLD = 22.0
BACKGROUND_ALPHA_THRESHOLD = 28
MIN_VISIBLE_ALPHA = 56
MIN_BRIGHTNESS_CONTRAST = 16.0


def _looks_like_supported_image(raw_bytes: bytes, content_type: str) -> bool:
    normalized = content_type.strip().lower()
    if normalized == "image/png":
        return raw_bytes.startswith(PNG_SIGNATURE)
    if normalized == "image/jpeg":
        return any(raw_bytes.startswith(signature) for signature in JPEG_SIGNATURES)
    return False


def _average_background_rgba(image: Image.Image) -> tuple[float, float, float, float]:
    width, height = image.size
    sample_span_x = min(BACKGROUND_SAMPLE_SIZE, width)
    sample_span_y = min(BACKGROUND_SAMPLE_SIZE, height)
    samples: list[tuple[int, int, int, int]] = []

    for y in range(sample_span_y):
        for x in range(sample_span_x):
            samples.append(image.getpixel((x, y)))
            samples.append(image.getpixel((width - 1 - x, y)))
            samples.append(image.getpixel((x, height - 1 - y)))
            samples.append(image.getpixel((width - 1 - x, height - 1 - y)))

    opaque_samples = [pixel for pixel in samples if pixel[3] > 0]
    basis = opaque_samples or samples or [(255, 255, 255, 255)]
    count = len(basis)
    return (
        sum(pixel[0] for pixel in basis) / count,
        sum(pixel[1] for pixel in basis) / count,
        sum(pixel[2] for pixel in basis) / count,
        sum(pixel[3] for pixel in basis) / count,
    )


def _brightness(red: float, green: float, blue: float) -> float:
    return (0.299 * red) + (0.587 * green) + (0.114 * blue)


def _color_distance(red: int, green: int, blue: int, background: tuple[float, float, float, float]) -> float:
    return sqrt(
        ((red - background[0]) ** 2)
        + ((green - background[1]) ** 2)
        + ((blue - background[2]) ** 2)
    )


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

    background = _average_background_rgba(image)
    background_brightness = _brightness(background[0], background[1], background[2])
    processed_pixels = []
    has_visible_ink = False
    for red, green, blue, alpha in image.getdata():
        if alpha == 0:
            processed_pixels.append((0, 0, 0, 0))
            continue

        brightness = _brightness(red, green, blue)
        distance = _color_distance(red, green, blue, background)
        contrast = max(0.0, background_brightness - brightness)
        background_alpha_gap = max(0.0, alpha - background[3])
        ink_strength = max(distance * 2.2, contrast * 2.6, background_alpha_gap * 1.5)

        if distance <= BACKGROUND_DISTANCE_THRESHOLD and contrast <= BACKGROUND_ALPHA_THRESHOLD:
            processed_pixels.append((255, 255, 255, 0))
            continue

        if contrast < MIN_BRIGHTNESS_CONTRAST and distance < (BACKGROUND_DISTANCE_THRESHOLD * 1.65):
            processed_pixels.append((255, 255, 255, 0))
            continue

        normalized_alpha = int(max(0, min(255, ink_strength)))
        if normalized_alpha < MIN_VISIBLE_ALPHA:
            processed_pixels.append((255, 255, 255, 0))
            continue

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
