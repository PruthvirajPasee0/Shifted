from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Booking,
    BookingStatus,
    Organization,
    Ride,
    RideRecurrenceException,
    RideStatus,
    SupportTicket,
    TicketStatus,
    User,
    UserRole,
    UserStatus,
)
from app.routers.payment_methods import (
    create_payment_method,
    delete_payment_method,
    list_payment_methods,
    update_payment_method,
)
from app.routers.rides import add_series_exception, remove_series_exception
from app.routers.support import (
    admin_tickets,
    admin_update_ticket,
    create_ticket,
    my_tickets,
    update_own_ticket,
)
from app.schemas import (
    PaymentMethodCreate,
    PaymentMethodUpdate,
    RideSeriesExceptionCreate,
    SupportTicketCreate,
    SupportTicketUpdate,
)


def test_payment_methods_crud_default_switch(db_session: Session, payment_fixture: dict[str, object]):
    user = payment_fixture["passenger"]

    card = create_payment_method(
        PaymentMethodCreate(type="card", detail="4111 1111 1111 9876", label="Corp card"),
        db_session,
        user,
    )
    assert card.is_default is True
    assert card.masked_detail == "**** **** **** 9876"

    upi = create_payment_method(
        PaymentMethodCreate(type="upi", detail="john.doe@okicici", label="Primary UPI"),
        db_session,
        user,
    )
    assert upi.is_default is False
    assert upi.masked_detail == "jo***@okicici"

    switched = update_payment_method(
        upi.id,
        PaymentMethodUpdate(is_default=True),
        db_session,
        user,
    )
    assert switched.is_default is True

    rows = list_payment_methods(db_session, user)
    assert len(rows) == 2
    defaults = [m for m in rows if m.is_default]
    assert len(defaults) == 1
    assert defaults[0].id == upi.id

    delete_payment_method(upi.id, db_session, user)
    rows_after = list_payment_methods(db_session, user)
    assert len(rows_after) == 1
    assert rows_after[0].is_default is True


def test_support_ticket_employee_and_admin_flow(db_session: Session, payment_fixture: dict[str, object]):
    employee = payment_fixture["passenger"]
    org = payment_fixture["org"]
    admin = User(
        id="admin-support",
        org_id=org.id,
        name="Org Admin",
        email="admin@acme.com",
        password_hash="x",
        role=UserRole.admin,
        status=UserStatus.active,
    )
    outsider_org = Organization(id="org-other", name="Other", domain="other.com")
    outsider = User(
        id="employee-other",
        org_id=outsider_org.id,
        name="Other User",
        email="other@other.com",
        password_hash="x",
        role=UserRole.employee,
        status=UserStatus.active,
    )
    db_session.add_all([admin, outsider_org, outsider])
    db_session.commit()

    mine = create_ticket(
        SupportTicketCreate(subject="Wallet recharge stuck", body="Payment pending for 20 minutes"),
        db_session,
        employee,
    )
    assert mine.status == TicketStatus.open

    mine_list = my_tickets(db_session, employee)
    assert len(mine_list) == 1
    assert mine_list[0].subject == "Wallet recharge stuck"

    # Employee can only close their own ticket.
    with pytest.raises(HTTPException):
        update_own_ticket(mine.id, SupportTicketUpdate(status=TicketStatus.in_progress), db_session, employee)

    closed = update_own_ticket(mine.id, SupportTicketUpdate(status=TicketStatus.closed), db_session, employee)
    assert closed.status == TicketStatus.closed

    # Add another open ticket from same org and one from a different org.
    same_org_ticket = SupportTicket(
        id="ticket-org",
        user_id=employee.id,
        subject="Trip mismatch",
        body="Recurring ride date mismatch",
        status=TicketStatus.open,
    )
    other_org_ticket = SupportTicket(
        id="ticket-other",
        user_id=outsider.id,
        subject="Other issue",
        body="Should not be visible",
        status=TicketStatus.open,
    )
    db_session.add_all([same_org_ticket, other_org_ticket])
    db_session.commit()

    admin_rows = admin_tickets(None, db_session, admin)
    assert any(t.id == same_org_ticket.id for t in admin_rows)
    assert all(t.user_email != outsider.email for t in admin_rows)

    progressed = admin_update_ticket(
        same_org_ticket.id,
        SupportTicketUpdate(status=TicketStatus.in_progress),
        db_session,
        admin,
    )
    assert progressed.status == TicketStatus.in_progress


def test_recurring_exception_skip_and_unskip(
    db_session: Session, recurring_fixture: dict[str, object]
):
    driver = recurring_fixture["driver"]
    template = recurring_fixture["template"]
    child_drop = recurring_fixture["child_drop"]
    passenger = recurring_fixture["passenger"]
    skip_date = child_drop.departure_time.date()

    # Conflict if active booking exists on target date.
    child_drop.available_seats = 3
    db_session.add(
        Booking(
            id="booking-skip-block",
            ride_id=child_drop.id,
            passenger_id=passenger.id,
            seats=1,
            fare_amount=Decimal("120"),
            status=BookingStatus.booked,
        )
    )
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        add_series_exception(
            template.id,
            RideSeriesExceptionCreate(exception_date=skip_date, reason="Holiday"),
            db_session,
            driver,
        )
    assert exc.value.status_code == 409

    # Cancel booking then skip should work.
    booking = db_session.get(Booking, "booking-skip-block")
    booking.status = BookingStatus.cancelled
    db_session.commit()

    created = add_series_exception(
        template.id,
        RideSeriesExceptionCreate(exception_date=skip_date, reason="Holiday"),
        db_session,
        driver,
    )
    assert created.exception_date == skip_date

    db_session.refresh(child_drop)
    assert child_drop.status == RideStatus.cancelled
    assert (child_drop.cancel_reason or "").startswith("Series exception skip")
    stored = db_session.scalar(
        select(RideRecurrenceException).where(
            RideRecurrenceException.template_ride_id == template.id,
            RideRecurrenceException.exception_date == skip_date,
        )
    )
    assert stored is not None

    out = remove_series_exception(template.id, skip_date, db_session, driver)
    assert out["ok"] is True
    db_session.refresh(child_drop)
    # Row is restored to scheduled after removing skip exception.
    assert child_drop.status == RideStatus.scheduled
    assert child_drop.cancel_reason is None


def test_skip_rejects_past_date(db_session: Session, recurring_fixture: dict[str, object]):
    driver = recurring_fixture["driver"]
    template = recurring_fixture["template"]
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).date()
    with pytest.raises(HTTPException):
        add_series_exception(
            template.id,
            RideSeriesExceptionCreate(exception_date=yesterday, reason="Past"),
            db_session,
            driver,
        )
