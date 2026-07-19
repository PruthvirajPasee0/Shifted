"""Lightweight ALTER TABLE helpers for SQLite when create_all won't add columns."""

from datetime import date, datetime, timezone

from sqlalchemy import select, text

from .database import SessionLocal, engine
from .models import Document, DocStatus, DocType, User, UserRole


def _sqlite_columns(conn, table: str) -> set[str]:
    return {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})")).fetchall()}


def _ensure_column(conn, table: str, column: str, ddl: str) -> None:
    cols = _sqlite_columns(conn, table)
    if column not in cols:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))


def ensure_schema() -> None:
    if str(engine.url).startswith("sqlite"):
        with engine.begin() as conn:
            _ensure_column(conn, "notifications", "ref_id", "ref_id VARCHAR(36)")
            _ensure_column(
                conn, "payments", "refund_status", "refund_status VARCHAR(24) DEFAULT 'none'"
            )
            _ensure_column(
                conn, "payments", "refunded_amount", "refunded_amount NUMERIC(12,2) DEFAULT 0"
            )
            _ensure_column(conn, "payments", "refund_ref", "refund_ref VARCHAR(128)")
            _ensure_column(conn, "messages", "is_read", "is_read BOOLEAN DEFAULT 0")

            # Refresh partial unique index so rejected bookings can rebook.
            conn.execute(text("DROP INDEX IF EXISTS uq_booking_ride_passenger_active"))
            conn.execute(
                text(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_ride_passenger_active
                    ON bookings (ride_id, passenger_id)
                    WHERE status NOT IN ('cancelled', 'rejected')
                    """
                )
            )

    # Demo continuity: users with a verified licence also get RC + insurance
    # so offer-ride is not blocked after the new gate ships.
    db = SessionLocal()
    try:
        drivers = db.scalars(
            select(Document.user_id).where(
                Document.doc_type == DocType.driving_license,
                Document.status == DocStatus.verified,
            )
        ).all()
        admin = db.scalar(select(User).where(User.role == UserRole.admin))
        for uid in drivers:
            for dtype, number in (
                (DocType.vehicle_rc, "RC-AUTO"),
                (DocType.vehicle_insurance, "INS-AUTO"),
            ):
                exists = db.scalar(
                    select(Document).where(
                        Document.user_id == uid, Document.doc_type == dtype
                    )
                )
                if exists:
                    continue
                db.add(
                    Document(
                        user_id=uid,
                        doc_type=dtype,
                        doc_number=number,
                        file_url=f"https://example.com/docs/{dtype.value}.pdf",
                        status=DocStatus.verified,
                        expiry_date=date(2030, 12, 31),
                        verified_by=admin.id if admin else None,
                        verified_at=datetime.now(timezone.utc),
                    )
                )
        db.commit()
    finally:
        db.close()
