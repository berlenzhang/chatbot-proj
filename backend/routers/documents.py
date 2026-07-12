import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse

from config import settings
from dependencies import get_retriever
from models.schemas import DeleteResponse, DocumentInfo, DocumentsResponse
from routers.upload import ALLOWED_EXTENSIONS
from services.parser import parse_document

router = APIRouter()


@router.get("/documents", response_model=DocumentsResponse)
async def list_documents(retriever=Depends(get_retriever)):
    sources = retriever.list_sources()
    return DocumentsResponse(documents=[DocumentInfo(**s) for s in sources])


@router.get("/documents/{filename}/file")
async def get_document_file(filename: str):
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Preview not supported for {ext} files.")

    uploads_dir = Path(settings.uploads_path).resolve()
    file_path = (uploads_dir / filename).resolve()
    if file_path.parent != uploads_dir or not file_path.is_file():
        raise HTTPException(status_code=404, detail=f"File '{filename}' not found.")

    if ext == ".docx":
        pages = parse_document(str(file_path))
        text = "\n\n".join(p["text"] for p in pages)
        return PlainTextResponse(text)

    media_type = "application/pdf" if ext == ".pdf" else "text/plain"
    return FileResponse(
        file_path,
        media_type=media_type,
        filename=filename,
        content_disposition_type="inline",
    )


@router.delete("/documents/{filename}", response_model=DeleteResponse)
async def delete_document(filename: str, retriever=Depends(get_retriever)):
    try:
        retriever.delete_source(filename)
    except ValueError:
        raise HTTPException(
            status_code=404,
            detail=f"Document '{filename}' not found in index.",
        )

    raw_path = os.path.join(settings.uploads_path, filename)
    if os.path.exists(raw_path):
        os.remove(raw_path)

    return DeleteResponse(deleted=True, filename=filename)
