from __future__ import annotations


def chunk_document(
    pages: list[dict],
    filename: str,
    chunk_size: int = 512,
    overlap: int = 64,
    min_length: int = 50,
) -> list[dict]:
    # Flatten all pages into (word, page_number) tuples
    words_with_pages: list[tuple[str, int | None]] = []
    for page in pages:
        for word in page["text"].split():
            words_with_pages.append((word, page["page"]))

    if not words_with_pages:
        return []

    chunks = []
    chunk_index = 0
    start = 0
    step = max(1, chunk_size - overlap)

    while start < len(words_with_pages):
        end = min(start + chunk_size, len(words_with_pages))
        window = words_with_pages[start:end]
        text = " ".join(w for w, _ in window)

        if len(text) >= min_length:
            page_num = window[0][1]
            chunks.append({
                "text": text,
                "metadata": {
                    "source": filename,
                    "page": page_num,
                    "chunk_index": chunk_index,
                },
            })
            chunk_index += 1

        start += step

    return chunks
