from fastapi import APIRouter, Depends

from config import settings
from dependencies import get_embedder, get_llm, get_retriever
from models.schemas import Citation, QueryRequest, QueryResponse

router = APIRouter()


@router.post("/query", response_model=QueryResponse)
async def query_document(
    body: QueryRequest,
    embedder=Depends(get_embedder),
    retriever=Depends(get_retriever),
    llm=Depends(get_llm),
):
    query_vector = embedder.embed_one(body.question)
    chunks = retriever.search(
        query_vector,
        n_results=settings.top_k,
        source_filter=body.filename,
        distance_threshold=settings.similarity_threshold,
    )
    answer_text, citations_data = llm.answer(body.question, chunks)
    citations = [Citation(**c) for c in citations_data]
    return QueryResponse(answer=answer_text, citations=citations)
