from datetime import datetime, timezone, date as date_cls, timedelta
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select, and_, or_, update, func
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..deps import get_current_active_user
from ..models import (
    ACTIVE_BOOKING_STATUSES,
    CONFIRMED_BOOKING_STATUSES,
    User,
    Ride,
    Vehicle,
    Document,
    Booking,
    BookingStatus,
    TripLocation,
    Message,
    RideStatus,
    DocType,
    DocStatus,
    Payment,
    PaymentType,
    PayMethod,
    PayStatus,
    RideRecurrenceException,
)
from ..services.org_scope import load_ride_same_org
from ..services.refunds import refund_booking_if_paid
from ..schemas import (
    RideCreate,
    RideOut,
    RideMatchOut,
    RideDetailOut,
    UserOut,
    VehicleOut,
    BookingOut,
    RideBookingOut,
    CancelRequest,
    RideSeriesUpdate,
    RideSeriesExceptionCreate,
    RideSeriesExceptionOut,
    LocationCreate,
    LocationOut,
    MessageCreate,
    MessageOut,
    ChatUnreadOut,
    UnreadCount,
)
from ..utils import haversine, bbox_deg, match_score, along_corridor
from ..recurrence import RecurrenceError, WEEKDAY_CODES, generate_occurrences
from .. import email_templates as tpl
from ..services import notifications as notify

router = APIRouter(prefix="/rides", tags=["rides"])


@router.get("/chat/unread-count", response_model=ChatUnreadOut)
def global_chat_unread(
    db: Session = Depends(get_db), user: User = Depends(get_current_active_user)
):
    """Must be registered before /{ride_id} so 'chat' is not parsed as an id."""
    count = db.scalar(
        select(func.count())
        .select_from(Message)
        .where(Message.receiver_id == user.id, Message.is_read.is_(False))
    )
    return ChatUnreadOut(count=int(count or 0))


def _active_passengers(db: Session, ride: Ride) -> list[User]:
    """Distinct users with an active (pending/booked) booking on this ride."""
    rows = db.scalars(
        select(Booking).where(
            Booking.ride_id == ride.id,
            Booking.status.in_(ACTIVE_BOOKING_STATUSES),
        )
    ).all()
    seen: dict[str, User] = {}
    for b in rows:
        if b.passenger_id not in seen:
            u = db.get(User, b.passenger_id)
            if u:
                seen[b.passenger_id] = u
    return list(seen.values())


def _confirmed_passengers(db: Session, ride: Ride) -> list[User]:
    rows = db.scalars(
        select(Booking).where(
            Booking.ride_id == ride.id,
            Booking.status.in_(CONFIRMED_BOOKING_STATUSES),
        )
    ).all()
    seen: dict[str, User] = {}
    for b in rows:
        if b.passenger_id not in seen:
            u = db.get(User, b.passenger_id)
            if u:
                seen[b.passenger_id] = u
    return list(seen.values())

SEARCH_RADIUS_KM = 10.0
CORRIDOR_KM = 3.0
RECURRING_DAYS_AHEAD = 28
SERIES_EXCEPTION_KIND_SKIP = "skip"
SERIES_EXCEPTION_REASON_PREFIX = "Series exception skip"
_WEEKDAY_MAP = {
    "MON": 0,
    "TUE": 1,
    "WED": 2,
    "THU": 3,
    "FRI": 4,
    "SAT": 5,
    "SUN": 6,
}
_WEEKDAY_MAP.update(WEEKDAY_CODES)


def _load_ride_same_org(ride_id: str, db: Session, user: User) -> Ride:
    """Load a ride, but only if the caller shares an org with its driver."""
    return load_ride_same_org(db, ride_id, user)


def _as_utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _dt_key(dt: datetime) -> str:
    return _as_utc(dt).replace(microsecond=0).isoformat()


def _is_ride_participant(ride: Ride, user: User, db: Session) -> bool:
    if ride.driver_id == user.id:
        return True
    booking = db.scalar(
        select(Booking).where(
            Booking.ride_id == ride.id,
            Booking.passenger_id == user.id,
            Booking.status.in_(CONFIRMED_BOOKING_STATUSES),
        )
    )
    return booking is not None


def _has_valid_doc(db: Session, user_id: str, doc_type: DocType) -> bool:
    doc = db.scalar(
        select(Document).where(
            and_(
                Document.user_id == user_id,
                Document.doc_type == doc_type,
                Document.status == DocStatus.verified,
            )
        )
    )
    if not doc:
        return False
    if doc.expiry_date and doc.expiry_date < date_cls.today():
        return False
    return True


