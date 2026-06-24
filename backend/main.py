import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routers import documents, query, upload

app = FastAPI(title="RAG Document Assistant", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    os.makedirs(settings.uploads_path, exist_ok=True)
    os.makedirs(settings.chroma_path, exist_ok=True)


app.include_router(upload.router)
app.include_router(query.router)
app.include_router(documents.router)
