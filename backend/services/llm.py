from transformers import pipeline as hf_pipeline

ANSWER_PROMPT = """\
Answer the question using only the context below. \
If the answer is not in the context, say "I don't know."

Context:
{context_block}

Question: {question}
Answer:"""

class LLMService:
    def __init__(self, model_name: str = "google/flan-t5-base"):
        self._pipeline = hf_pipeline(
            "text2text-generation",
            model=model_name,
            truncation=True,
        )

    def answer(self, question: str, chunks: list[dict]) -> tuple[str, list[dict]]:
        if not chunks:
            return (
                "I don't know. The provided document does not contain enough information to answer this question.",
                [],
            )
        # Use top 3 chunks; truncate each to 300 chars so the prompt fits in flan-t5's 512-token window
        top_chunks = chunks[:3]
        context_block = self._build_context_block(top_chunks, max_chars=300)
        prompt = ANSWER_PROMPT.format(context_block=context_block, question=question)
        result = self._pipeline(prompt, max_new_tokens=300)
        answer_text = result[0]["generated_text"]
        citations = [
            {
                "source": c["metadata"]["source"],
                "page": c["metadata"].get("page"),
                "chunk_index": c["metadata"]["chunk_index"],
                "excerpt": c["text"][:200],
            }
            for c in chunks
        ]
        return answer_text, citations

    def _build_context_block(self, chunks: list[dict], max_chars: int = 300) -> str:
        parts = []
        for i, chunk in enumerate(chunks, start=1):
            meta = chunk["metadata"]
            page = meta.get("page")
            page_str = str(page) if page is not None else "N/A"
            header = (
                f"[Excerpt {i} | Source: {meta['source']} "
                f"| Page: {page_str} | Chunk: {meta['chunk_index']}]"
            )
            text = chunk["text"][:max_chars]
            parts.append(f"{header}\n{text}")
        return "\n\n".join(parts)
