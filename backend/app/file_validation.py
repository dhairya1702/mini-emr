from __future__ import annotations

from io import BytesIO


MAX_PDF_PAGES = 50


def validate_pdf_bytes(raw_bytes: bytes, *, max_pages: int = MAX_PDF_PAGES) -> None:
    if not raw_bytes.startswith(b"%PDF-"):
        raise ValueError("PDF content does not match its file type.")
    try:
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(raw_bytes), strict=True)
        if reader.is_encrypted:
            raise ValueError("Encrypted PDF files are not supported.")
        page_count = len(reader.pages)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("The PDF file is malformed or unsafe.") from exc
    if page_count < 1:
        raise ValueError("The PDF file has no pages.")
    if page_count > max_pages:
        raise ValueError(f"PDF files must contain no more than {max_pages} pages.")
