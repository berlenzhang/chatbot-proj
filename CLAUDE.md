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

**Query flow:** `POST /query` → embed the question → ChromaDB cosine similarity search (top-5, distance threshold 1.5) → `llm.py` builds a truncated context block (top 4 chunks, 400 chars/chunk max, both configurable) and calls flan-t5-base with `min_new_tokens` enforced to avoid bare-fragment answers → return answer + citations.

**Key design constraints:**
- `flan-t5-base` has a 512-token input limit — the context budget (`answer_context_chunk_count=4` chunks × `answer_context_max_chars=400` chars, both in `config.py`) is sized to leave a real safety margin, since the tokenizer truncates from the right and an oversized prompt can clip the `Question:`/`Answer:` cue itself, not just the context.
- Bare-fragment answers (e.g. "Motorcycle riding gear" instead of a full sentence) were caused by greedy decoding stopping at the shortest valid span — `answer_min_new_tokens` (default 32, in `config.py`) forces the model past that point. Prompt wording alone (including a one-shot example) was tested and found to have no effect on this; `min_new_tokens` is the lever that matters. Beam search was also tested and rejected — ~2x latency with no quality gain.
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
