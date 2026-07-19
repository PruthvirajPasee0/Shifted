from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_active_user
from ..models import User, Organization, Wallet, UserRole, UserStatus
from ..security import hash_password, verify_password, create_access_token
from ..schemas import (
    RegisterRequest,
    LoginRequest,
    TokenResponse,
    RegisterPendingResponse,
    UserOut,
    ProfileUpdate,
    OrgPublic,
)
from ..services.notifications import notifications

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/organizations", response_model=list[OrgPublic])
def list_organizations(db: Session = Depends(get_db)):
    """Public list of registered organizations for the signup picker."""
    return db.scalars(select(Organization).order_by(Organization.name)).all()


@router.post(
    "/register",
    response_model=RegisterPendingResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(
    payload: RegisterRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    # Employees may only join an already-registered organization — the admin
    # governs org membership, so we never auto-create one at signup.
    org = db.get(Organization, payload.org_id)
    if not org:
        raise HTTPException(status_code=400, detail="Select a registered organization")

    email_l = payload.email.strip().lower()
    domain = (org.domain or "").strip().lower().lstrip("@")
    if not domain or not email_l.endswith("@" + domain):
        raise HTTPException(
            status_code=400,
            detail=f"Work email must use @{domain} for {org.name}",
        )

    existing = db.scalar(select(User).where(User.email == payload.email))
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Self-signup stays invited until a company admin grants platform access.
    user = User(
        org_id=org.id,
        name=payload.name,
        email=payload.email,
        phone=payload.phone,
        password_hash=hash_password(payload.password),
        role=UserRole.employee,
        status=UserStatus.invited,
        photo_url=payload.photo_url,
        department=payload.department,
        manager=payload.manager,
        office_location=payload.office_location,
    )
    db.add(user)
    db.flush()

    # Belt-and-suspenders: force invited in DB (guards against model default races).
    db.execute(
        update(User).where(User.id == user.id).values(status=UserStatus.invited)
    )
    db.add(Wallet(user_id=user.id, balance=0))
    db.commit()
    db.refresh(user)

    if user.status != UserStatus.invited:
        user.status = UserStatus.invited
        db.commit()
        db.refresh(user)

    # Alert org admins so they can approve the new employee.
    admins = db.scalars(
        select(User).where(
            User.org_id == org.id,
            User.role == UserRole.admin,
            User.status == UserStatus.active,
        )
    ).all()
    for admin in admins:
        notifications.notify_user_pending_approval(
            db,
            admin=admin,
            applicant=user,
            background_tasks=background_tasks,
        )
    db.commit()

    return RegisterPendingResponse(
        message=(
            "Registration received. A company administrator must approve your "
            "account before you can sign in."
        ),
        email=user.email,
        status=UserStatus.invited,
    )


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Only fully approved accounts receive a token — no exceptions.
    if user.status != UserStatus.active:
        if user.status == UserStatus.invited:
            raise HTTPException(
                status_code=403,
                detail=(
                    "Your account is awaiting administrator approval. "
                    "You cannot sign in until access is granted."
                ),
            )
        if user.status == UserStatus.suspended:
            raise HTTPException(
                status_code=403,
                detail="Account access has been revoked. Contact your administrator.",
            )
        raise HTTPException(
            status_code=403,
            detail=f"User account is {user.status.value}",
        )

    token = create_access_token(user.id, {"role": user.role.value, "org_id": user.org_id})
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(current: User = Depends(get_current_active_user)):
    return current


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(current: User = Depends(get_current_active_user)):
    """Issue a fresh access token while the current one is still valid."""
    token = create_access_token(
        current.id, {"role": current.role.value, "org_id": current.org_id}
    )
    return TokenResponse(access_token=token, user=UserOut.model_validate(current))


@router.patch("/me", response_model=UserOut)
def update_profile(
    payload: ProfileUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_active_user),
):
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(current, field, value)
    db.commit()
    db.refresh(current)
    return current