def _has_valid_license(db: Session, user_id: str) -> bool:
    return _has_valid_doc(db, user_id, DocType.driving_license)


def _series_template(ride: Ride, db: Session, user: User) -> Ride | None:
    """Resolve recurring series template for a ride (template or child)."""
    if ride.parent_ride_id:
        parent = db.get(Ride, ride.parent_ride_id)
        if not parent or parent.driver_id != user.id:
            return None
        return parent
    if ride.is_recurring and ride.driver_id == user.id:
        return ride
    return None


def _parse_recurrence_weekdays(rule: str | None, departure: datetime) -> set[int]:
    """Parse `WEEKLY:MON,TUE` or `MON,TUE` or numeric `0,1` weekday rules."""
    if not rule:
        return {departure.weekday()}
    raw = rule.strip().upper()
    if ":" in raw:
        raw = raw.split(":", 1)[1]
    picks: set[int] = set()
    for token in [p.strip() for p in raw.split(",") if p.strip()]:
        if token.isdigit():
            wd = int(token)
            if 0 <= wd <= 6:
                picks.add(wd)
            continue
        wd = _WEEKDAY_MAP.get(token[:3])
        if wd is not None:
            picks.add(wd)
    return picks or {departure.weekday()}


def _legacy_weekly_occurrences(
    departure: datetime, weekdays: set[int], horizon_end: datetime
) -> list[datetime]:
    out: list[datetime] = []
    for day_offset in range(1, RECURRING_DAYS_AHEAD + 1):
        day = departure + timedelta(days=day_offset)
        if day > horizon_end or day.weekday() not in weekdays:
            continue
        out.append(departure.replace(year=day.year, month=day.month, day=day.day))
    return out


def _series_exception_dates(db: Session, template_id: str) -> set[date_cls]:
    rows = db.scalars(
        select(RideRecurrenceException.exception_date).where(
            RideRecurrenceException.template_ride_id == template_id,
            RideRecurrenceException.kind == SERIES_EXCEPTION_KIND_SKIP,
        )
    ).all()
    return set(rows)


def _recurring_child_departures(template: Ride) -> list[datetime]:
    """Return child departure datetimes for a recurring template within horizon."""
    dep = _as_utc(template.departure_time)
    horizon_end = dep + timedelta(days=RECURRING_DAYS_AHEAD)
    rule = (template.recurrence_rule or "").strip()

    if rule and "FREQ=" in rule.upper():
        try:
            occurrences = generate_occurrences(dep, rule)
        except RecurrenceError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return [occ for occ in occurrences[1:] if _as_utc(occ) <= horizon_end]

    weekdays = _parse_recurrence_weekdays(rule, dep)
    return _legacy_weekly_occurrences(dep, weekdays, horizon_end)


def _materialize_recurring_children(db: Session, template: Ride) -> None:
    """Create upcoming scheduled rides for the next few weeks from a template ride."""
    exception_dates = _series_exception_dates(db, template.id)
    for child_dep in _recurring_child_departures(template):
        if _as_utc(child_dep).date() in exception_dates:
            continue
        existing = db.scalar(
            select(Ride).where(
                Ride.parent_ride_id == template.id,
                Ride.departure_time == child_dep,
            )
        )
        if existing:
            if (
                existing.status == RideStatus.cancelled
                and (existing.cancel_reason or "").startswith(SERIES_EXCEPTION_REASON_PREFIX)
            ):
                existing.status = RideStatus.scheduled
                existing.cancelled_at = None
                existing.cancel_reason = None
                existing.available_seats = existing.total_seats
            continue
        db.add(
            Ride(
                driver_id=template.driver_id,
                vehicle_id=template.vehicle_id,
                parent_ride_id=template.id,
                origin=template.origin,
                origin_lat=template.origin_lat,
                origin_lng=template.origin_lng,
                destination=template.destination,
                dest_lat=template.dest_lat,
                dest_lng=template.dest_lng,
                departure_time=child_dep,
                total_seats=template.total_seats,
                available_seats=template.total_seats,
                fare_per_seat=template.fare_per_seat,
                distance_km=template.distance_km,
                route_polyline=template.route_polyline,
                is_recurring=False,
                recurrence_rule=None,
                status=RideStatus.scheduled,
            )
        )


