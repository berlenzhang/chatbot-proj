from transformers import pipeline as hf_pipeline

ANSWER_PROMPT = """\
Answer the question in 3 to 5 complete sentences, using only the information \
in the context below. Do not answer with a single word or a sentence fragment; \
write full, explanatory sentences. If the context does not contain enough \
information to answer, respond with exactly: I don't know.

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

    def answer(
        self,
        question: str,
        chunks: list[dict],
        context_chunk_count: int,
        context_max_chars: int,
        min_new_tokens: int,
        max_new_tokens: int,
        num_beams: int,
    ) -> tuple[str, list[dict]]:
        if not chunks:
            return (
                "I don't know. The provided document does not contain enough information to answer this question.",
                [],
            )
        top_chunks = chunks[:context_chunk_count]
        context_block = self._build_context_block(top_chunks, max_chars=context_max_chars)
        prompt = ANSWER_PROMPT.format(context_block=context_block, question=question)
        result = self._pipeline(
            prompt,
            max_new_tokens=max_new_tokens,
            min_new_tokens=min_new_tokens,
            num_beams=num_beams,
            no_repeat_ngram_size=3,
        )
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

    def _build_context_block(self, chunks: list[dict], max_chars: int) -> str:
        return "\n\n".join(chunk["text"][:max_chars] for chunk in chunks)
