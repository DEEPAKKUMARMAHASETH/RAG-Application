from datetime import datetime
from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    is_admin: bool
    model_config = ConfigDict(from_attributes=True)


class DocumentResponse(BaseModel):
    id: int
    original_name: str
    content_type: str
    size_bytes: int
    status: str
    chunk_count: int
    error_message: str | None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class ChatRequest(BaseModel):
    question: str = Field(min_length=2, max_length=4000)
    conversation_id: int | None = None
    document_ids: list[int] | None = None


class ConversationUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class Citation(BaseModel):
    document_id: int
    filename: str
    page: int | None
    excerpt: str
    score: float


class ChatResponse(BaseModel):
    conversation_id: int
    answer: str
    citations: list[Citation]
