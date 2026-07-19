from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_active_user, require_admin
from ..models import SupportTicket, TicketStatus, User
from ..schemas import SupportTicketCreate, SupportTicketOut, SupportTicketUpdate

router = APIRouter(prefix="/support", tags=["support"])


@router.get("/tickets", response_model=list[SupportTicketOut])
def my_tickets(db: Session = Depends(get_db), user: User = Depends(get_current_active_user)):
    rows = db.scalars(
        select(SupportTicket)
        .where(SupportTicket.user_id == user.id)
        .order_by(SupportTicket.created_at.desc())
    ).all()
    return [SupportTicketOut.model_validate(row) for row in rows]


@router.post("/tickets", response_model=SupportTicketOut, status_code=201)
def create_ticket(
    payload: SupportTicketCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    ticket = SupportTicket(
        user_id=user.id,
        subject=payload.subject.strip(),
        body=payload.body.strip() if payload.body else None,
        status=TicketStatus.open,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return SupportTicketOut.model_validate(ticket)


@router.patch("/tickets/{ticket_id}", response_model=SupportTicketOut)
def update_own_ticket(
    ticket_id: str,
    payload: SupportTicketUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    ticket = db.get(SupportTicket, ticket_id)
    if not ticket or ticket.user_id != user.id:
        raise HTTPException(status_code=404, detail="Ticket not found")

    # Employee can only close their ticket.
    if payload.status != TicketStatus.closed:
        raise HTTPException(status_code=400, detail="You can only close your own ticket")
    ticket.status = TicketStatus.closed
    db.commit()
    db.refresh(ticket)
    return SupportTicketOut.model_validate(ticket)


@router.get("/admin/tickets", response_model=list[SupportTicketOut])
def admin_tickets(
    status: TicketStatus | None = Query(default=None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    stmt = (
        select(SupportTicket, User.name, User.email)
        .join(User, SupportTicket.user_id == User.id)
        .where(User.org_id == admin.org_id)
    )
    if status is not None:
        stmt = stmt.where(SupportTicket.status == status)
    rows = db.execute(stmt.order_by(SupportTicket.created_at.desc())).all()

    out: list[SupportTicketOut] = []
    for ticket, user_name, user_email in rows:
        data = SupportTicketOut.model_validate(ticket).model_dump()
        data["user_name"] = user_name
        data["user_email"] = user_email
        out.append(SupportTicketOut(**data))
    return out


@router.patch("/admin/tickets/{ticket_id}", response_model=SupportTicketOut)
def admin_update_ticket(
    ticket_id: str,
    payload: SupportTicketUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    row = db.execute(
        select(SupportTicket, User.org_id)
        .join(User, SupportTicket.user_id == User.id)
        .where(SupportTicket.id == ticket_id)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Ticket not found")
    ticket, org_id = row
    if org_id != admin.org_id:
        raise HTTPException(status_code=404, detail="Ticket not found")

    ticket.status = payload.status
    db.commit()
    db.refresh(ticket)
    data = SupportTicketOut.model_validate(ticket).model_dump()
    owner = db.get(User, ticket.user_id)
    if owner:
        data["user_name"] = owner.name
        data["user_email"] = owner.email
    return SupportTicketOut(**data)
