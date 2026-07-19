"""Store uploaded document bytes on disk; DB keeps a short path/URL only."""

from __future__ import annotations

import base64
import re
import uuid
from pathlib import Path

UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "docs"

_DATA_URL_RE = re.compile(
    r"^data:(?P<mime>[\w/+.-]+);base64,(?P<data>.+)$", re.DOTALL
)

_MIME_EXT = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
}


def persist_document_file(user_id: str, file_url: str) -> str:
    """If `file_url` is a data URL, write bytes to disk and return a serve path.

    Non-data URLs (already-stored paths / external) are returned unchanged.
    """
    match = _DATA_URL_RE.match(file_url.strip())
    if not match:
        return file_url

    mime = match.group("mime").lower()
    raw = base64.b64decode(match.group("data"), validate=False)
    if len(raw) > 5 * 1024 * 1024:
        raise ValueError("File exceeds 5 MB limit")

    ext = _MIME_EXT.get(mime, ".bin")
    folder = UPLOAD_ROOT / str(user_id)
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{ext}"
    path = folder / name
    path.write_bytes(raw)
    # Served via GET /api/documents/files/{user_id}/{name}
    return f"/api/documents/files/{user_id}/{name}"


def resolve_stored_path(user_id: str, filename: str) -> Path | None:
    """Resolve a stored file under uploads/docs; reject path traversal."""
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        return None
    path = (UPLOAD_ROOT / str(user_id) / filename).resolve()
    try:
        path.relative_to(UPLOAD_ROOT.resolve())
    except ValueError:
        return None
    if not path.is_file():
        return None
    return path
