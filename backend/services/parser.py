import os
from pathlib import Path


def parse_document(filepath: str) -> list[dict]:
    ext = Path(filepath).suffix.lower()
    if ext == ".pdf":
        return _parse_pdf(filepath)
    elif ext == ".docx":
        return _parse_docx(filepath)
    elif ext == ".txt":
        return _parse_txt(filepath)
    else:
        raise ValueError(f"Unsupported file extension: {ext}")


def _parse_pdf(filepath: str) -> list[dict]:
    import fitz  # PyMuPDF

    pages = []
    doc = fitz.open(filepath)
    for page_num, page in enumerate(doc, start=1):
        text = page.get_text("text").strip()
        if text:
            pages.append({"text": text, "page": page_num})
    doc.close()
    return pages


def _parse_docx(filepath: str) -> list[dict]:
    import docx

    doc = docx.Document(filepath)
    text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    if not text:
        return []
    return [{"text": text, "page": None}]


def _parse_txt(filepath: str) -> list[dict]:
    with open(filepath, encoding="utf-8", errors="replace") as f:
        text = f.read().strip()
    if not text:
        return []
    return [{"text": text, "page": None}]
