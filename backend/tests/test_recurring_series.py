from datetime import timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Booking, BookingStatus, Ride, RideStatus
from app.routers.rides import update_series
from app.schemas import RideSeriesUpdate


def test_series_update_blocks_if_booked_off_pattern_ride_exists(
    db_session: Session, recurring_fixture: dict[str, object]
):
    driver = recurring_fixture["driver"]
    template = recurring_fixture["template"]
    child_drop = recurring_fixture["child_drop"]
    passenger = recurring_fixture["passenger"]

    child_drop.available_seats = 3
    db_session.add(
        Booking(
            id="booking-series-block",
            ride_id=child_drop.id,
            passenger_id=passenger.id,
            seats=1,
            fare_amount=Decimal("120"),
            status=BookingStatus.booked,
        )
    )
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        update_series(
            template.id,
            RideSeriesUpdate(recurrence_rule="WEEKLY:MON"),
            db_session,
            driver,
        )

    assert exc.value.status_code == 409
    assert "off-pattern rides active" in str(exc.value.detail).lower()
    db_session.refresh(child_drop)
    assert child_drop.status == RideStatus.scheduled


def test_series_update_cancels_unbooked_off_pattern_children(
    db_session: Session, recurring_fixture: dict[str, object]
):
    driver = recurring_fixture["driver"]
    template = recurring_fixture["template"]
    child_keep = recurring_fixture["child_keep"]
    child_drop = recurring_fixture["child_drop"]

    updated = update_series(
        template.id,
        RideSeriesUpdate(recurrence_rule="WEEKLY:MON"),
        db_session,
        driver,
    )

    assert updated.recurrence_rule == "WEEKLY:MON"
    db_session.refresh(child_keep)
    db_session.refresh(child_drop)
    assert child_keep.status == RideStatus.scheduled
    assert child_drop.status == RideStatus.cancelled


def test_series_update_accepts_rrule_until_and_cancels_beyond_until(
    db_session: Session, recurring_fixture: dict[str, object]
):
    driver = recurring_fixture["driver"]
    template = recurring_fixture["template"]
    child_keep = recurring_fixture["child_keep"]
    child_drop = recurring_fixture["child_drop"]

    later_monday = child_keep.departure_time + timedelta(days=7)
    extra_late = Ride(
        id="ride-child-late-series",
        driver_id=template.driver_id,
        vehicle_id=template.vehicle_id,
        parent_ride_id=template.id,
        origin=template.origin,
        origin_lat=template.origin_lat,
        origin_lng=template.origin_lng,
        destination=template.destination,
        dest_lat=template.dest_lat,
        dest_lng=template.dest_lng,
        departure_time=later_monday,
        total_seats=4,
        available_seats=4,
        fare_per_seat=Decimal("120"),
        status=RideStatus.scheduled,
        is_recurring=False,
    )
    db_session.add(extra_late)
    db_session.commit()

    until_date = child_keep.departure_time.date().isoformat()
    rrule = f"FREQ=WEEKLY;BYDAY=MO;UNTIL={until_date}"
    update_series(template.id, RideSeriesUpdate(recurrence_rule=rrule), db_session, driver)

    db_session.refresh(child_keep)
    db_session.refresh(child_drop)
    db_session.refresh(extra_late)
    db_session.refresh(template)
    assert template.recurrence_rule == rrule
    assert child_keep.status == RideStatus.scheduled
    assert child_drop.status == RideStatus.cancelled
    assert extra_late.status == RideStatus.cancelled
