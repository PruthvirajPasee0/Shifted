from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_admin
from ..models import (
    User,
    Document,
    Vehicle,
    Ride,
    Organization,
    UserStatus,
    UserRole,
    DocStatus,
    DocType,
)
from ..security import hash_password
from ..services.notifications import notifications

DOC_LABELS = {
    DocType.driving_license: "Driving Licence",
    DocType.id_proof: "ID Proof",
    DocType.vehicle_rc: "Vehicle RC",
    DocType.vehicle_insurance: "Vehicle Insurance",
}
from ..schemas import (
    UserOut,
    UserStatusUpdate,
    DocumentOut,
    DocumentVerify,
    AdminEmployeeCreate,
    AdminStats,
    AdminVehicleOut,
    OrgOut,
    OrgUpdate,
)

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/stats", response_model=AdminStats)
def stats(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    org_users = select(User.id).where(User.org_id == admin.org_id).scalar_subquery()

    total_employees = db.scalar(
        select(func.count()).select_from(User).where(
            User.org_id == admin.org_id, User.role == UserRole.employee
        )
    )
    registered_vehicles = db.scalar(
        select(func.count()).select_from(Vehicle).where(Vehicle.owner_id.in_(org_users))
    )
    month_start = datetime.now(timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )
    rides_this_month = db.scalar(
        select(func.count())
        .select_from(Ride)
        .where(Ride.driver_id.in_(org_users), Ride.created_at >= month_start)
    )
    pending_documents = db.scalar(
        select(func.count())
        .select_from(Document)
        .where(Document.user_id.in_(org_users), Document.status == DocStatus.pending)
    )
    suspended_employees = db.scalar(
        select(func.count()).select_from(User).where(
            User.org_id == admin.org_id, User.status == UserStatus.suspended
        )
    )
    pending_approvals = db.scalar(
        select(func.count()).select_from(User).where(
            User.org_id == admin.org_id,
            User.role == UserRole.employee,
            User.status == UserStatus.invited,
        )
    )
    return AdminStats(
        total_employees=total_employees or 0,
        registered_vehicles=registered_vehicles or 0,
        rides_this_month=rides_this_month or 0,
        pending_documents=pending_documents or 0,
        suspended_employees=suspended_employees or 0,
        pending_approvals=pending_approvals or 0,
    )


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    users = list(
        db.scalars(
            select(User).where(User.org_id == admin.org_id).order_by(User.created_at)
        ).all()
    )
    # Pending approvals first so admins see new registrations immediately.
    rank = {UserStatus.invited: 0, UserStatus.suspended: 1, UserStatus.active: 2}
    users.sort(key=lambda u: (rank.get(u.status, 9), u.created_at or datetime.min.replace(tzinfo=timezone.utc)))
    return users


@router.post("/employees", response_model=UserOut, status_code=201)
def create_employee(
    payload: AdminEmployeeCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        org_id=admin.org_id,
        name=payload.name,
        email=payload.email,
        phone=payload.phone,
        password_hash=hash_password(payload.password),
        role=UserRole.employee,
        status=UserStatus.active,
        department=payload.department,
        manager=payload.manager,
        office_location=payload.office_location,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Welcome email with temporary credentials.
    org = db.get(Organization, admin.org_id)
    notifications.notify_welcome_employee(
        db,
        user=user,
        temp_password=payload.password,
        org_name=org.name if org else "your organisation",
        background_tasks=background_tasks,
    )
    db.commit()
    db.refresh(user)
    return user


@router.get("/vehicles", response_model=list[AdminVehicleOut])
def list_vehicles(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    rows = db.execute(
        select(Vehicle, User.name)
        .join(User, Vehicle.owner_id == User.id)
        .where(User.org_id == admin.org_id)
    ).all()
    out = []
    for vehicle, owner_name in rows:
        out.append(
            AdminVehicleOut(
                id=vehicle.id,
                owner_id=vehicle.owner_id,
                owner_name=owner_name,
                model=vehicle.model,
                reg_number=vehicle.reg_number,
                seating_capacity=vehicle.seating_capacity,
                fuel_type=vehicle.fuel_type,
                mileage_kmpl=vehicle.mileage_kmpl,
                color=vehicle.color,
                is_active=vehicle.is_active,
            )
        )
    return out


@router.get("/org", response_model=OrgOut)
def get_org(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    org = db.get(Organization, admin.org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


@router.patch("/org", response_model=OrgOut)
def update_org(
    payload: OrgUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    org = db.get(Organization, admin.org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(org, field, value)
    db.commit()
    db.refresh(org)
    return org


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user_status(
    user_id: str,
    payload: UserStatusUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = db.get(User, user_id)
    if not user or user.org_id != admin.org_id:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == UserRole.admin and payload.status != UserStatus.active:
        raise HTTPException(status_code=400, detail="Cannot change admin account status")

    previous = user.status
    if payload.status == UserStatus.suspended:
        user.revoked_at = datetime.now(timezone.utc)
        user.revoked_by = admin.id
    else:
        user.revoked_at = None
        user.revoked_by = None
    user.status = payload.status
    db.commit()
    db.refresh(user)

    # Tell the employee when access is granted for the first time.
    if previous == UserStatus.invited and payload.status == UserStatus.active:
        notifications.notify_access_granted(
            db,
            user=user,
            background_tasks=background_tasks,
        )
        db.commit()

    return user


@router.get("/documents", response_model=list[DocumentOut])
def list_documents(
    status: DocStatus | None = Query(default=DocStatus.pending),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    # Only documents belonging to users in the admin's org.
    stmt = (
        select(Document)
        .join(User, Document.user_id == User.id)
        .where(User.org_id == admin.org_id)
    )
    if status is not None:
        stmt = stmt.where(Document.status == status)
    return db.scalars(stmt).all()


@router.patch("/documents/{doc_id}/verify", response_model=DocumentOut)
def verify_document(
    doc_id: str,
    payload: DocumentVerify,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    owner = db.get(User, doc.user_id)
    if not owner or owner.org_id != admin.org_id:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.status != DocStatus.pending:
        raise HTTPException(
            status_code=400,
            detail=f"Document is already {doc.status.value}",
        )
    if payload.status not in (DocStatus.verified, DocStatus.rejected):
        raise HTTPException(status_code=400, detail="status must be verified or rejected")
    if payload.status == DocStatus.rejected and not (payload.rejection_reason or "").strip():
        raise HTTPException(status_code=400, detail="rejection_reason is required")

    # Do not verify an already-expired licence / paper.
    if (
        payload.status == DocStatus.verified
        and doc.expiry_date is not None
        and doc.expiry_date < datetime.now(timezone.utc).date()
    ):
        raise HTTPException(status_code=400, detail="Cannot verify an expired document")

    doc.status = payload.status
    doc.verified_by = admin.id
    doc.verified_at = datetime.now(timezone.utc)
    doc.rejection_reason = (
        payload.rejection_reason.strip() if payload.status == DocStatus.rejected else None
    )

    doc_label = DOC_LABELS.get(doc.doc_type, "Document")
    if payload.status == DocStatus.verified:
        notifications.notify_document_verified(
            db,
            owner=owner,
            doc_label=doc_label,
            background_tasks=background_tasks,
        )
    else:
        notifications.notify_document_rejected(
            db,
            owner=owner,
            doc_label=doc_label,
            reason=payload.rejection_reason,
            background_tasks=background_tasks,
        )

    db.commit()
    db.refresh(doc)
    return doc
