import re
from pathlib import Path
import fitz
from docx import Document as DocxDocument
from google import genai
from google.genai import types
from qdrant_client import QdrantClient, models
from .config import get_settings


settings = get_settings()


def qdrant_client() -> QdrantClient:
    return QdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key or None)


def gemini_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured")
    return genai.Client(api_key=settings.gemini_api_key)


def extract_pages(path: Path, suffix: str) -> list[tuple[int, str]]:
    if suffix == ".pdf":
        with fitz.open(path) as pdf:
            return [(index + 1, page.get_text("text")) for index, page in enumerate(pdf)]
    if suffix == ".docx":
        doc = DocxDocument(path)
        return [(1, "\n".join(p.text for p in doc.paragraphs))]
    if suffix == ".txt":
        return [(1, path.read_text(encoding="utf-8", errors="replace"))]
    raise ValueError("Unsupported file type")


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def chunks_from_pages(pages: list[tuple[int, str]]) -> list[tuple[int, str]]:
    chunks: list[tuple[int, str]] = []
    step = max(1, settings.chunk_size - settings.chunk_overlap)
    for page, raw in pages:
        text = clean_text(raw)
        for start in range(0, len(text), step):
            chunk = text[start : start + settings.chunk_size].strip()
            if len(chunk) >= 40:
                chunks.append((page, chunk))
    return chunks


def embed(texts: list[str], task_type: str) -> list[list[float]]:
    response = gemini_client().models.embed_content(
        model=settings.gemini_embedding_model,
        contents=texts,
        config=types.EmbedContentConfig(task_type=task_type, output_dimensionality=768),
    )
    return [item.values for item in response.embeddings]


def ensure_collection(client: QdrantClient):
    if not client.collection_exists(settings.qdrant_collection):
        client.create_collection(
            collection_name=settings.qdrant_collection,
            vectors_config=models.VectorParams(size=768, distance=models.Distance.COSINE),
        )


def index_document(document_id: int, user_id: int, filename: str, path: Path) -> int:
    chunks = chunks_from_pages(extract_pages(path, path.suffix.lower()))
    if not chunks:
        raise ValueError("No readable text was found in this document")
    client = qdrant_client()
    ensure_collection(client)
    next_id = document_id * 10_000_000
    batch_size = 50
    for offset in range(0, len(chunks), batch_size):
        batch = chunks[offset : offset + batch_size]
        vectors = embed([text for _, text in batch], "RETRIEVAL_DOCUMENT")
        points = [
            models.PointStruct(
                id=next_id + offset + index,
                vector=vector,
                payload={
                    "document_id": document_id,
                    "user_id": user_id,
                    "filename": filename,
                    "page": page,
                    "text": text,
                },
            )
            for index, ((page, text), vector) in enumerate(zip(batch, vectors))
        ]
        client.upsert(settings.qdrant_collection, points=points, wait=True)
    return len(chunks)


def delete_vectors(document_id: int, user_id: int):
    client = qdrant_client()
    if client.collection_exists(settings.qdrant_collection):
        client.delete(
            settings.qdrant_collection,
            points_selector=models.FilterSelector(
                filter=models.Filter(must=[
                    models.FieldCondition(key="document_id", match=models.MatchValue(value=document_id)),
                    models.FieldCondition(key="user_id", match=models.MatchValue(value=user_id)),
                ])
            ),
            wait=True,
        )


def retrieve(question: str, user_id: int, document_ids: list[int] | None):
    client = qdrant_client()
    if not client.collection_exists(settings.qdrant_collection):
        return []
    conditions = [models.FieldCondition(key="user_id", match=models.MatchValue(value=user_id))]
    if document_ids:
        conditions.append(models.FieldCondition(key="document_id", match=models.MatchAny(any=document_ids)))
    query_vector = embed([question], "RETRIEVAL_QUERY")[0]
    response = client.query_points(
        collection_name=settings.qdrant_collection,
        query=query_vector,
        query_filter=models.Filter(must=conditions),
        limit=settings.top_k,
        with_payload=True,
    )
    return response.points


def answer_question(question: str, points) -> tuple[str, list[dict]]:
    if not points:
        return "I could not find this information in your uploaded documents.", []
    citations = []
    context_parts = []
    for index, point in enumerate(points, start=1):
        payload = point.payload or {}
        context_parts.append(f"[Source {index}: {payload.get('filename')}, page {payload.get('page')}]\n{payload.get('text', '')}")
        citations.append({
            "document_id": int(payload["document_id"]),
            "filename": str(payload["filename"]),
            "page": payload.get("page"),
            "excerpt": str(payload.get("text", ""))[:300],
            "score": round(float(point.score), 4),
        })
    prompt = f"""You are an academic document assistant. Answer only from the supplied context.
If the context does not contain the answer, say that the information was not found.
Answer in the same language as the question. Use inline citations like [Source 1].

Question: {question}

Context:
{chr(10).join(context_parts)}
"""
    response = gemini_client().models.generate_content(model=settings.gemini_chat_model, contents=prompt)
    return response.text or "No answer was generated.", citations

