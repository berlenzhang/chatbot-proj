from __future__ import annotations

import chromadb


class Retriever:
    def __init__(self, persist_path: str):
        self.client = chromadb.PersistentClient(path=persist_path)
        self.collection = self.client.get_or_create_collection(
            name="documents",
            metadata={"hnsw:space": "cosine"},
        )

    def add_chunks(self, chunks: list[dict], embeddings: list[list[float]]) -> None:
        ids = [f"{c['metadata']['source']}::{c['metadata']['chunk_index']}" for c in chunks]
        documents = [c["text"] for c in chunks]
        # ChromaDB rejects None; replace with 0 for missing page numbers
        metadatas = [
            {k: (v if v is not None else 0) for k, v in c["metadata"].items()}
            for c in chunks
        ]
        self.collection.upsert(ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas)

    def search(
        self,
        query_embedding: list[float],
        n_results: int = 5,
        source_filter: str | None = None,
        distance_threshold: float = 1.5,
    ) -> list[dict]:
        where = {"source": source_filter} if source_filter else None
        # Clamp n_results to collection size to avoid ChromaDB errors
        count = self.collection.count()
        if count == 0:
            return []
        actual_n = min(n_results, count)
        kwargs = dict(
            query_embeddings=[query_embedding],
            n_results=actual_n,
            include=["documents", "metadatas", "distances"],
        )
        if where:
            kwargs["where"] = where
        results = self.collection.query(**kwargs)

        chunks = []
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            if dist <= distance_threshold:
                chunks.append({"text": doc, "metadata": meta, "distance": dist})
        return chunks

    def list_sources(self) -> list[dict]:
        result = self.collection.get(include=["metadatas"])
        counts: dict[str, int] = {}
        for meta in result["metadatas"]:
            src = meta.get("source", "unknown")
            counts[src] = counts.get(src, 0) + 1
        return [{"filename": src, "chunk_count": cnt} for src, cnt in counts.items()]

    def delete_source(self, filename: str) -> int:
        result = self.collection.get(where={"source": filename}, include=[])
        ids = result["ids"]
        if not ids:
            raise ValueError(f"No chunks found for source: {filename}")
        self.collection.delete(ids=ids)
        return len(ids)
