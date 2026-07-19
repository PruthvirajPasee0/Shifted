import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

os.environ.setdefault("JWT_SECRET", "test-secret")

from app.database import Base  # noqa: E402
from app.models import (  # noqa: E402
    Booking,
    BookingStatus,
    FuelType,
    Organization,
    Ride,
    RideStatus,
    User,
    UserRole,
    UserStatus,
    Vehicle,
)


@pytest.fixture()
def db_session() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
        engine.dispose()


@pytest.fixture()
def payment_fixture(db_session: Session) -> dict[str, object]:
    org = Organization(id="org-pay", name="Acme", domain="acme.com")
    driver = User(
        id="user-driver-pay",
        org_id=org.id,
        name="Driver",
        email="driver@acme.com",
        password_hash="x",
        role=UserRole.employee,
        status=UserStatus.active,
    )
    passenger = User(
        id="user-passenger-pay",
        org_id=org.id,
        name="Passenger",
        email="passenger@acme.com",
        password_hash="x",
        role=UserRole.employee,
        status=UserStatus.active,
    )
    vehicle = Vehicle(
        id="vehicle-pay",
        owner_id=driver.id,
        model="Sedan",
        reg_number="KA-01-T-1000",
        seating_capacity=4,
        fuel_type=FuelType.petrol,
        is_active=True,
    )
    dep = (datetime.now(timezone.utc) - timedelta(hours=2)).replace(microsecond=0)
    ride = Ride(
        id="ride-pay",
        driver_id=driver.id,
        vehicle_id=vehicle.id,
        origin="A",
        origin_lat=12.97,
        origin_lng=77.59,
        destination="B",
        dest_lat=12.99,
        dest_lng=77.61,
        departure_time=dep,
        total_seats=4,
        available_seats=3,
        fare_per_seat=Decimal("100"),
        distance_km=Decimal("8.5"),
        status=RideStatus.completed,
        is_recurring=False,
    )
    booking = Booking(
        id="booking-pay",
        ride_id=ride.id,
        passenger_id=passenger.id,
        seats=1,
        fare_amount=Decimal("100"),
        status=BookingStatus.booked,
    )
    db_session.add_all([org, driver, passenger, vehicle, ride, booking])
    db_session.commit()
    return {
        "org": org,
        "driver": driver,
        "passenger": passenger,
        "vehicle": vehicle,
        "ride": ride,
        "booking": booking,
    }


def _next_weekday(base: datetime, weekday: int) -> datetime:
    days = (weekday - base.weekday()) % 7
    if days == 0:
        days = 7
    return (base + timedelta(days=days)).replace(hour=9, minute=0, second=0, microsecond=0)


@pytest.fixture()
def recurring_fixture(db_session: Session) -> dict[str, object]:
    org = Organization(id="org-series", name="Beta", domain="beta.com")
    driver = User(
        id="user-driver-series",
        org_id=org.id,
        name="Series Driver",
        email="series-driver@beta.com",
        password_hash="x",
        role=UserRole.employee,
        status=UserStatus.active,
    )
    passenger = User(
        id="user-passenger-series",
        org_id=org.id,
        name="Series Rider",
        email="series-rider@beta.com",
        password_hash="x",
        role=UserRole.employee,
        status=UserStatus.active,
    )
    vehicle = Vehicle(
        id="vehicle-series",
        owner_id=driver.id,
        model="Hatch",
        reg_number="KA-01-T-2000",
        seating_capacity=4,
        fuel_type=FuelType.petrol,
        is_active=True,
    )
    base = _next_weekday(datetime.now(timezone.utc), 0)  # Monday
    wednesday = _next_weekday(base, 2)
    next_monday = _next_weekday(base + timedelta(days=1), 0)

    template = Ride(
        id="ride-template-series",
        driver_id=driver.id,
        vehicle_id=vehicle.id,
        origin="Office",
        origin_lat=12.90,
        origin_lng=77.50,
        destination="Home",
        dest_lat=12.80,
        dest_lng=77.60,
        departure_time=base,
        total_seats=4,
        available_seats=4,
        fare_per_seat=Decimal("120"),
        status=RideStatus.scheduled,
        is_recurring=True,
        recurrence_rule="WEEKLY:MON,WED",
    )
    child_keep = Ride(
        id="ride-child-keep-series",
        driver_id=driver.id,
        vehicle_id=vehicle.id,
        parent_ride_id=template.id,
        origin=template.origin,
        origin_lat=template.origin_lat,
        origin_lng=template.origin_lng,
        destination=template.destination,
        dest_lat=template.dest_lat,
        dest_lng=template.dest_lng,
        departure_time=next_monday,
        total_seats=4,
        available_seats=4,
        fare_per_seat=Decimal("120"),
        status=RideStatus.scheduled,
        is_recurring=False,
    )
    child_drop = Ride(
        id="ride-child-drop-series",
        driver_id=driver.id,
        vehicle_id=vehicle.id,
        parent_ride_id=template.id,
        origin=template.origin,
        origin_lat=template.origin_lat,
        origin_lng=template.origin_lng,
        destination=template.destination,
        dest_lat=template.dest_lat,
        dest_lng=template.dest_lng,
        departure_time=wednesday,
        total_seats=4,
        available_seats=4,
        fare_per_seat=Decimal("120"),
        status=RideStatus.scheduled,
        is_recurring=False,
    )
    db_session.add_all([org, driver, passenger, vehicle, template, child_keep, child_drop])
    db_session.commit()
    return {
        "org": org,
        "driver": driver,
        "passenger": passenger,
        "vehicle": vehicle,
        "template": template,
        "child_keep": child_keep,
        "child_drop": child_drop,
    }
