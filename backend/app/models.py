import uuid
import enum
from datetime import datetime, date

from sqlalchemy import (
    String,
    Integer,
    BigInteger,
    Float,
    Boolean,
    Text,
    Numeric,
    DateTime,
    Date,
    ForeignKey,
    Enum,
    Index,
    CheckConstraint,
    UniqueConstraint,
    text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def gen_uuid() -> str:
    return str(uuid.uuid4())


PK = lambda: mapped_column(String(36), primary_key=True, default=gen_uuid)  # noqa: E731


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------
class UserRole(str, enum.Enum):
    admin = "admin"
    employee = "employee"


class UserStatus(str, enum.Enum):
    invited = "invited"
    active = "active"
    suspended = "suspended"


class FuelType(str, enum.Enum):
    petrol = "petrol"
    diesel = "diesel"
    ev = "ev"
    cng = "cng"


class RideStatus(str, enum.Enum):
    scheduled = "scheduled"
    started = "started"
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"


class BookingStatus(str, enum.Enum):
    # pending/rejected kept for legacy rows; new bookings use booked immediately.
    pending = "pending"
    booked = "booked"
    rejected = "rejected"
    cancelled = "cancelled"
    completed = "completed"


# Active seat-holding bookings (instant-confirm flow uses booked only).
ACTIVE_BOOKING_STATUSES = (BookingStatus.booked,)
# Confirmed riders who travel on the trip.
CONFIRMED_BOOKING_STATUSES = (BookingStatus.booked, BookingStatus.completed)


class RefundStatus(str, enum.Enum):
    none = "none"
    pending = "pending"
    success = "success"
    failed = "failed"


class RefundSource(str, enum.Enum):
    wallet = "wallet"
    gateway = "gateway"
    manual = "manual"


class PaymentType(str, enum.Enum):
    ride_payment = "ride_payment"
    wallet_recharge = "wallet_recharge"


class PayMethod(str, enum.Enum):
    cash = "cash"
    card = "card"
    upi = "upi"
    wallet = "wallet"


class PayStatus(str, enum.Enum):
    pending = "pending"
    success = "success"
    failed = "failed"


class WtxnType(str, enum.Enum):
    recharge = "recharge"
    debit = "debit"
    credit = "credit"


class DocType(str, enum.Enum):
    driving_license = "driving_license"
    id_proof = "id_proof"
    vehicle_rc = "vehicle_rc"
    vehicle_insurance = "vehicle_insurance"


class DocStatus(str, enum.Enum):
    pending = "pending"
    verified = "verified"
    rejected = "rejected"


class PmType(str, enum.Enum):
    card = "card"
    upi = "upi"


class TicketStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    closed = "closed"


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = PK()
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    domain: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(120), nullable=True)
    admin_contact: Mapped[str | None] = mapped_column(String(255), nullable=True)
    fuel_cost_per_litre: Mapped[float | None] = mapped_column(Numeric(12, 2), default=100)
    cost_per_km: Mapped[float | None] = mapped_column(Numeric(12, 2), default=10)
    travel_cost: Mapped[float | None] = mapped_column(Numeric(12, 2), default=2.5)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    users: Mapped[list["User"]] = relationship(back_populates="organization", foreign_keys="User.org_id")


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = PK()
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    phone: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.employee)
    # Self-signup must stay pending until an admin grants access.
    # Admin-created employees set status=active explicitly.
    status: Mapped[UserStatus] = mapped_column(
        Enum(UserStatus, values_callable=lambda x: [e.value for e in x], native_enum=False),
        default=UserStatus.invited,
        nullable=False,
    )
    photo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    manager: Mapped[str | None] = mapped_column(String(120), nullable=True)
    office_location: Mapped[str | None] = mapped_column(String(120), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    organization: Mapped["Organization"] = relationship(back_populates="users", foreign_keys=[org_id])
    vehicles: Mapped[list["Vehicle"]] = relationship(back_populates="owner")


class Vehicle(Base):
    __tablename__ = "vehicles"
    __table_args__ = (
        CheckConstraint("seating_capacity >= 1", name="ck_vehicle_seats_positive"),
        CheckConstraint(
            "mileage_kmpl IS NULL OR mileage_kmpl > 0", name="ck_vehicle_mileage_positive"
        ),
    )

    id: Mapped[str] = PK()
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    model: Mapped[str] = mapped_column(String(255), nullable=False)
    reg_number: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    seating_capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    fuel_type: Mapped[FuelType] = mapped_column(Enum(FuelType), nullable=False)
    mileage_kmpl: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    color: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    owner: Mapped["User"] = relationship(back_populates="vehicles")


class SavedPlace(Base):
    __tablename__ = "saved_places"

    id: Mapped[str] = PK()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)