def _cancel_ride_with_bookings(
    db: Session,
    ride: Ride,
    *,
    reason: str | None,
    background_tasks: BackgroundTasks | None = None,
    notify_passengers: bool = True,
    actor_id: str | None = None,
) -> None:
    """Cancel a ride, restore seats, refund paid bookings, notify passengers."""
    if ride.status in (RideStatus.completed, RideStatus.cancelled):
        return
    passengers = _active_passengers(db, ride)
    active_bookings = db.scalars(
        select(Booking).where(
            Booking.ride_id == ride.id,
            Booking.status.in_(ACTIVE_BOOKING_STATUSES),
        )
    ).all()
    seats_to_restore = sum(b.seats for b in active_bookings)

    ride.status = RideStatus.cancelled
    ride.cancelled_at = datetime.now(timezone.utc)
    ride.cancel_reason = reason
    ride.available_seats = min(ride.total_seats, ride.available_seats + seats_to_restore)

    for booking in active_bookings:
        booking.status = BookingStatus.cancelled
        booking.cancelled_at = datetime.now(timezone.utc)
        booking.cancel_reason = reason or "Ride cancelled by driver"
        refund_booking_if_paid(
            db,
            booking,
            reason="driver_cancel",
            actor_id=actor_id or ride.driver_id,
            ride=ride,
        )

    if not notify_passengers:
        return
    for passenger in passengers:
        notify.push(
            db,
            passenger,
            "ride_cancelled",
            "Ride cancelled",
            f"The driver cancelled your ride {notify.fmt_route(ride)}.",
            ref_id=ride.id,
            background_tasks=background_tasks,
            email=tpl.ride_cancelled(
                passenger_name=passenger.name,
                route=notify.fmt_route(ride),
                reason=reason,
            ),
        )


@router.post("", response_model=RideOut, status_code=201)
def offer_ride(
    payload: RideCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    # GATE: verified, non-expired driving licence + vehicle RC + insurance.
    if not _has_valid_license(db, user.id):
        raise HTTPException(
            status_code=403,
            detail="A verified, non-expired driving_license is required to offer rides",
        )
    if not _has_valid_doc(db, user.id, DocType.vehicle_rc):
        raise HTTPException(
            status_code=403,
            detail="A verified vehicle_rc is required to offer rides",
        )
    if not _has_valid_doc(db, user.id, DocType.vehicle_insurance):
        raise HTTPException(
            status_code=403,
            detail="A verified vehicle_insurance is required to offer rides",
        )
    # GATE: must own the vehicle and it must be active.
    vehicle = db.get(Vehicle, payload.vehicle_id)
    if not vehicle or vehicle.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if not vehicle.is_active:
        raise HTTPException(status_code=403, detail="At least one active vehicle is required")
    if payload.total_seats > vehicle.seating_capacity:
        raise HTTPException(
            status_code=400,
            detail=f"{vehicle.model} only seats {vehicle.seating_capacity}",
        )

    dep = payload.departure_time
    if dep.tzinfo is None:
        dep = dep.replace(tzinfo=timezone.utc)
    if dep < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="departure_time must be in the future")

    ride = Ride(
        driver_id=user.id,
        vehicle_id=vehicle.id,
        origin=payload.origin,
        origin_lat=payload.origin_lat,
        origin_lng=payload.origin_lng,
        destination=payload.destination,
        dest_lat=payload.dest_lat,
        dest_lng=payload.dest_lng,
        departure_time=payload.departure_time,
        total_seats=payload.total_seats,
        available_seats=payload.total_seats,
        fare_per_seat=payload.fare_per_seat,
        distance_km=payload.distance_km,
        route_polyline=payload.route_polyline,
        is_recurring=payload.is_recurring,
        recurrence_rule=payload.recurrence_rule,
        status=RideStatus.scheduled,
    )
    db.add(ride)
    db.flush()
    if ride.is_recurring:
        _materialize_recurring_children(db, ride)
    db.commit()
    db.refresh(ride)
    return ride


