import os

from fastapi import APIRouter, Depends, HTTPException

from config import settings
from dependencies import get_retriever
from models.schemas import DeleteResponse, DocumentInfo, DocumentsResponse

router = APIRouter()


@router.get("/documents", response_model=DocumentsResponse)
async def list_documents(retriever=Depends(get_retriever)):
    sources = retriever.list_sources()
    return DocumentsResponse(documents=[DocumentInfo(**s) for s in sources])


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
