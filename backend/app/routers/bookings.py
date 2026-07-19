from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_active_user
from ..models import Booking, BookingStatus, Ride, RideStatus, User
from ..schemas import (
    BookingCreate,
    BookingDetailOut,
    BookingOut,
    CancelRequest,
    RideOut,
)
from ..services.notifications import notifications
from ..services.org_scope import load_ride_same_org
from ..services.refunds import refund_booking_if_paid

router = APIRouter(prefix="/bookings", tags=["bookings"])


@router.post("", response_model=BookingOut, status_code=201)
def create_booking(
    payload: BookingCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    """Passenger books a seat immediately (confirmed on create)."""
    ride = load_ride_same_org(db, payload.ride_id, user)
    driver = db.get(User, ride.driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Ride not found")
    if ride.status != RideStatus.scheduled:
        raise HTTPException(status_code=400, detail="Ride is not open for booking")
    if ride.driver_id == user.id:
        raise HTTPException(status_code=400, detail="Driver cannot book their own ride")

    existing = db.scalar(
        select(Booking).where(
            Booking.ride_id == ride.id,
            Booking.passenger_id == user.id,
            Booking.status != BookingStatus.cancelled,
            Booking.status != BookingStatus.rejected,
        )
    )
    if existing:
        raise HTTPException(
            status_code=400, detail="You already have a booking on this ride"
        )

    fare = Decimal(str(ride.fare_per_seat)) * payload.seats

    result = db.execute(
        update(Ride)
        .where(Ride.id == ride.id, Ride.available_seats >= payload.seats)
        .values(available_seats=Ride.available_seats - payload.seats)
    )
    if result.rowcount == 0:
        db.rollback()
        raise HTTPException(status_code=400, detail="Not enough seats available")

    booking = Booking(
        ride_id=ride.id,
        passenger_id=user.id,
        seats=payload.seats,
        pickup_lat=payload.pickup_lat,
        pickup_lng=payload.pickup_lng,
        drop_lat=payload.drop_lat,
        drop_lng=payload.drop_lng,
        fare_amount=fare,
        status=BookingStatus.booked,
    )
    db.add(booking)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400, detail="You already have a booking on this ride"
        )
    db.refresh(booking)

    notifications.notify_booking_created(
        db,
        driver=driver,
        passenger=user,
        ride=ride,
        seats=payload.seats,
        background_tasks=background_tasks,
    )
    db.commit()
    return booking


@router.get("/mine", response_model=list[BookingDetailOut])
def my_bookings(db: Session = Depends(get_db), user: User = Depends(get_current_active_user)):
    bookings = db.scalars(
        select(Booking)
        .where(Booking.passenger_id == user.id)
        .order_by(Booking.booked_at.desc())
    ).all()
    results = []
    for booking in bookings:
        ride = db.get(Ride, booking.ride_id)
        results.append(
            BookingDetailOut(
                **BookingOut.model_validate(booking).model_dump(),
                ride=RideOut.model_validate(ride) if ride else None,
            )
        )
    return results


@router.post("/{booking_id}/cancel", response_model=BookingOut)
def cancel_booking(
    booking_id: str,
    background_tasks: BackgroundTasks,
    payload: CancelRequest = CancelRequest(),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    booking = db.get(Booking, booking_id)
    if not booking or booking.passenger_id != user.id:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status != BookingStatus.booked:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel a {booking.status.value} booking",
        )

    booking.status = BookingStatus.cancelled
    booking.cancelled_at = datetime.now(timezone.utc)
    booking.cancel_reason = payload.reason

    ride = db.get(Ride, booking.ride_id)
    if ride:
        ride.available_seats = min(ride.total_seats, ride.available_seats + booking.seats)
        driver = db.get(User, ride.driver_id)
        if driver:
            notifications.notify_booking_cancelled(
                db,
                driver=driver,
                passenger=user,
                ride=ride,
                background_tasks=background_tasks,
            )

    refund_booking_if_paid(
        db,
        booking,
        reason="passenger_cancel",
        actor_id=user.id,
        ride=ride,
    )

    db.commit()
    db.refresh(booking)
    return booking