@router.get("/search", response_model=list[RideMatchOut])
def search_rides(
    origin_lat: float = Query(...),
    origin_lng: float = Query(...),
    dest_lat: float = Query(...),
    dest_lng: float = Query(...),
    seats: int = Query(default=1, ge=1),
    date: date_cls | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    now = datetime.now(timezone.utc)

    # Wider bbox so corridor matches near the route (not only OD pins) are included.
    lat_d, lng_d = bbox_deg(origin_lat, SEARCH_RADIUS_KM + CORRIDOR_KM)

    stmt = (
        select(Ride)
        .join(User, Ride.driver_id == User.id)
        .where(
            Ride.status == RideStatus.scheduled,
            Ride.available_seats >= seats,
            User.org_id == user.org_id,
            Ride.origin_lat.between(origin_lat - lat_d, origin_lat + lat_d),
            Ride.origin_lng.between(origin_lng - lng_d, origin_lng + lng_d),
        )
    )
    candidates = db.scalars(stmt).all()

    results: list[RideMatchOut] = []
    for ride in candidates:
        # Future departure only.
        dep = ride.departure_time
        if dep is not None:
            if dep.tzinfo is None:
                dep = dep.replace(tzinfo=timezone.utc)
            if dep < now:
                continue
        if date is not None and dep is not None and dep.date() != date:
            continue

        o_dist = haversine(origin_lat, origin_lng, ride.origin_lat, ride.origin_lng)
        d_dist = haversine(dest_lat, dest_lng, ride.dest_lat, ride.dest_lng)
        pin_ok = o_dist <= SEARCH_RADIUS_KM and d_dist <= SEARCH_RADIUS_KM
        corridor_ok = along_corridor(
            origin_lat,
            origin_lng,
            dest_lat,
            dest_lng,
            ride.origin_lat,
            ride.origin_lng,
            ride.dest_lat,
            ride.dest_lng,
            CORRIDOR_KM,
        )
        if not pin_ok and not corridor_ok:
            continue

        driver = db.get(User, ride.driver_id)
        vehicle = db.get(Vehicle, ride.vehicle_id)
        score = match_score(o_dist, d_dist, SEARCH_RADIUS_KM)
        if corridor_ok and not pin_ok:
            # Along-route match — slightly lower than tight pin matches.
            score = max(score, 55.0)
        results.append(
            RideMatchOut(
                ride=RideOut.model_validate(ride),
                driver=UserOut.model_validate(driver),
                vehicle=VehicleOut.model_validate(vehicle),
                match_score=score,
                origin_distance_km=round(o_dist, 3),
                dest_distance_km=round(d_dist, 3),
            )
        )

    results.sort(key=lambda r: r.match_score, reverse=True)
    return results


@router.get("/mine", response_model=list[RideOut])
def my_rides(db: Session = Depends(get_db), user: User = Depends(get_current_active_user)):
    return db.scalars(
        select(Ride).where(Ride.driver_id == user.id).order_by(Ride.departure_time.desc())
    ).all()


@router.get("/{ride_id}", response_model=RideDetailOut)
def get_ride(ride_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_active_user)):
    ride = _load_ride_same_org(ride_id, db, user)
    driver = db.get(User, ride.driver_id)
    vehicle = db.get(Vehicle, ride.vehicle_id)
    return RideDetailOut(
        **RideOut.model_validate(ride).model_dump(),
        driver=UserOut.model_validate(driver),
        vehicle=VehicleOut.model_validate(vehicle),
    )


@router.get("/{ride_id}/series", response_model=RideOut)
def get_series_template(
    ride_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_active_user)
):
    ride = _load_own_ride(ride_id, db, user)
    template = _series_template(ride, db, user)
    if not template:
        raise HTTPException(status_code=404, detail="Recurring series not found")
    return template


@router.get("/{ride_id}/series/upcoming", response_model=list[RideOut])
def series_upcoming(
    ride_id: str,
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    ride = _load_own_ride(ride_id, db, user)
    template = _series_template(ride, db, user)
    if not template:
        raise HTTPException(status_code=404, detail="Recurring series not found")

    now = datetime.now(timezone.utc)
    rows = db.scalars(
        select(Ride)
        .where(
            or_(Ride.id == template.id, Ride.parent_ride_id == template.id),
            Ride.departure_time >= now,
            Ride.status.in_([RideStatus.scheduled, RideStatus.cancelled]),
        )
        .order_by(Ride.departure_time.asc())
        .limit(limit)
    ).all()
    return rows


@router.get("/{ride_id}/series/exceptions", response_model=list[RideSeriesExceptionOut])
def series_exceptions(
    ride_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_active_user)
):
    ride = _load_own_ride(ride_id, db, user)
    template = _series_template(ride, db, user)
    if not template:
        raise HTTPException(status_code=404, detail="Recurring series not found")
    return db.scalars(
        select(RideRecurrenceException)
        .where(
            RideRecurrenceException.template_ride_id == template.id,
            RideRecurrenceException.kind == SERIES_EXCEPTION_KIND_SKIP,
        )
        .order_by(RideRecurrenceException.exception_date.asc())
    ).all()


