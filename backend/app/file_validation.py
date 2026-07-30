from __future__ import annotations

from io import BytesIO
from typing import BinaryIO


MAX_PDF_PAGES = 50


def validate_pdf_bytes(raw_bytes: bytes, *, max_pages: int = MAX_PDF_PAGES) -> None:
    if not raw_bytes.startswith(b"%PDF-"):
        raise ValueError("PDF content does not match its file type.")
    validate_pdf_file(BytesIO(raw_bytes), max_pages=max_pages)


def validate_pdf_file(file_obj: BinaryIO, *, max_pages: int = MAX_PDF_PAGES) -> None:
    original_position = file_obj.tell()
    try:
        from pypdf import PdfReader

        file_obj.seek(0)
        if file_obj.read(5) != b"%PDF-":
            raise ValueError("PDF content does not match its file type.")
        file_obj.seek(0)
        reader = PdfReader(file_obj, strict=True)
        if reader.is_encrypted:
            raise ValueError("Encrypted PDF files are not supported.")
        page_count = len(reader.pages)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("The PDF file is malformed or unsafe.") from exc
    finally:
        file_obj.seek(original_position)
    if page_count < 1:
        raise ValueError("The PDF file has no pages.")
    if page_count > max_pages:
        raise ValueError(f"PDF files must contain no more than {max_pages} pages.")