class Ride(Base):
    __tablename__ = "rides"
    __table_args__ = (
        CheckConstraint("total_seats >= 1", name="ck_ride_total_seats_positive"),
        CheckConstraint("available_seats >= 0", name="ck_ride_available_seats_nonneg"),
        CheckConstraint(
            "available_seats <= total_seats", name="ck_ride_available_lte_total"
        ),
        CheckConstraint("fare_per_seat >= 0", name="ck_ride_fare_nonneg"),
    )

    id: Mapped[str] = PK()
    driver_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    vehicle_id: Mapped[str] = mapped_column(ForeignKey("vehicles.id"), nullable=False)
    parent_ride_id: Mapped[str | None] = mapped_column(ForeignKey("rides.id"), nullable=True)
    origin: Mapped[str] = mapped_column(String(500), nullable=False)
    origin_lat: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    origin_lng: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    destination: Mapped[str] = mapped_column(String(500), nullable=False)
    dest_lat: Mapped[float] = mapped_column(Float, nullable=False)
    dest_lng: Mapped[float] = mapped_column(Float, nullable=False)
    departure_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    total_seats: Mapped[int] = mapped_column(Integer, nullable=False)
    available_seats: Mapped[int] = mapped_column(Integer, nullable=False)
    fare_per_seat: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    distance_km: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    route_polyline: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_recurring: Mapped[bool] = mapped_column(Boolean, default=False)
    recurrence_rule: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[RideStatus] = mapped_column(Enum(RideStatus), default=RideStatus.scheduled, index=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    driver: Mapped["User"] = relationship(foreign_keys=[driver_id])
    vehicle: Mapped["Vehicle"] = relationship(foreign_keys=[vehicle_id])


class Booking(Base):
    __tablename__ = "bookings"
    __table_args__ = (
        # Partial unique index: a passenger may hold only one *active*
        # booking per ride, but a cancelled booking must not block a rebook.
        Index(
            "uq_booking_ride_passenger_active",
            "ride_id",
            "passenger_id",
            unique=True,
            sqlite_where=text("status NOT IN ('cancelled', 'rejected')"),
            postgresql_where=text("status NOT IN ('cancelled', 'rejected')"),
        ),
        CheckConstraint("seats >= 1", name="ck_booking_seats_positive"),
        CheckConstraint("fare_amount >= 0", name="ck_booking_fare_nonneg"),
    )

    id: Mapped[str] = PK()
    ride_id: Mapped[str] = mapped_column(ForeignKey("rides.id"), nullable=False, index=True)
    passenger_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    seats: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    pickup_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    pickup_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    drop_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    drop_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    fare_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    status: Mapped[BookingStatus] = mapped_column(Enum(BookingStatus), default=BookingStatus.booked)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    booked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    ride: Mapped["Ride"] = relationship(foreign_keys=[ride_id])
    passenger: Mapped["User"] = relationship(foreign_keys=[passenger_id])


class TripLocation(Base):
    __tablename__ = "trip_locations"

    id: Mapped[str] = PK()
    ride_id: Mapped[str] = mapped_column(ForeignKey("rides.id"), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    eta: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[str] = PK()
    booking_id: Mapped[str | None] = mapped_column(ForeignKey("bookings.id"), nullable=True)
    payer_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    payee_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    type: Mapped[PaymentType] = mapped_column(Enum(PaymentType), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    method: Mapped[PayMethod] = mapped_column(Enum(PayMethod), nullable=False)
    status: Mapped[PayStatus] = mapped_column(Enum(PayStatus), default=PayStatus.pending)
    gateway_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    refund_status: Mapped[RefundStatus] = mapped_column(
        Enum(RefundStatus), default=RefundStatus.none
    )
    refunded_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    refund_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PaymentRefund(Base):
    """Immutable refund event ledger."""

    __tablename__ = "payment_refunds"
    __table_args__ = (
        UniqueConstraint(
            "payment_id",
            "booking_id",
            "reason_category",
            name="uq_payment_refund_idempotency",
        ),
        CheckConstraint("amount >= 0", name="ck_payment_refund_amount_nonneg"),
    )

    id: Mapped[str] = PK()
    payment_id: Mapped[str] = mapped_column(ForeignKey("payments.id"), nullable=False, index=True)
    booking_id: Mapped[str | None] = mapped_column(ForeignKey("bookings.id"), nullable=True)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    reason_category: Mapped[str] = mapped_column(String(64), nullable=False, default="cancel")
    source: Mapped[RefundSource] = mapped_column(Enum(RefundSource), nullable=False)
    status: Mapped[RefundStatus] = mapped_column(Enum(RefundStatus), default=RefundStatus.pending)
    gateway_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Wallet(Base):
    __tablename__ = "wallets"
    __table_args__ = (CheckConstraint("balance >= 0", name="ck_wallet_balance_nonneg"),)

    id: Mapped[str] = PK()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)
    balance: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class WalletTransaction(Base):
    __tablename__ = "wallet_transactions"

    id: Mapped[str] = PK()
    wallet_id: Mapped[str] = mapped_column(ForeignKey("wallets.id"), nullable=False)
    type: Mapped[WtxnType] = mapped_column(Enum(WtxnType), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    balance_after: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    ref_payment_id: Mapped[str | None] = mapped_column(ForeignKey("payments.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = PK()
    ride_id: Mapped[str] = mapped_column(ForeignKey("rides.id"), nullable=False)
    sender_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    receiver_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sender: Mapped["User"] = relationship(foreign_keys=[sender_id])

    @property
    def sender_name(self) -> str | None:
        return self.sender.name if self.sender else None


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = PK()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Optional entity id for deep links (ride id, document id, …).
    ref_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Rating(Base):
    __tablename__ = "ratings"
    __table_args__ = (CheckConstraint("stars BETWEEN 1 AND 5", name="ck_rating_stars_range"),)

    id: Mapped[str] = PK()
    ride_id: Mapped[str] = mapped_column(ForeignKey("rides.id"), nullable=False)
    rater_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    ratee_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    stars: Mapped[int] = mapped_column(Integer, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = PK()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    doc_type: Mapped[DocType] = mapped_column(Enum(DocType), nullable=False)
    doc_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    file_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[DocStatus] = mapped_column(Enum(DocStatus), default=DocStatus.pending)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    verified_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PaymentMethod(Base):
    __tablename__ = "payment_methods"

    id: Mapped[str] = PK()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    type: Mapped[PmType] = mapped_column(Enum(PmType), nullable=False)
    label: Mapped[str | None] = mapped_column(String(128), nullable=True)
    masked_detail: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id: Mapped[str] = PK()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[TicketStatus] = mapped_column(Enum(TicketStatus), default=TicketStatus.open)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RideRecurrenceException(Base):
    __tablename__ = "ride_recurrence_exceptions"
    __table_args__ = (
        UniqueConstraint(
            "template_ride_id",
            "exception_date",
            name="uq_ride_recurrence_exception_template_date",
        ),
    )

    id: Mapped[str] = PK()
    template_ride_id: Mapped[str] = mapped_column(
        ForeignKey("rides.id"), nullable=False, index=True
    )
    exception_date: Mapped[date] = mapped_column(Date, nullable=False)
    # Current sprint supports "skip" dates.
    kind: Mapped[str] = mapped_column(String(24), default="skip")
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
