from pathlib import Path

from pydantic_settings import BaseSettings

# Project root is one level above this file (backend/)
_PROJECT_ROOT = Path(__file__).parent.parent


class Settings(BaseSettings):
    uploads_path: str = str(_PROJECT_ROOT / "data" / "uploads")
    chroma_path: str = str(_PROJECT_ROOT / "data" / "chroma_db")
    hf_model: str = "google/flan-t5-base"
    embedding_model: str = "all-MiniLM-L6-v2"
    chunk_size: int = 512
    chunk_overlap: int = 64
    top_k: int = 5
    similarity_threshold: float = 1.5
    answer_context_chunk_count: int = 4
    answer_context_max_chars: int = 400
    answer_min_new_tokens: int = 32
    answer_max_new_tokens: int = 300
    answer_num_beams: int = 1

    class Config:
        env_file = str(_PROJECT_ROOT / ".env")


settings = Settings()
