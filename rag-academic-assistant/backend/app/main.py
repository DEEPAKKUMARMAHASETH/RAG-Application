import json
import shutil
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session
from .auth import create_token, current_user, hash_password, verify_password
from .config import get_settings
from .database import Base, engine, get_db
from .models import Conversation, Document, Message, User
from .rag import answer_question, delete_vectors, index_document, retrieve
from .schemas import ChatRequest, ChatResponse, DocumentResponse, LoginRequest, RegisterRequest, TokenResponse, UserResponse


settings = get_settings()
allowed_extensions = {".pdf", ".docx", ".txt"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Academic RAG Assistant API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/auth/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(data: RegisterRequest, db: Session = Depends(get_db)):
    email = data.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Email is already registered")
    user = User(email=email, full_name=data.full_name.strip(), password_hash=hash_password(data.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return TokenResponse(access_token=create_token(user.id))


@app.post("/api/auth/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == data.email.lower()))
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return TokenResponse(access_token=create_token(user.id))


@app.get("/api/auth/me", response_model=UserResponse)
def me(user: User = Depends(current_user)):
    return user


@app.get("/api/documents", response_model=list[DocumentResponse])
def list_documents(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(Document).where(Document.user_id == user.id).order_by(Document.id.desc())))


@app.post("/api/documents", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
def upload_document(file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in allowed_extensions:
        raise HTTPException(status_code=415, detail="Only PDF, DOCX and TXT files are supported")
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    path = Path(settings.upload_dir) / stored_name
    with path.open("wb") as output:
        shutil.copyfileobj(file.file, output)
    size = path.stat().st_size
    if size > settings.max_upload_mb * 1024 * 1024:
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=413, detail=f"Maximum file size is {settings.max_upload_mb} MB")
    document = Document(user_id=user.id, original_name=file.filename or stored_name, stored_name=stored_name, content_type=file.content_type or "application/octet-stream", size_bytes=size)
    db.add(document)
    db.commit()
    db.refresh(document)
    try:
        document.chunk_count = index_document(document.id, user.id, document.original_name, path)
        document.status = "ready"
    except Exception as exc:
        document.status = "failed"
        document.error_message = str(exc)[:1000]
    db.commit()
    db.refresh(document)
    return document


@app.delete("/api/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_document(document_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    document = db.scalar(select(Document).where(Document.id == document_id, Document.user_id == user.id))
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    delete_vectors(document.id, user.id)
    (Path(settings.upload_dir) / document.stored_name).unlink(missing_ok=True)
    db.delete(document)
    db.commit()


@app.post("/api/chat", response_model=ChatResponse)
def chat(data: ChatRequest, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if data.document_ids:
        owned = set(db.scalars(select(Document.id).where(Document.user_id == user.id, Document.id.in_(data.document_ids))))
        if owned != set(data.document_ids):
            raise HTTPException(status_code=403, detail="One or more documents are not accessible")
    conversation = None
    if data.conversation_id:
        conversation = db.scalar(select(Conversation).where(Conversation.id == data.conversation_id, Conversation.user_id == user.id))
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")
    if not conversation:
        conversation = Conversation(user_id=user.id, title=data.question[:100])
        db.add(conversation)
        db.flush()
    db.add(Message(conversation_id=conversation.id, role="user", content=data.question))
    try:
        points = retrieve(data.question, user.id, data.document_ids)
        answer, citations = answer_question(data.question, points)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=502, detail=f"RAG service error: {str(exc)[:300]}")
    db.add(Message(conversation_id=conversation.id, role="assistant", content=answer, citations_json=json.dumps(citations)))
    db.commit()
    return ChatResponse(conversation_id=conversation.id, answer=answer, citations=citations)


@app.get("/api/conversations")
def conversations(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Conversation).where(Conversation.user_id == user.id).order_by(Conversation.id.desc())).all()
    return [{"id": row.id, "title": row.title, "created_at": row.created_at} for row in rows]


@app.get("/api/conversations/{conversation_id}")
def conversation_detail(conversation_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.scalar(select(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user.id))
    if not row:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"id": row.id, "title": row.title, "messages": [{"id": msg.id, "role": msg.role, "content": msg.content, "citations": json.loads(msg.citations_json)} for msg in row.messages]}