@router.post("/{ride_id}/series/exceptions/skip", response_model=RideSeriesExceptionOut, status_code=201)
def add_series_exception(
    ride_id: str,
    payload: RideSeriesExceptionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    ride = _load_own_ride(ride_id, db, user)
    template = _series_template(ride, db, user)
    if not template:
        raise HTTPException(status_code=400, detail="Ride is not part of a recurring series")

    if payload.exception_date < date_cls.today():
        raise HTTPException(status_code=400, detail="Exception date must be today or later")

    existing = db.scalar(
        select(RideRecurrenceException).where(
            RideRecurrenceException.template_ride_id == template.id,
            RideRecurrenceException.exception_date == payload.exception_date,
            RideRecurrenceException.kind == SERIES_EXCEPTION_KIND_SKIP,
        )
    )
    if existing:
        return existing

    rows = db.scalars(
        select(Ride).where(or_(Ride.id == template.id, Ride.parent_ride_id == template.id))
    ).all()
    targets = [
        row
        for row in rows
        if _as_utc(row.departure_time).date() == payload.exception_date
        and row.status == RideStatus.scheduled
    ]
    for row in targets:
        has_active_booking = db.scalar(
            select(Booking.id).where(
                Booking.ride_id == row.id,
                Booking.status.in_(ACTIVE_BOOKING_STATUSES),
            )
        )
        if has_active_booking:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Cannot skip this date because an active booking exists. "
                    "Cancel/rebook first, then retry."
                ),
            )

    reason = SERIES_EXCEPTION_REASON_PREFIX
    if payload.reason:
        reason = f"{SERIES_EXCEPTION_REASON_PREFIX}: {payload.reason.strip()}"
    for row in targets:
        _cancel_ride_with_bookings(
            db, row, reason=reason, background_tasks=None, notify_passengers=False
        )

    exc = RideRecurrenceException(
        template_ride_id=template.id,
        exception_date=payload.exception_date,
        kind=SERIES_EXCEPTION_KIND_SKIP,
        reason=payload.reason.strip() if payload.reason else None,
        created_by=user.id,
    )
    db.add(exc)
    _materialize_recurring_children(db, template)
    db.commit()
    db.refresh(exc)
    return exc


