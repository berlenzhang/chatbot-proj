# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git commits
Do not include `Co-Authored-By: Claude` in commit messages.

## Running the app

**Backend** (from `backend/`):
```bash
source ../venv/bin/activate
uvicorn main:app --reload --port 8000
```

**Frontend** (from `frontend/`):
```bash
python3 -m http.server 3000
```

The backend auto-creates `data/uploads/` and `data/chroma_db/` on first startup. Interactive API docs at `http://localhost:8000/docs`.

## Architecture

This is a RAG (Retrieval-Augmented Generation) document assistant. The full pipeline:

**Upload flow:** `POST /upload` → `parser.py` extracts text by page → `chunker.py` splits into 512-word overlapping windows (64-word overlap) → `embedder.py` encodes with all-MiniLM-L6-v2 (384-dim) → `retriever.py` upserts into ChromaDB → `llm.py` summarizes the first 8 chunks.

**Query flow:** `POST /query` → embed the question → ChromaDB cosine similarity search (top-5, distance threshold 1.5) → `llm.py` builds a truncated context block (300 chars/chunk max) and calls flan-t5-base → return answer + citations.

**Key design constraints:**
- `flan-t5-base` has a 512-token input limit — the `max_chars=300` truncation in `llm.py:_build_context_block` is intentional to keep prompts within this window.
- ChromaDB rejects `None` metadata values — `retriever.py:add_chunks` converts `None` page numbers to `0`. Page `0` means "no page info" (TXT/DOCX files).
- The similarity threshold is cosine *distance* (0–2 scale), not cosine similarity. `1.5` is the permissive default; `0.8` was too strict and caused all chunks to be filtered.
- The `lru_cache` singletons in `dependencies.py` ensure the embedding model and ChromaDB client are loaded once per process, not per request.

**Settings** (`backend/config.py`): all tunables live in `Settings` (Pydantic BaseSettings). Override via `.env` at the project root. Key fields: `hf_model`, `embedding_model`, `chunk_size`, `chunk_overlap`, `top_k`, `similarity_threshold`, `summary_chunk_count`.

**Module responsibilities:**
- `services/parser.py` — file-type dispatch; returns `[{text, page}]`
- `services/chunker.py` — sliding window chunker; returns `[{text, metadata}]`
- `services/embedder.py` — `Embedder` class wrapping sentence-transformers
- `services/retriever.py` — `Retriever` class wrapping ChromaDB
- `services/llm.py` — `LLMService` with `summarize()` and `answer()` methods
- `backend/dependencies.py` — FastAPI `Depends` providers via `@lru_cache`
