from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_active_user
from ..models import PaymentMethod, PmType, User
from ..schemas import PaymentMethodCreate, PaymentMethodOut, PaymentMethodUpdate

router = APIRouter(prefix="/payment-methods", tags=["payment-methods"])


def _mask_detail(method_type: PmType, detail: str) -> str:
    value = detail.strip()
    if method_type == PmType.card:
        digits = "".join(ch for ch in value if ch.isdigit())
        if len(digits) < 4:
            raise HTTPException(status_code=400, detail="Card detail must include at least 4 digits")
        return f"**** **** **** {digits[-4:]}"

    # UPI id masking: keep first 2 chars and domain.
    if "@" not in value:
        raise HTTPException(status_code=400, detail="UPI id must look like name@bank")
    local, domain = value.split("@", 1)
    if len(local) < 2 or not domain:
        raise HTTPException(status_code=400, detail="UPI id must look like name@bank")
    return f"{local[:2]}***@{domain}"


def _unset_defaults(db: Session, user_id: str) -> None:
    rows = db.scalars(select(PaymentMethod).where(PaymentMethod.user_id == user_id)).all()
    for row in rows:
        row.is_default = False


@router.get("", response_model=list[PaymentMethodOut])
def list_payment_methods(
    db: Session = Depends(get_db), user: User = Depends(get_current_active_user)
):
    return db.scalars(
        select(PaymentMethod)
        .where(PaymentMethod.user_id == user.id)
        .order_by(PaymentMethod.is_default.desc(), PaymentMethod.created_at.desc())
    ).all()


@router.post("", response_model=PaymentMethodOut, status_code=201)
def create_payment_method(
    payload: PaymentMethodCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    masked = _mask_detail(payload.type, payload.detail)
    existing = db.scalar(
        select(PaymentMethod).where(
            PaymentMethod.user_id == user.id,
            PaymentMethod.type == payload.type,
            PaymentMethod.masked_detail == masked,
        )
    )
    if existing:
        raise HTTPException(status_code=400, detail="Payment method already saved")

    has_any = db.scalar(
        select(PaymentMethod.id).where(PaymentMethod.user_id == user.id).limit(1)
    )
    make_default = payload.is_default or not bool(has_any)
    if make_default:
        _unset_defaults(db, user.id)

    method = PaymentMethod(
        user_id=user.id,
        type=payload.type,
        label=payload.label.strip() if payload.label else None,
        masked_detail=masked,
        is_default=make_default,
    )
    db.add(method)
    db.commit()
    db.refresh(method)
    return method


@router.patch("/{method_id}", response_model=PaymentMethodOut)
def update_payment_method(
    method_id: str,
    payload: PaymentMethodUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    method = db.get(PaymentMethod, method_id)
    if not method or method.user_id != user.id:
        raise HTTPException(status_code=404, detail="Payment method not found")

    data = payload.model_dump(exclude_unset=True)
    if "label" in data:
        method.label = data["label"].strip() if data["label"] else None
    if data.get("is_default") is True:
        _unset_defaults(db, user.id)
        method.is_default = True
    db.commit()
    db.refresh(method)
    return method


@router.delete("/{method_id}")
def delete_payment_method(
    method_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    method = db.get(PaymentMethod, method_id)
    if not method or method.user_id != user.id:
        raise HTTPException(status_code=404, detail="Payment method not found")

    was_default = bool(method.is_default)
    db.delete(method)
    db.flush()

    if was_default:
        fallback = db.scalar(
            select(PaymentMethod)
            .where(PaymentMethod.user_id == user.id)
            .order_by(PaymentMethod.created_at.asc())
        )
        if fallback:
            fallback.is_default = True

    db.commit()
    return {"ok": True}