@router.delete("/{ride_id}/series/exceptions/{exception_date}")
def remove_series_exception(
    ride_id: str,
    exception_date: date_cls,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    ride = _load_own_ride(ride_id, db, user)
    template = _series_template(ride, db, user)
    if not template:
        raise HTTPException(status_code=400, detail="Ride is not part of a recurring series")

    exc = db.scalar(
        select(RideRecurrenceException).where(
            RideRecurrenceException.template_ride_id == template.id,
            RideRecurrenceException.exception_date == exception_date,
            RideRecurrenceException.kind == SERIES_EXCEPTION_KIND_SKIP,
        )
    )
    if not exc:
        raise HTTPException(status_code=404, detail="Series exception not found")
    db.delete(exc)
    db.flush()

    now = datetime.now(timezone.utc)
    recreated = False
    rows = db.scalars(
        select(Ride).where(or_(Ride.id == template.id, Ride.parent_ride_id == template.id))
    ).all()
    matching = [row for row in rows if _as_utc(row.departure_time).date() == exception_date]
    for row in matching:
        if (
            row.status == RideStatus.cancelled
            and (row.cancel_reason or "").startswith(SERIES_EXCEPTION_REASON_PREFIX)
            and _as_utc(row.departure_time) > now
        ):
            row.status = RideStatus.scheduled
            row.cancelled_at = None
            row.cancel_reason = None
            row.available_seats = row.total_seats
            recreated = True

    _materialize_recurring_children(db, template)
    db.commit()
    return {"ok": True, "recreated": recreated}


@router.patch("/{ride_id}/series", response_model=RideOut)
def update_series(
    ride_id: str,
    payload: RideSeriesUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    ride = _load_own_ride(ride_id, db, user)
    template = _series_template(ride, db, user)
    if not template:
        raise HTTPException(status_code=400, detail="Ride is not part of a recurring series")

    vehicle = db.get(Vehicle, template.vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    dep_update = payload.departure_time
    if dep_update and dep_update.tzinfo is None:
        dep_update = dep_update.replace(tzinfo=timezone.utc)

    now = datetime.now(timezone.utc)
    if dep_update and dep_update < now:
        raise HTTPException(status_code=400, detail="Series departure_time must be in the future")

    future_children = db.scalars(
        select(Ride).where(
            Ride.parent_ride_id == template.id,
            Ride.status == RideStatus.scheduled,
            Ride.departure_time >= now,
        )
    ).all()

    targets: list[Ride] = []
    if template.status == RideStatus.scheduled and _as_utc(template.departure_time) >= now:
        targets.append(template)
    targets.extend(future_children)

    for row in targets:
        next_total = payload.total_seats if payload.total_seats is not None else row.total_seats
        if next_total > vehicle.seating_capacity:
            raise HTTPException(
                status_code=400,
                detail=f"{vehicle.model} only seats {vehicle.seating_capacity}",
            )
        booked = row.total_seats - row.available_seats
        if next_total < booked:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Cannot reduce seats below {booked} for ride on "
                    f"{row.departure_time.strftime('%Y-%m-%d %H:%M')}"
                ),
            )

    if dep_update is not None:
        template.departure_time = dep_update
    if payload.total_seats is not None:
        booked = template.total_seats - template.available_seats
        template.total_seats = payload.total_seats
        template.available_seats = payload.total_seats - booked
    if payload.fare_per_seat is not None:
        template.fare_per_seat = payload.fare_per_seat
    if payload.recurrence_rule is not None:
        template.recurrence_rule = payload.recurrence_rule

    for row in future_children:
        if payload.total_seats is not None:
            booked = row.total_seats - row.available_seats
            row.total_seats = payload.total_seats
            row.available_seats = payload.total_seats - booked
        if payload.fare_per_seat is not None:
            row.fare_per_seat = payload.fare_per_seat
        if dep_update is not None:
            new_dep = _as_utc(row.departure_time).replace(
                hour=dep_update.hour,
                minute=dep_update.minute,
                second=dep_update.second,
                microsecond=dep_update.microsecond,
            )
            if new_dep > now:
                row.departure_time = new_dep

    if payload.recurrence_rule is not None or dep_update is not None:
        keep_departures = {_dt_key(dt) for dt in _recurring_child_departures(template)}
        blocked_rows: list[str] = []
        cancellable_rows: list[Ride] = []
        for row in future_children:
            if _dt_key(row.departure_time) in keep_departures:
                continue
            has_active_booking = db.scalar(
                select(Booking.id).where(
                    Booking.ride_id == row.id,
                    Booking.status != BookingStatus.cancelled,
                )
            )
            if has_active_booking:
                blocked_rows.append(_as_utc(row.departure_time).strftime("%Y-%m-%d %H:%M"))
                continue
            cancellable_rows.append(row)

        if blocked_rows:
            sample = ", ".join(blocked_rows[:3])
            more = "" if len(blocked_rows) <= 3 else f" (+{len(blocked_rows) - 3} more)"
            raise HTTPException(
                status_code=409,
                detail=(
                    "Recurring update would leave booked off-pattern rides active: "
                    f"{sample}{more}. Cancel/rebook those rides first, then retry."
                ),
            )

        for row in cancellable_rows:
            _cancel_ride_with_bookings(
                db,
                row,
                reason="Removed from recurring pattern",
                notify_passengers=False,
            )

    _materialize_recurring_children(db, template)
    db.commit()
    db.refresh(template)
    return template


@router.post("/{ride_id}/series/cancel")
def cancel_series(
    ride_id: str,
    background_tasks: BackgroundTasks,
    payload: CancelRequest = CancelRequest(),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    ride = _load_own_ride(ride_id, db, user)
    template = _series_template(ride, db, user)
    if not template:
        raise HTTPException(status_code=400, detail="Ride is not part of a recurring series")

    now = datetime.now(timezone.utc)
    rows = db.scalars(
        select(Ride).where(
            or_(Ride.id == template.id, Ride.parent_ride_id == template.id),
            Ride.status.in_([RideStatus.scheduled, RideStatus.started, RideStatus.in_progress]),
            Ride.departure_time >= now,
        )
    ).all()
    cancelled = 0
    for row in rows:
        if row.status == RideStatus.cancelled:
            continue
        _cancel_ride_with_bookings(
            db,
            row,
            reason=payload.reason or "Recurring series cancelled by driver",
            background_tasks=background_tasks,
            notify_passengers=True,
        )
        cancelled += 1
    db.commit()
    return {"ok": True, "cancelled_rides": cancelled}


def _load_own_ride(ride_id: str, db: Session, user: User) -> Ride:
    ride = db.get(Ride, ride_id)
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    if ride.driver_id != user.id:
        raise HTTPException(status_code=403, detail="Only the driver can modify this ride")
    return ride


@router.post("/{ride_id}/start", response_model=RideOut)
def start_ride(
    ride_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    """scheduled → started (passengers notified; tracking may begin)."""
    ride = _load_own_ride(ride_id, db, user)
    if ride.status != RideStatus.scheduled:
        raise HTTPException(status_code=400, detail=f"Cannot start a {ride.status.value} ride")

    ride.status = RideStatus.started
    ride.started_at = datetime.now(timezone.utc)

    for passenger in _confirmed_passengers(db, ride):
        notify.push(
            db,
            passenger,
            "ride_started",
            "Your ride has started",
            f"Your ride {notify.fmt_route(ride)} is now on the way.",
            ref_id=ride.id,
            background_tasks=background_tasks,
            email=tpl.ride_started(
                passenger_name=passenger.name, route=notify.fmt_route(ride), ride_id=ride.id
            ),
        )

    db.commit()
    db.refresh(ride)
    return ride


@router.post("/{ride_id}/enroute", response_model=RideOut)
def mark_enroute(
    ride_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    """started → in_progress (vehicle is moving)."""
    ride = _load_own_ride(ride_id, db, user)
    if ride.status != RideStatus.started:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot mark en route from {ride.status.value}",
        )
    ride.status = RideStatus.in_progress
    db.commit()
    db.refresh(ride)
    return ride


@router.post("/{ride_id}/complete", response_model=RideOut)
def complete_ride(
    ride_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    ride = _load_own_ride(ride_id, db, user)
    if ride.status not in (RideStatus.in_progress, RideStatus.started):
        raise HTTPException(status_code=400, detail=f"Cannot complete a {ride.status.value} ride")
    ride.status = RideStatus.completed
    ride.ended_at = datetime.now(timezone.utc)

    for passenger in _confirmed_passengers(db, ride):
        booking = db.scalar(
            select(Booking).where(
                Booking.ride_id == ride.id,
                Booking.passenger_id == passenger.id,
                Booking.status.in_(CONFIRMED_BOOKING_STATUSES),
            )
        )
        amount = f"₹{Decimal(str(booking.fare_amount)):.2f}" if booking else "—"
        # Seed a pending payment so unpaid completed rides are visible in ledger.
        if booking:
            existing_pay = db.scalar(
                select(Payment).where(
                    Payment.booking_id == booking.id,
                    Payment.type == PaymentType.ride_payment,
                    Payment.status != PayStatus.failed,
                )
            )
            if not existing_pay:
                db.add(
                    Payment(
                        booking_id=booking.id,
                        payer_id=passenger.id,
                        payee_id=ride.driver_id,
                        type=PaymentType.ride_payment,
                        amount=Decimal(str(booking.fare_amount)),
                        method=PayMethod.wallet,
                        status=PayStatus.pending,
                        gateway_ref=None,
                    )
                )
        notify.push(
            db,
            passenger,
            "ride_completed",
            "Ride complete — payment due",
            f"Your ride {notify.fmt_route(ride)} is complete. Amount due: {amount}.",
            ref_id=ride.id,
            background_tasks=background_tasks,
            email=tpl.ride_completed(
                passenger_name=passenger.name,
                route=notify.fmt_route(ride),
                amount=amount,
                ride_id=ride.id,
            ),
        )

    db.commit()
    db.refresh(ride)
    return ride


@router.post("/{ride_id}/cancel", response_model=RideOut)
def cancel_ride(
    ride_id: str,
    background_tasks: BackgroundTasks,
    payload: CancelRequest = CancelRequest(),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    ride = _load_own_ride(ride_id, db, user)
    if ride.status in (RideStatus.completed, RideStatus.cancelled):
        raise HTTPException(status_code=400, detail=f"Cannot cancel a {ride.status.value} ride")

    _cancel_ride_with_bookings(
        db,
        ride,
        reason=payload.reason,
        background_tasks=background_tasks,
        notify_passengers=True,
        actor_id=user.id,
    )

    db.commit()
    db.refresh(ride)
    return ride


@router.post("/{ride_id}/locations", response_model=LocationOut, status_code=201)
def push_location(
    ride_id: str,
    payload: LocationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    ride = _load_ride_same_org(ride_id, db, user)
    if ride.driver_id != user.id:
        raise HTTPException(status_code=403, detail="Only the driver can push location updates")
    if ride.status not in (RideStatus.started, RideStatus.in_progress):
        raise HTTPException(
            status_code=400,
            detail="Location updates only allowed while the trip is started or in progress",
        )
    loc = TripLocation(ride_id=ride_id, lat=payload.lat, lng=payload.lng, eta=payload.eta)
    db.add(loc)
    # First GPS ping while "started" advances the ride to in_progress.
    if ride.status == RideStatus.started:
        ride.status = RideStatus.in_progress
    db.commit()
    db.refresh(loc)
    return loc


@router.get("/{ride_id}/locations", response_model=LocationOut | None)
def latest_location(ride_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_active_user)):
    ride = _load_ride_same_org(ride_id, db, user)
    loc = db.scalar(
        select(TripLocation)
        .where(TripLocation.ride_id == ride.id)
        .order_by(TripLocation.recorded_at.desc())
    )
    return loc


@router.get("/{ride_id}/bookings", response_model=list[RideBookingOut])
def ride_bookings(
    ride_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_active_user)
):
    ride = db.get(Ride, ride_id)
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    if ride.driver_id != user.id:
        raise HTTPException(status_code=403, detail="Only the driver can view ride bookings")
    rows = db.scalars(
        select(Booking).where(
            Booking.ride_id == ride_id,
            Booking.status.in_(
                ACTIVE_BOOKING_STATUSES + (BookingStatus.completed,)
            ),
        )
    ).all()
    out: list[RideBookingOut] = []
    for booking in rows:
        passenger = db.get(User, booking.passenger_id)
        if not passenger:
            continue
        out.append(
            RideBookingOut(
                **BookingOut.model_validate(booking).model_dump(),
                passenger=UserOut.model_validate(passenger),
            )
        )
    return out


@router.get("/{ride_id}/messages", response_model=list[MessageOut])
def get_messages(
    ride_id: str,
    peer_id: str = Query(..., description="Other participant for this 1:1 thread"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    """Return only the personal thread between the caller and peer_id."""
    ride = _load_ride_same_org(ride_id, db, user)
    if not _is_ride_participant(ride, user, db):
        raise HTTPException(status_code=403, detail="Not a participant on this ride")

    peer = db.get(User, peer_id)
    if peer is None or not _is_ride_participant(ride, peer, db):
        raise HTTPException(status_code=400, detail="peer_id is not a participant on this ride")
    if peer_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot open a chat with yourself")

    rows = db.scalars(
        select(Message)
        .options(joinedload(Message.sender))
        .where(
            Message.ride_id == ride.id,
            or_(
                and_(Message.sender_id == user.id, Message.receiver_id == peer_id),
                and_(Message.sender_id == peer_id, Message.receiver_id == user.id),
            ),
        )
        .order_by(Message.sent_at.asc())
    ).all()
    # Opening the thread marks inbound messages as read.
    dirty = False
    for m in rows:
        if m.receiver_id == user.id and not m.is_read:
            m.is_read = True
            dirty = True
    if dirty:
        db.commit()
    return rows


@router.get("/{ride_id}/messages/unread-count", response_model=UnreadCount)
def ride_chat_unread(
    ride_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    ride = _load_ride_same_org(ride_id, db, user)
    if not _is_ride_participant(ride, user, db):
        raise HTTPException(status_code=403, detail="Not a participant on this ride")
    count = db.scalar(
        select(func.count())
        .select_from(Message)
        .where(
            Message.ride_id == ride.id,
            Message.receiver_id == user.id,
            Message.is_read.is_(False),
        )
    )
    return UnreadCount(count=int(count or 0))


@router.post("/{ride_id}/messages", response_model=MessageOut, status_code=201)
async def post_message(
    ride_id: str,
    payload: MessageCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    from ..services.chat_hub import chat_hub

    ride = _load_ride_same_org(ride_id, db, user)
    if not _is_ride_participant(ride, user, db):
        raise HTTPException(status_code=403, detail="Not a participant on this ride")
    if ride.status == RideStatus.cancelled:
        raise HTTPException(status_code=400, detail="Chat is closed — this trip was cancelled")

    receiver = db.get(User, payload.receiver_id)
    receiver_is_participant = receiver is not None and _is_ride_participant(ride, receiver, db)
    if not receiver_is_participant:
        raise HTTPException(status_code=400, detail="receiver_id is not a participant on this ride")
    if payload.receiver_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot message yourself")

    # Block chat when the caller's (or peer's) booking was cancelled.
    if ride.driver_id != user.id:
        my_booking = db.scalar(
            select(Booking).where(
                Booking.ride_id == ride.id,
                Booking.passenger_id == user.id,
                Booking.status != BookingStatus.cancelled,
            )
        )
        if my_booking is None:
            raise HTTPException(
                status_code=400, detail="Chat is closed — booking was cancelled"
            )
    elif ride.driver_id != payload.receiver_id:
        peer_booking = db.scalar(
            select(Booking).where(
                Booking.ride_id == ride.id,
                Booking.passenger_id == payload.receiver_id,
                Booking.status != BookingStatus.cancelled,
            )
        )
        if peer_booking is None:
            raise HTTPException(
                status_code=400, detail="Chat is closed — passenger booking was cancelled"
            )

    msg = Message(
        ride_id=ride_id,
        sender_id=user.id,
        receiver_id=payload.receiver_id,
        body=payload.body,
    )
    db.add(msg)
    db.commit()

    loaded = db.scalar(
        select(Message)
        .options(joinedload(Message.sender))
        .where(Message.id == msg.id)
    )
    out = MessageOut.model_validate(loaded)
    # Include aliases so WS clients always get ``created_at`` (not ``sent_at``).
    await chat_hub.broadcast_message(
        out.model_dump(mode="json", by_alias=True)
    )
    return out
