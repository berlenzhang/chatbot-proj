import os
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from config import settings
from dependencies import get_embedder, get_llm, get_retriever
from models.schemas import UploadResponse
from services.chunker import chunk_document
from services.parser import parse_document

router = APIRouter()

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}


@router.post("/upload", response_model=UploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    embedder=Depends(get_embedder),
    retriever=Depends(get_retriever),
    llm=Depends(get_llm),
):
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Accepted: .pdf, .docx, .txt",
        )

    save_path = os.path.join(settings.uploads_path, file.filename)
    try:
        content = await file.read()
        async with aiofiles.open(save_path, "wb") as f:
            await f.write(content)

        pages = parse_document(save_path)
        if not pages:
            raise ValueError("Document appears to be empty or unreadable.")

        chunks = chunk_document(
            pages,
            file.filename,
            chunk_size=settings.chunk_size,
            overlap=settings.chunk_overlap,
        )
        if not chunks:
            raise ValueError("Document produced no indexable chunks.")

        texts = [c["text"] for c in chunks]
        embeddings = embedder.embed(texts)
        retriever.add_chunks(chunks, embeddings)

        summary_chunks = sorted(chunks, key=lambda c: c["metadata"]["chunk_index"])[
            : settings.summary_chunk_count
        ]
        summary = llm.summarize(summary_chunks)

        return UploadResponse(
            filename=file.filename,
            chunk_count=len(chunks),
            summary=summary,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process document: {e}")
