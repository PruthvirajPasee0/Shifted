"""Notification service — the single API for creating notifications.

Routers must NOT hand-write notification titles/bodies/emails inline. Instead
they call one typed, event-named method per domain event on the `notifications`
singleton, e.g.:

    from ..services.notifications import notifications

    notifications.notify_booking_created(
        db, driver=driver, passenger=user, ride=ride, seats=payload.seats,
        background_tasks=background_tasks,
    )

Each method is the single source of truth for that event's copy: it builds the
in-app Notification row (type + title + body) and the matching branded email
(from ``app.email_templates``) in one place.

Transaction semantics: a method ``db.add(...)``s the notification row but does
**not** commit. The calling router commits it inside its own transaction, so a
notification is persisted atomically with the event that triggered it (and is
rolled back with it if the event fails). Emails are queued as best-effort
FastAPI background tasks and run after the response is sent — they never block
or roll back the request.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from ..models import Notification, User, Ride, Booking, PayMethod
from .. import email_templates as tpl
from .email import send_email
from .sms import send_sms


class NotificationType(str, Enum):
    """Stable identifiers persisted in ``notifications.type``.

    Kept as a closed set so the frontend and analytics can rely on the values
    instead of matching free-form strings.
    """

    booking_created = "booking_created"
    booking_cancelled = "booking_cancelled"
    refund_issued = "refund_issued"
    ride_reminder = "ride_reminder"
    ride_started = "ride_started"
    ride_completed = "ride_completed"
    ride_cancelled = "ride_cancelled"
    payment_received = "payment_received"
    document_pending = "document_pending"
    document_verified = "document_verified"
    document_rejected = "document_rejected"
    welcome = "welcome"
    access_granted = "access_granted"
    user_pending_approval = "user_pending_approval"


def fmt_route(ride: Ride) -> str:
    """Human-readable ``origin → destination`` label for a ride."""
    return f"{ride.origin} → {ride.destination}"


def fmt_when(dt: datetime | None) -> str:
    """Format a datetime for notification copy, or ``—`` when absent."""
    if not dt:
        return "—"
    return dt.strftime("%d %b %Y, %H:%M")


def push(
    db: Session,
    user: User,
    ntype: str,
    title: str,
    body: str,
    *,
    ref_id: str | None = None,
    background_tasks: BackgroundTasks | None = None,
    email: dict | None = None,
) -> Notification:
    """Create an in-app notification for `user` and optionally queue an email.

    `email`, when provided, is a dict of {"subject", "html", "text"} produced by
    app.email_templates. `ref_id` is an optional entity id for deep links.
    """
    note = Notification(
        user_id=user.id, type=ntype, title=title, body=body, ref_id=ref_id
    )
    db.add(note)
    if background_tasks is not None and email is not None and user.email:
        background_tasks.add_task(
            send_email,
            user.email,
            email["subject"],
            email["html"],
            email.get("text"),
        )
    return note


class NotificationService:
    """Typed, event-named API for persisting notifications (+ optional email).

    One public ``notify_*`` method per domain event. Add new events by adding a
    method here and a value to :class:`NotificationType` — never by writing an
    ad-hoc notification string in a router.
    """

    # ------------------------------------------------------------------ #
    # Low-level primitive — not called directly by routers.              #
    # ------------------------------------------------------------------ #
    def _create(
        self,
        db: Session,
        user: User,
        ntype: NotificationType,
        title: str,
        body: str,
        *,
        ref_id: str | None = None,
        background_tasks: BackgroundTasks | None = None,
        email: dict | None = None,
    ) -> Notification:
        note = Notification(
            user_id=user.id, type=ntype.value, title=title, body=body, ref_id=ref_id
        )
        db.add(note)

        if background_tasks is not None and email is not None and user.email:
            background_tasks.add_task(
                send_email,
                user.email,
                email["subject"],
                email["html"],
                email.get("text"),
            )
        # Best-effort SMS for high-urgency trip events when configured.
        if (
            background_tasks is not None
            and ntype
            in (NotificationType.ride_started, NotificationType.ride_reminder)
            and user.phone
        ):
            background_tasks.add_task(send_sms, user.phone, f"{title}: {body}")
        return note

    # ------------------------------------------------------------------ #
    # Bookings                                                            #
    # ------------------------------------------------------------------ #
    def notify_booking_created(
        self,
        db: Session,
        *,
        driver: User,
        passenger: User,
        ride: Ride,
        seats: int,
        background_tasks: BackgroundTasks | None = None,
    ) -> Notification:
        """A passenger booked seat(s) on the driver's ride."""
        route = fmt_route(ride)
        return self._create(
            db,
            driver,
            NotificationType.booking_created,
            "New booking",
            f"{passenger.name} booked {seats} seat(s) on your ride {route}.",
            ref_id=ride.id,
            background_tasks=background_tasks,
            email=tpl.booking_created(
                driver_name=driver.name,
                passenger_name=passenger.name,
                seats=seats,
                route=route,
                when=fmt_when(ride.departure_time),
                ride_id=ride.id,
            ),
        )

    def notify_booking_cancelled(
        self,
        db: Session,
        *,
        driver: User,
        passenger: User,
        ride: Ride,
        background_tasks: BackgroundTasks | None = None,
    ) -> Notification:
        """A passenger cancelled their booking; seats were freed."""
        route = fmt_route(ride)
        return self._create(
            db,
            driver,
            NotificationType.booking_cancelled,
            "Booking cancelled",
            f"{passenger.name} cancelled their booking on your ride {route}.",
            ref_id=ride.id,
            background_tasks=background_tasks,
            email=tpl.booking_cancelled(
                driver_name=driver.name,
                passenger_name=passenger.name,
                route=route,
                ride_id=ride.id,
            ),
        )

    # ------------------------------------------------------------------ #
    # Ride lifecycle                                                      #
    # ------------------------------------------------------------------ #
    def notify_ride_started(
        self,
        db: Session,
        *,
        passenger: User,
        ride: Ride,
        background_tasks: BackgroundTasks | None = None,
    ) -> Notification:
        """Driver started the ride; passenger can track it live."""
        route = fmt_route(ride)
        return self._create(
            db,
            passenger,
            NotificationType.ride_started,
            "Your ride has started",
            f"Your ride {route} is now on the way.",
            background_tasks=background_tasks,
            email=tpl.ride_started(
                passenger_name=passenger.name, route=route, ride_id=ride.id
            ),
        )

    def notify_ride_completed(
        self,
        db: Session,
        *,
        passenger: User,
        ride: Ride,
        booking: Booking | None = None,
        background_tasks: BackgroundTasks | None = None,
    ) -> Notification:
        """Ride finished; fare is now due from the passenger."""
        route = fmt_route(ride)
        amount = f"₹{Decimal(str(booking.fare_amount)):.2f}" if booking else "—"
        return self._create(
            db,
            passenger,
            NotificationType.ride_completed,
            "Ride complete — payment due",
            f"Your ride {route} is complete. Amount due: {amount}.",
            background_tasks=background_tasks,
            email=tpl.ride_completed(
                passenger_name=passenger.name,
                route=route,
                amount=amount,
                ride_id=ride.id,
            ),
        )

    def notify_ride_cancelled(
        self,
        db: Session,
        *,
        passenger: User,
        ride: Ride,
        reason: str | None = None,
        background_tasks: BackgroundTasks | None = None,
    ) -> Notification:
        """Driver cancelled the whole ride."""
        route = fmt_route(ride)
        return self._create(
            db,
            passenger,
            NotificationType.ride_cancelled,
            "Ride cancelled",
            f"The driver cancelled your ride {route}.",
            background_tasks=background_tasks,
            email=tpl.ride_cancelled(
                passenger_name=passenger.name, route=route, reason=reason
            ),
        )

    def notify_ride_reminder(
        self,
        db: Session,
        *,
        user: User,
        ride: Ride,
        role: str,
        background_tasks: BackgroundTasks | None = None,
    ) -> Notification:
        """~15 min departure reminder for passenger or driver."""
        route = fmt_route(ride)
        when = fmt_when(ride.departure_time)
        role_bit = "You're driving" if role == "driver" else "Your pickup"
        return self._create(
            db,
            user,
            NotificationType.ride_reminder,
            "Ride departing soon",
            f"{role_bit} for {route} at {when}.",
            ref_id=ride.id,
            background_tasks=background_tasks,
        )

    # ------------------------------------------------------------------ #
    # Payments                                                            #
    # ------------------------------------------------------------------ #
    def notify_payment_received(
        self,
        db: Session,
        *,
        driver: User,
        payer: User,
        ride: Ride,
        amount,
        method: PayMethod,
        background_tasks: BackgroundTasks | None = None,
    ) -> Notification:
        """Driver received a fare payment (wallet moves in-app; others offline)."""
        route = fmt_route(ride)
        amount_str = f"₹{Decimal(str(amount)):.2f}"
        method_note = (
            " (wallet)"
            if method == PayMethod.wallet
            else f" ({method.value} — settle offline)"
        )
        return self._create(
            db,
            driver,
            NotificationType.payment_received,
            "Payment received",
            f"{payer.name} paid you {amount_str} for {route}{method_note}.",
            background_tasks=background_tasks,
            email=tpl.payment_received(
                driver_name=driver.name,
                payer_name=payer.name,
                amount=amount_str,
                route=route,
            ),
        )

    # ------------------------------------------------------------------ #
    # Documents                                                           #
    # ------------------------------------------------------------------ #
    def notify_document_pending(
        self,
        db: Session,
        *,
        admin: User,
        submitter: User,
        doc_label: str,
        background_tasks: BackgroundTasks | None = None,
    ) -> Notification:
        """An employee submitted a document; alert an org admin to review it."""
        return self._create(
            db,
            admin,
            NotificationType.document_pending,
            "Document awaiting verification",
            f"{submitter.name} submitted a {doc_label} for review.",
            background_tasks=background_tasks,
        )

    def notify_document_verified(
        self,
        db: Session,
        *,
        owner: User,
        doc_label: str,
        background_tasks: BackgroundTasks | None = None,
    ) -> Notification:
        """Admin approved the owner's document."""
        return self._create(
            db,
            owner,
            NotificationType.document_verified,
            f"{doc_label} verified",
            f"Your {doc_label} has been verified.",
            background_tasks=background_tasks,
            email=tpl.document_verified(name=owner.name, doc_label=doc_label),
        )

    def notify_document_rejected(
        self,
        db: Session,
        *,
        owner: User,
        doc_label: str,
        reason: str | None = None,
        background_tasks: BackgroundTasks | None = None,
    ) -> Notification:
        """Admin rejected the owner's document (with an optional reason)."""
        return self._create(
            db,
            owner,
            NotificationType.document_rejected,
            f"{doc_label} rejected",
            f"Your {doc_label} was rejected. {reason or ''}".strip(),
            background_tasks=background_tasks,
            email=tpl.document_rejected(
                name=owner.name, doc_label=doc_label, reason=reason
            ),
        )

    # ------------------------------------------------------------------ #
    # Accounts / access                                                   #
    # ------------------------------------------------------------------ #
    def notify_welcome_employee(
        self,
        db: Session,
        *,
        user: User,
        temp_password: str,
        org_name: str,
        background_tasks: BackgroundTasks | None = None,
    ) -> Notification:
        """Admin provisioned an employee account with temporary credentials."""
        return self._create(
            db,
            user,
            NotificationType.welcome,
            "Welcome to Carpool",
            "Your account has been created. Sign in with your temporary password.",
            background_tasks=background_tasks,
            email=tpl.welcome_employee(
                name=user.name,
                email=user.email,
                temp_password=temp_password,
                org_name=org_name,
            ),
        )

    def notify_access_granted(
        self,
        db: Session,
        *,
        user: User,
        background_tasks: BackgroundTasks | None = None,
    ) -> Notification:
        """Admin approved a self-registered employee's platform access."""
        return self._create(
            db,
            user,
            NotificationType.access_granted,
            "Access approved",
            "Your company administrator approved your account. You can sign in now.",
            background_tasks=background_tasks,
        )

    def notify_user_pending_approval(
        self,
        db: Session,
        *,
        admin: User,
        applicant: User,
        background_tasks: BackgroundTasks | None = None,
    ) -> Notification:
        """A new self-signup needs an org admin to grant access."""
        return self._create(
            db,
            admin,
            NotificationType.user_pending_approval,
            "New employee awaiting approval",
            f"{applicant.name} ({applicant.email}) registered and needs access approval.",
            background_tasks=background_tasks,
        )


# Module-level singleton — import this in routers.
notifications = NotificationService()
