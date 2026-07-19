from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_active_user
from ..models import Booking, BookingStatus, Rating, Ride, RideStatus, User
from ..schemas import RatingCreate, RatingOut, RatingSummary
from ..services import notifications as notify

router = APIRouter(prefix="/ratings", tags=["ratings"])


def _same_org_ride(ride_id: str, db: Session, user: User) -> Ride:
    ride = db.get(Ride, ride_id)
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    driver = db.get(User, ride.driver_id)
    if not driver or driver.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="Ride not found")
    return ride


def _is_participant(ride: Ride, user_id: str, db: Session) -> bool:
    if ride.driver_id == user_id:
        return True
    booking = db.scalar(
        select(Booking).where(
            Booking.ride_id == ride.id,
            Booking.passenger_id == user_id,
            Booking.status != BookingStatus.cancelled,
        )
    )
    return booking is not None


@router.post("", response_model=RatingOut, status_code=201)
def create_rating(
    payload: RatingCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    ride = _same_org_ride(payload.ride_id, db, user)
    if ride.status != RideStatus.completed:
        raise HTTPException(status_code=400, detail="Ratings are available after ride completion")
    if payload.ratee_id == user.id:
        raise HTTPException(status_code=400, detail="You cannot rate yourself")
    # Only passengers rate the driver — drivers cannot rate passengers.
    if ride.driver_id == user.id:
        raise HTTPException(status_code=403, detail="Drivers cannot rate passengers")
    passenger_booking = db.scalar(
        select(Booking).where(
            Booking.ride_id == ride.id,
            Booking.passenger_id == user.id,
            Booking.status != BookingStatus.cancelled,
        )
    )
    if passenger_booking is None:
        raise HTTPException(status_code=403, detail="Only passengers on this ride can rate the driver")
    if payload.ratee_id != ride.driver_id:
        raise HTTPException(status_code=400, detail="Passengers can only rate the driver of this ride")
    ratee = db.get(User, payload.ratee_id)
    if not ratee or ratee.org_id != user.org_id:
        raise HTTPException(status_code=400, detail="Driver not found for this ride")

    existing = db.scalar(
        select(Rating).where(
            Rating.ride_id == ride.id,
            Rating.rater_id == user.id,
            Rating.ratee_id == payload.ratee_id,
        )
    )
    if existing:
        raise HTTPException(status_code=400, detail="You already rated the driver for this ride")

    rating = Rating(
        ride_id=ride.id,
        rater_id=user.id,
        ratee_id=payload.ratee_id,
        stars=payload.stars,
        comment=payload.comment.strip() if payload.comment else None,
    )
    db.add(rating)
    notify.push(
        db,
        ratee,
        "rating_received",
        "New ride rating",
        f"{user.name} rated you {payload.stars}★ for ride {notify.fmt_route(ride)}.",
        ref_id=ride.id,
    )
    db.commit()
    db.refresh(rating)
    return rating


@router.get("/ride/{ride_id}", response_model=list[RatingOut])
def ratings_for_ride(
    ride_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    ride = _same_org_ride(ride_id, db, user)
    if not _is_participant(ride, user.id, db):
        raise HTTPException(status_code=403, detail="Only ride participants can view ride ratings")
    return db.scalars(select(Rating).where(Rating.ride_id == ride.id)).all()


@router.get("/ride/{ride_id}/mine", response_model=list[RatingOut])
def my_ratings_for_ride(
    ride_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    ride = _same_org_ride(ride_id, db, user)
    if not _is_participant(ride, user.id, db):
        raise HTTPException(status_code=403, detail="Only ride participants can view ride ratings")
    return db.scalars(
        select(Rating).where(Rating.ride_id == ride.id, Rating.rater_id == user.id)
    ).all()


@router.get("/users/{user_id}", response_model=list[RatingOut])
def ratings_for_user(
    user_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    target = db.get(User, user_id)
    if not target or target.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="User not found")
    return db.scalars(
        select(Rating).where(Rating.ratee_id == user_id).limit(limit)
    ).all()


@router.get("/users/{user_id}/summary", response_model=RatingSummary)
def rating_summary(
    user_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    target = db.get(User, user_id)
    if not target or target.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="User not found")
    avg_stars, total = db.execute(
        select(func.avg(Rating.stars), func.count(Rating.id)).where(Rating.ratee_id == user_id)
    ).one()
    return RatingSummary(
        user_id=user_id,
        average_stars=round(float(avg_stars or 0.0), 2),
        total_ratings=int(total or 0),
    )
