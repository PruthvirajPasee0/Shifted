"""Enrich the database with richer demo data for end-to-end testing.

Adds more employees, vehicles, verified KYC docs, bookable future rides,
bookings, a completed ride with payment + wallet movements + ratings,
wallet recharge history, notifications and a support ticket — on top of
whatever ``app.seed`` already created.

Idempotent: guarded on a marker employee, so re-running is a no-op.

Run with:  python -m app.seed_extra   (after python -m app.seed)
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
    Booking,
    Payment,
    Wallet,
    WalletTransaction,
    Notification,
    Rating,
    SupportTicket,
    UserRole,
    UserStatus,
    FuelType,
    DocType,
    DocStatus,
    RideStatus,
    BookingStatus,
    PaymentType,
    PayMethod,
    PayStatus,
    WtxnType,
    TicketStatus,
)

ORG_DOMAIN = "acme.com"
EMP_PASSWORD = "Employee@123"
MARKER_EMAIL = "meera@acme.com"

# name, email, phone, department, manager, office_location, wallet_balance
EXTRA_EMPLOYEES = [
    ("Meera Nair", "meera@acme.com", 9000000005, "Marketing", "R. Mehta", "Bengaluru", 1500),
    ("Sanjay Rao", "sanjay@acme.com", 9000000006, "Operations", "A. Shah", "Bengaluru", 1500),
    ("Divya Iyer", "divya@acme.com", 9000000007, "Design", "R. Mehta", "Pune", 800),
]


def _wallet(db, user_id) -> Wallet:
    w = db.scalar(select(Wallet).where(Wallet.user_id == user_id))
    if not w:
        w = Wallet(user_id=user_id, balance=Decimal("0"))
        db.add(w)
        db.flush()
    return w


def _set_balance(db, user_id, amount) -> None:
    w = _wallet(db, user_id)
    w.balance = Decimal(str(amount))


def _txn(db, user_id, ttype: WtxnType, amount, ref_payment_id=None) -> None:
    """Apply a signed wallet movement and record it with balance_after."""
    w = _wallet(db, user_id)
    amt = Decimal(str(amount))
    if ttype == WtxnType.debit:
        w.balance = w.balance - amt
    else:  # recharge / credit
        w.balance = w.balance + amt
    db.add(
        WalletTransaction(
            wallet_id=w.id,
            type=ttype,
            amount=amt,
            balance_after=w.balance,
            ref_payment_id=ref_payment_id,
        )
    )


def seed_extra():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        org = db.scalar(select(Organization).where(Organization.domain == ORG_DOMAIN))
        if not org:
            print("Base org not found — run `python -m app.seed` first.")
            return

        if db.scalar(select(User).where(User.email == MARKER_EMAIL)):
            print("Extra demo data already present — nothing to do.")
            return

        admin = db.scalar(
            select(User).where(User.org_id == org.id, User.role == UserRole.admin)
        )

        # Existing seeded users we reference below.
        ravi = db.scalar(select(User).where(User.email == "ravi@acme.com"))
        priya = db.scalar(select(User).where(User.email == "priya@acme.com"))
        arjun = db.scalar(select(User).where(User.email == "arjun@acme.com"))
        neha = db.scalar(select(User).where(User.email == "neha@acme.com"))

        # --- Extra employees + funded wallets -----------------------------
        people = {}
        for name, email, phone, dept, mgr, loc, bal in EXTRA_EMPLOYEES:
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
            _set_balance(db, u.id, bal)
            people[email] = u
        meera = people["meera@acme.com"]
        sanjay = people["sanjay@acme.com"]
        divya = people["divya@acme.com"]

        # Top up a couple of existing passengers so payments are testable.
        _set_balance(db, priya.id, 2000)
        _set_balance(db, arjun.id, 2000)
        _set_balance(db, neha.id, 1200)

        # --- Extra vehicles ----------------------------------------------
        swift = Vehicle(
            owner_id=meera.id, model="Maruti Swift", reg_number="KA03CD4567",
            seating_capacity=5, fuel_type=FuelType.petrol,
            mileage_kmpl=Decimal("22.00"), color="Red", is_active=True,
        )
        creta = Vehicle(
            owner_id=sanjay.id, model="Hyundai Creta", reg_number="KA04EF7788",
            seating_capacity=5, fuel_type=FuelType.diesel,
            mileage_kmpl=Decimal("17.00"), color="Grey", is_active=True,
        )
        db.add_all([swift, creta])
        db.flush()

        # --- Verified KYC so Meera & Sanjay can publish -------------------
        now = datetime.now(timezone.utc)
        for drv, veh in ((meera, swift), (sanjay, creta)):
            db.add(Document(
                user_id=drv.id, doc_type=DocType.driving_license,
                doc_number=f"DL-KA-2027-{drv.id[:4].upper()}",
                file_url="https://example.com/docs/dl.pdf",
                status=DocStatus.verified, expiry_date=date(2031, 3, 31),
                verified_by=admin.id if admin else None, verified_at=now,
            ))
            db.add(Document(
                user_id=drv.id, vehicle_id=veh.id, doc_type=DocType.vehicle_insurance,
                doc_number=f"INS-{veh.reg_number}", file_url="https://example.com/docs/ins.pdf",
                status=DocStatus.verified, expiry_date=date(2027, 1, 31),
                verified_by=admin.id if admin else None, verified_at=now,
            ))

        # A fresh pending doc for the admin review queue.
        db.add(Document(
            user_id=divya.id, doc_type=DocType.id_proof, doc_number="AADHAAR-XXXX-1234",
            file_url="https://example.com/docs/id.pdf", status=DocStatus.pending,
            expiry_date=date(2032, 12, 31),
        ))

        ravi_vehicle = db.scalar(
            select(Vehicle).where(Vehicle.reg_number == "KA01AB1234")
        )

        # --- Bookable FUTURE rides ---------------------------------------
        def mk_ride(driver, veh, origin, o_lat, o_lng, dest, d_lat, d_lng,
                    when, total, avail, fare, dist):
            r = Ride(
                driver_id=driver.id, vehicle_id=veh.id,
                origin=origin, origin_lat=o_lat, origin_lng=o_lng,
                destination=dest, dest_lat=d_lat, dest_lng=d_lng,
                departure_time=when, total_seats=total, available_seats=avail,
                fare_per_seat=Decimal(str(fare)), distance_km=Decimal(str(dist)),
                status=RideStatus.scheduled,
            )
            db.add(r)
            db.flush()
            return r

        ride1 = mk_ride(ravi, ravi_vehicle, "MG Road, Bengaluru", 12.9756, 77.6068,
                        "Manyata Tech Park, Bengaluru", 13.0470, 77.6200,
                        now + timedelta(days=1, hours=2), 4, 3, 90, 14.0)
        ride2 = mk_ride(meera, swift, "Koramangala, Bengaluru", 12.9352, 77.6245,
                        "Whitefield, Bengaluru", 12.9698, 77.7500,
                        now + timedelta(days=2, hours=1), 4, 4, 110, 18.0)
        ride3 = mk_ride(sanjay, creta, "HSR Layout, Bengaluru", 12.9116, 77.6389,
                        "Electronic City, Bengaluru", 12.8452, 77.6602,
                        now + timedelta(days=1, hours=9), 4, 2, 70, 12.0)
        mk_ride(ravi, ravi_vehicle, "Indiranagar, Bengaluru", 12.9719, 77.6412,
                "Hebbal, Bengaluru", 13.0358, 77.5970,
                now + timedelta(days=3, hours=2), 3, 3, 130, 16.0)

        # --- Active bookings on the future rides -------------------------
        db.add(Booking(ride_id=ride1.id, passenger_id=priya.id, seats=1,
                       fare_amount=Decimal("90"), status=BookingStatus.booked))
        db.add(Booking(ride_id=ride3.id, passenger_id=arjun.id, seats=1,
                       fare_amount=Decimal("70"), status=BookingStatus.booked))
        db.add(Booking(ride_id=ride3.id, passenger_id=neha.id, seats=1,
                       fare_amount=Decimal("70"), status=BookingStatus.booked))

        # --- A COMPLETED ride: booking + payment + wallet + ratings ------
        done = Ride(
            driver_id=meera.id, vehicle_id=swift.id,
            origin="Jayanagar, Bengaluru", origin_lat=12.9250, origin_lng=77.5938,
            destination="MG Road, Bengaluru", dest_lat=12.9756, dest_lng=77.6068,
            departure_time=now - timedelta(days=2, hours=3),
            started_at=now - timedelta(days=2, hours=3),
            ended_at=now - timedelta(days=2, hours=2, minutes=20),
            total_seats=4, available_seats=3,
            fare_per_seat=Decimal("100"), distance_km=Decimal("10.0"),
            status=RideStatus.completed,
        )
        db.add(done)
        db.flush()

        done_booking = Booking(
            ride_id=done.id, passenger_id=sanjay.id, seats=1,
            fare_amount=Decimal("100"), status=BookingStatus.completed,
        )
        db.add(done_booking)
        db.flush()

        pay = Payment(
            booking_id=done_booking.id, payer_id=sanjay.id, payee_id=meera.id,
            type=PaymentType.ride_payment, amount=Decimal("100"),
            method=PayMethod.wallet, status=PayStatus.success, gateway_ref="demo-txn-001",
        )
        db.add(pay)
        db.flush()

        _txn(db, sanjay.id, WtxnType.debit, 100, ref_payment_id=pay.id)
        _txn(db, meera.id, WtxnType.credit, 100, ref_payment_id=pay.id)

        db.add(Rating(ride_id=done.id, rater_id=sanjay.id, ratee_id=meera.id,
                      stars=5, comment="Smooth ride, great driver!"))
        db.add(Rating(ride_id=done.id, rater_id=meera.id, ratee_id=sanjay.id,
                      stars=5, comment="Punctual and friendly."))

        # --- Wallet recharge history -------------------------------------
        for u, amt in ((priya, 1000), (arjun, 1500)):
            rp = Payment(
                booking_id=None, payer_id=u.id, payee_id=None,
                type=PaymentType.wallet_recharge, amount=Decimal(str(amt)),
                method=PayMethod.upi, status=PayStatus.success,
                gateway_ref=f"rzp_demo_{u.id[:6]}",
            )
            db.add(rp)
            db.flush()
            _txn(db, u.id, WtxnType.recharge, amt, ref_payment_id=rp.id)

        # --- Notifications ------------------------------------------------
        db.add_all([
            Notification(user_id=priya.id, type="booking", title="Booking confirmed",
                         body="Your seat on MG Road → Manyata Tech Park is confirmed.",
                         is_read=False),
            Notification(user_id=ravi.id, type="booking", title="New booking",
                         body="Priya Sharma booked a seat on your MG Road ride.",
                         is_read=False),
            Notification(user_id=meera.id, type="rating", title="You got a 5★ rating",
                         body="Sanjay Rao rated your trip 5 stars.", is_read=True),
            Notification(user_id=sanjay.id, type="ride", title="Ride completed",
                         body="Your trip to MG Road is complete. Hope it went well!",
                         is_read=False),
        ])

        # --- Support ticket ----------------------------------------------
        db.add(SupportTicket(
            user_id=divya.id, subject="How do I become a driver?",
            body="I uploaded my ID proof — what are the next steps to publish a ride?",
            status=TicketStatus.open,
        ))

        db.commit()
        print("Extra demo data seeded.")
        print("  + Employees : meera@acme.com, sanjay@acme.com, divya@acme.com  (pw: Employee@123)")
        print("  + Vehicles  : Maruti Swift (Meera), Hyundai Creta (Sanjay)")
        print("  + Rides     : 4 upcoming bookable + 1 completed (with payment & ratings)")
        print("  + Bookings  : Priya, Arjun, Neha on upcoming rides")
        print("  + Wallets   : funded + recharge/debit/credit history")
        print("  + Extras    : notifications, a pending KYC doc, a support ticket")
    finally:
        db.close()


if __name__ == "__main__":
    seed_extra()
