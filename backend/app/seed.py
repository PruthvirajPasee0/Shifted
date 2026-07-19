"""Seed the database with demo data.

Run with:  python -m app.seed
"""
from datetime import datetime, timezone, timedelta, date
from decimal import Decimal

from sqlalchemy import select

from .database import Base, engine, SessionLocal
from .security import hash_password
from .models import (
    Organization,
    User,
    Vehicle,
    Document,
    Ride,
    Wallet,
    UserRole,
    UserStatus,
    FuelType,
    DocType,
    DocStatus,
    RideStatus,
)

ORG_DOMAIN = "acme.com"
ADMIN_EMAIL = "admin@acme.com"
ADMIN_PASSWORD = "Admin@123"
EMP_PASSWORD = "Employee@123"

# (name, email, phone, department, manager, office_location)
EMPLOYEES = [
    ("Ravi Kumar", "ravi@acme.com", 9000000001, "Engineering", "A. Shah", "Bengaluru"),
    ("Priya Sharma", "priya@acme.com", 9000000002, "Human Resources", "A. Shah", "Gandhinagar"),
    ("Arjun Mehta", "arjun@acme.com", 9000000003, "Sales", "R. Mehta", "Bengaluru"),
    ("Neha Verma", "neha@acme.com", 9000000004, "Finance", "R. Mehta", "Pune"),
]


def _ensure_wallet(db, user_id, balance=0):
    if not db.scalar(select(Wallet).where(Wallet.user_id == user_id)):
        db.add(Wallet(user_id=user_id, balance=Decimal(str(balance))))


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        org = db.scalar(select(Organization).where(Organization.domain == ORG_DOMAIN))
        if not org:
            org = Organization(
                name="Acme Corp",
                domain=ORG_DOMAIN,
                address="1 Industrial Ave, Bengaluru",
                industry="Software",
                admin_contact="admin@acme.com",
                fuel_cost_per_litre=Decimal("105.50"),
                cost_per_km=Decimal("8.00"),
                travel_cost=Decimal("2.50"),
                currency="INR",
            )
            db.add(org)
            db.flush()

        # Admin
        admin = db.scalar(select(User).where(User.email == ADMIN_EMAIL))
        if not admin:
            admin = User(
                org_id=org.id,
                name="Acme Admin",
                email=ADMIN_EMAIL,
                phone=9000000000,
                password_hash=hash_password(ADMIN_PASSWORD),
                role=UserRole.admin,
                status=UserStatus.active,
            )
            db.add(admin)
            db.flush()
            _ensure_wallet(db, admin.id, 0)

        # Employees
        emp_objs = []
        for name, email, phone, dept, mgr, loc in EMPLOYEES:
            u = db.scalar(select(User).where(User.email == email))
            if not u:
                u = User(
                    org_id=org.id,
                    name=name,
                    email=email,
                    phone=phone,
                    password_hash=hash_password(EMP_PASSWORD),
                    role=UserRole.employee,
                    status=UserStatus.active,
                    department=dept,
                    manager=mgr,
                    office_location=loc,
                )
                db.add(u)
                db.flush()
                _ensure_wallet(db, u.id, 500)
            emp_objs.append(u)

        driver = emp_objs[0]

        # Vehicles for the driver
        vehicle = db.scalar(select(Vehicle).where(Vehicle.reg_number == "KA01AB1234"))
        if not vehicle:
            vehicle = Vehicle(
                owner_id=driver.id,
                model="Toyota Innova",
                reg_number="KA01AB1234",
                seating_capacity=6,
                fuel_type=FuelType.diesel,
                mileage_kmpl=Decimal("12.50"),
                color="White",
                is_active=True,
            )
            db.add(vehicle)
            db.flush()

        vehicle2 = db.scalar(select(Vehicle).where(Vehicle.reg_number == "KA05EV9999"))
        if not vehicle2:
            vehicle2 = Vehicle(
                owner_id=emp_objs[1].id,
                model="Tata Nexon EV",
                reg_number="KA05EV9999",
                seating_capacity=4,
                fuel_type=FuelType.ev,
                mileage_kmpl=Decimal("30.00"),
                color="Blue",
                is_active=True,
            )
            db.add(vehicle2)
            db.flush()

        # Verified driving docs for the driver (licence + RC + insurance).
        for dtype, number, url in (
            (DocType.driving_license, "DL-KA-2029-0001", "https://example.com/docs/dl-ravi.pdf"),
            (DocType.vehicle_rc, "RC-KA-01-AB-1234", "https://example.com/docs/rc-ravi.pdf"),
            (
                DocType.vehicle_insurance,
                "INS-KA-7788",
                "https://example.com/docs/ins-ravi.pdf",
            ),
        ):
            existing = db.scalar(
                select(Document).where(
                    Document.user_id == driver.id, Document.doc_type == dtype
                )
            )
            if not existing:
                db.add(
                    Document(
                        user_id=driver.id,
                        doc_type=dtype,
                        doc_number=number,
                        file_url=url,
                        status=DocStatus.verified,
                        expiry_date=date(2030, 12, 31),
                        verified_by=admin.id,
                        verified_at=datetime.now(timezone.utc),
                    )
                )

        # A pending document for admin to review
        pending = db.scalar(
            select(Document).where(
                Document.user_id == emp_objs[1].id, Document.doc_type == DocType.driving_license
            )
        )
        if not pending:
            db.add(
                Document(
                    user_id=emp_objs[1].id,
                    doc_type=DocType.driving_license,
                    doc_number="DL-KA-2028-0777",
                    file_url="https://example.com/docs/dl-priya.pdf",
                    status=DocStatus.pending,
                    expiry_date=date(2029, 6, 30),
                )
            )

        # A couple of rides
        if not db.scalar(select(Ride).where(Ride.driver_id == driver.id)):
            now = datetime.now(timezone.utc)
            db.add(
                Ride(
                    driver_id=driver.id,
                    vehicle_id=vehicle.id,
                    origin="Koramangala, Bengaluru",
                    origin_lat=12.9352,
                    origin_lng=77.6245,
                    destination="Whitefield, Bengaluru",
                    dest_lat=12.9698,
                    dest_lng=77.7500,
                    departure_time=now + timedelta(days=1, hours=1),
                    total_seats=4,
                    available_seats=4,
                    fare_per_seat=Decimal("120.00"),
                    distance_km=Decimal("18.50"),
                    status=RideStatus.scheduled,
                )
            )
            db.add(
                Ride(
                    driver_id=driver.id,
                    vehicle_id=vehicle.id,
                    origin="Indiranagar, Bengaluru",
                    origin_lat=12.9719,
                    origin_lng=77.6412,
                    destination="Electronic City, Bengaluru",
                    dest_lat=12.8452,
                    dest_lng=77.6602,
                    departure_time=now - timedelta(days=2),
                    started_at=now - timedelta(days=2, hours=-1),
                    ended_at=now - timedelta(days=2, hours=-2),
                    total_seats=4,
                    available_seats=4,
                    fare_per_seat=Decimal("150.00"),
                    distance_km=Decimal("22.00"),
                    status=RideStatus.completed,
                )
            )

        db.commit()
        print("Seed complete.")
        print(f"  Organization : {org.name} (domain={org.domain})")
        print(f"  Admin        : {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
        print("  Employees    :")
        for row in EMPLOYEES:
            name, email = row[0], row[1]
            print(f"    - {email} / {EMP_PASSWORD}  ({name})")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
