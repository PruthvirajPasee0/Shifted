from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select, and_
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_active_user
from ..models import User, Document, DocStatus, DocType, UserRole, UserStatus
from ..schemas import DocumentCreate, DocumentOut
from ..services import notifications as notify
from ..services.file_storage import persist_document_file, resolve_stored_path

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("", response_model=list[DocumentOut])
def list_my_documents(db: Session = Depends(get_db), user: User = Depends(get_current_active_user)):
    return db.scalars(
        select(Document)
        .where(Document.user_id == user.id)
        .order_by(Document.uploaded_at.desc())
    ).all()


@router.get("/files/{owner_id}/{filename}")
def serve_document_file(
    owner_id: str,
    filename: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    """Serve a stored document file (owner or same-org admin only)."""
    owner = db.get(User, owner_id)
    if not owner:
        raise HTTPException(status_code=404, detail="File not found")
    if user.id != owner_id and not (
        user.role == UserRole.admin and user.org_id == owner.org_id
    ):
        raise HTTPException(status_code=403, detail="Not allowed")
    path = resolve_stored_path(owner_id, filename)
    if not path:
        raise HTTPException(status_code=404, detail="File not found")
    media = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media, filename=path.name)


@router.post("", response_model=DocumentOut, status_code=201)
def upload_document(
    payload: DocumentCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    if not payload.file_url:
        raise HTTPException(status_code=400, detail="Document file is required")

    if payload.expiry_date is not None and payload.expiry_date < date.today():
        raise HTTPException(
            status_code=400,
            detail="Expiry date cannot be in the past",
        )

    # Driving licence should carry an expiry so the offer-ride gate stays meaningful.
    if payload.doc_type == DocType.driving_license and payload.expiry_date is None:
        raise HTTPException(
            status_code=400,
            detail="Expiry date is required for driving_license",
        )

    try:
        stored_url = persist_document_file(user.id, payload.file_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # One open review at a time per type — supersede older pending rows.
    pending = db.scalars(
        select(Document).where(
            and_(
                Document.user_id == user.id,
                Document.doc_type == payload.doc_type,
                Document.status == DocStatus.pending,
            )
        )
    ).all()
    for old in pending:
        old.status = DocStatus.rejected
        old.rejection_reason = "Superseded by a newer upload"

    doc = Document(
        user_id=user.id,
        doc_type=payload.doc_type,
        doc_number=payload.doc_number,
        file_url=stored_url,
        expiry_date=payload.expiry_date,
        status=DocStatus.pending,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    admins = db.scalars(
        select(User).where(
            User.org_id == user.org_id,
            User.role == UserRole.admin,
            User.status == UserStatus.active,
        )
    ).all()
    label = payload.doc_type.value.replace("_", " ")
    for admin in admins:
        notify.push(
            db,
            admin,
            "document_pending",
            "Document awaiting verification",
            f"{user.name} submitted a {label} for review.",
            ref_id=doc.id,
            background_tasks=background_tasks,
        )
    db.commit()

    return doc
