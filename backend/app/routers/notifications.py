from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select, update, func
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_active_user
from ..models import (
    Booking,
    BookingStatus,
    Notification,
    Ride,
    RideStatus,
    User,
)
from ..schemas import NotificationOut, UnreadCount
from ..services.notifications import notifications

router = APIRouter(prefix="/notifications", tags=["notifications"])

REMINDER_WINDOW_MIN = 20
REMINDER_COOLDOWN = timedelta(hours=3)


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    stmt = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))
    stmt = stmt.order_by(Notification.created_at.desc()).limit(limit)
    return db.scalars(stmt).all()


@router.get("/unread-count", response_model=UnreadCount)
def unread_count(db: Session = Depends(get_db), user: User = Depends(get_current_active_user)):
    count = db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user.id, Notification.is_read.is_(False))
    )
    return UnreadCount(count=count or 0)


@router.patch("/{note_id}/read", response_model=NotificationOut)
def mark_read(
    note_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    note = db.get(Notification, note_id)
    if not note or note.user_id != user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    note.is_read = True
    db.commit()
    db.refresh(note)
    return note


@router.post("/read-all", response_model=UnreadCount)
def mark_all_read(db: Session = Depends(get_db), user: User = Depends(get_current_active_user)):
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.is_read.is_(False))
        .values(is_read=True)
    )
    db.commit()
    return UnreadCount(count=0)


@router.post("/check-reminders")
def check_reminders(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    """Send ~15–20 min departure reminders (in-app + optional SMS) once per ride."""
    now = datetime.now(timezone.utc)
    until = now + timedelta(minutes=REMINDER_WINDOW_MIN)
    since = now - REMINDER_COOLDOWN
    sent = 0

    def _already_reminded(ride_id: str) -> bool:
        return (
            db.scalar(
                select(Notification.id).where(
                    Notification.user_id == user.id,
                    Notification.type == "ride_reminder",
                    Notification.ref_id == ride_id,
                    Notification.created_at >= since,
                )
            )
            is not None
        )

    # As passenger
    passenger_rides = db.scalars(
        select(Ride)
        .join(Booking, Booking.ride_id == Ride.id)
        .where(
            Booking.passenger_id == user.id,
            Booking.status == BookingStatus.booked,
            Ride.status.in_([RideStatus.scheduled, RideStatus.started]),
            Ride.departure_time >= now,
            Ride.departure_time <= until,
        )
    ).all()
    for ride in passenger_rides:
        if _already_reminded(ride.id):
            continue
        notifications.notify_ride_reminder(
            db,
            user=user,
            ride=ride,
            role="passenger",
            background_tasks=background_tasks,
        )
        sent += 1

    # As driver
    driver_rides = db.scalars(
        select(Ride).where(
            Ride.driver_id == user.id,
            Ride.status.in_([RideStatus.scheduled, RideStatus.started]),
            Ride.departure_time >= now,
            Ride.departure_time <= until,
        )
    ).all()
    for ride in driver_rides:
        if _already_reminded(ride.id):
            continue
        notifications.notify_ride_reminder(
            db,
            user=user,
            ride=ride,
            role="driver",
            background_tasks=background_tasks,
        )
        sent += 1

    if sent:
        db.commit()
    return {"sent": sent}
