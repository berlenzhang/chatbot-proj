from pydantic import BaseModel, Field
from typing import Optional


class UploadResponse(BaseModel):
    filename: str
    chunk_count: int


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1)
    filename: Optional[str] = None


class Citation(BaseModel):
    source: str
    page: Optional[int] = None
    chunk_index: int
    excerpt: str


class QueryResponse(BaseModel):
    answer: str
    citations: list[Citation]


class DocumentInfo(BaseModel):
    filename: str
    chunk_count: int


class DocumentsResponse(BaseModel):
    documents: list[DocumentInfo]


class DeleteResponse(BaseModel):
    deleted: bool
    filename: str
