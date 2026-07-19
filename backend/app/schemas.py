import re
from datetime import datetime, date
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, EmailStr, ConfigDict, Field, field_validator, AliasChoices

from .models import (
    UserRole,
    UserStatus,
    FuelType,
    RideStatus,
    BookingStatus,
    PayMethod,
    PayStatus,
    PaymentType,
    RefundStatus,
    WtxnType,
    PmType,
    DocType,
    DocStatus,
    TicketStatus,
)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


Latitude = Annotated[float, Field(ge=-90, le=90)]
Longitude = Annotated[float, Field(ge=-180, le=180)]
# Indian mobile numbers: 10 digits, first digit 6-9.
Phone = Annotated[int, Field(ge=6_000_000_000, le=9_999_999_999)]

# Strong password: >= 8 chars with upper, lower, digit and special character.
_PASSWORD_RULE = re.compile(
    r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$"
)


def validate_strong_password(value: str) -> str:
    if not _PASSWORD_RULE.match(value):
        raise ValueError(
            "Password must be at least 8 characters and include an uppercase "
            "letter, a lowercase letter, a number and a special character."
        )
    return value


# --------------------------- Auth / Users ---------------------------
class RegisterRequest(BaseModel):
    org_id: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    phone: Phone | None = None
    password: str = Field(min_length=8, max_length=72)
    photo_url: str | None = None
    department: str | None = None
    manager: str | None = None
    office_location: str | None = None

    _check_password = field_validator("password")(validate_strong_password)


class OrgPublic(ORMModel):
    """Minimal org info exposed publicly for the signup organization picker."""
    id: str
    name: str
    domain: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(ORMModel):
    id: str
    org_id: str
    name: str
    email: EmailStr
    phone: int | None = None
    role: UserRole
    status: UserStatus
    photo_url: str | None = None
    department: str | None = None
    manager: str | None = None
    office_location: str | None = None
    created_at: datetime | None = None


class ProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    phone: Phone | None = None
    photo_url: str | None = None
    department: str | None = None
    manager: str | None = None
    office_location: str | None = None


class AdminEmployeeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    phone: Phone | None = None
    password: str = Field(min_length=8, max_length=72, default="Employee@123")
    department: str | None = None
    manager: str | None = None
    office_location: str | None = None

    _check_password = field_validator("password")(validate_strong_password)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class RegisterPendingResponse(BaseModel):
    """Returned after self-signup — no token until an admin grants access."""

    message: str
    email: EmailStr
    status: UserStatus


class UserStatusUpdate(BaseModel):
    status: UserStatus


class AdminStats(BaseModel):
    total_employees: int
    registered_vehicles: int
    rides_this_month: int
    pending_documents: int
    suspended_employees: int
    pending_approvals: int = 0


# --------------------------- Organizations ---------------------------
class OrgOut(ORMModel):
    id: str
    name: str
    domain: str
    address: str | None = None
    industry: str | None = None
    admin_contact: str | None = None
    fuel_cost_per_litre: float | None = None
    cost_per_km: float | None = None
    travel_cost: float | None = None
    currency: str


class OrgUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    address: str | None = None
    industry: str | None = None
    admin_contact: str | None = None
    fuel_cost_per_litre: Decimal | None = Field(default=None, ge=0)
    cost_per_km: Decimal | None = Field(default=None, ge=0)
    travel_cost: Decimal | None = Field(default=None, ge=0)


class AdminVehicleOut(ORMModel):
    id: str
    owner_id: str
    owner_name: str | None = None
    model: str
    reg_number: str
    seating_capacity: int
    fuel_type: FuelType
    mileage_kmpl: float | None = None
    color: str | None = None
    is_active: bool


# --------------------------- Vehicles ---------------------------
class VehicleCreate(BaseModel):
    model: str = Field(min_length=1, max_length=255)
    reg_number: str = Field(min_length=1, max_length=64)
    seating_capacity: int = Field(ge=1, le=20)
    fuel_type: FuelType
    mileage_kmpl: Decimal | None = Field(default=None, gt=0)
    color: str | None = None


class VehicleUpdate(BaseModel):
    model: str | None = Field(default=None, min_length=1, max_length=255)
    reg_number: str | None = Field(default=None, min_length=1, max_length=64)
    seating_capacity: int | None = Field(default=None, ge=1, le=20)
    fuel_type: FuelType | None = None
    mileage_kmpl: Decimal | None = Field(default=None, gt=0)
    color: str | None = None
    is_active: bool | None = None


class VehicleOut(ORMModel):
    id: str
    owner_id: str
    model: str
    reg_number: str
    seating_capacity: int
    fuel_type: FuelType
    mileage_kmpl: float | None = None
    color: str | None = None
    is_active: bool


# --------------------------- Documents ---------------------------
# Uploaded files are stored inline as data URLs. 5 MB raw ≈ 6.99 MB base64,
# plus the data-URL prefix — cap a little above that.
MAX_FILE_URL_LEN = 7_500_000


class DocumentCreate(BaseModel):
    doc_type: DocType
    doc_number: str | None = Field(default=None, max_length=128)
    file_url: str | None = Field(default=None, max_length=MAX_FILE_URL_LEN)
    expiry_date: date | None = None


class DocumentVerify(BaseModel):
    status: DocStatus
    rejection_reason: str | None = None


class DocumentOut(ORMModel):
    id: str
    user_id: str
    doc_type: DocType
    doc_number: str | None = None
    file_url: str | None = None
    status: DocStatus
    expiry_date: date | None = None
    verified_by: str | None = None
    verified_at: datetime | None = None
    rejection_reason: str | None = None
    uploaded_at: datetime | None = None


# --------------------------- Saved places ---------------------------
class PlaceCreate(BaseModel):
    label: str = Field(min_length=1, max_length=128)
    address: str | None = None
    lat: Latitude
    lng: Longitude


class PlaceOut(ORMModel):
    id: str
    user_id: str
    label: str
    address: str | None = None
    lat: float
    lng: float


# --------------------------- Rides ---------------------------
class RideCreate(BaseModel):
    vehicle_id: str
    origin: str = Field(min_length=1, max_length=500)
    origin_lat: Latitude
    origin_lng: Longitude
    destination: str = Field(min_length=1, max_length=500)
    dest_lat: Latitude
    dest_lng: Longitude
    departure_time: datetime
    total_seats: int = Field(ge=1, le=20)
    fare_per_seat: Decimal = Field(gt=0)
    distance_km: Decimal | None = Field(default=None, ge=0)
    route_polyline: str | None = None
    is_recurring: bool = False
    recurrence_rule: str | None = None


class RideOut(ORMModel):
    id: str
    driver_id: str
    vehicle_id: str
    parent_ride_id: str | None = None
    origin: str
    origin_lat: float
    origin_lng: float
    destination: str
    dest_lat: float
    dest_lng: float
    departure_time: datetime
    started_at: datetime | None = None
    ended_at: datetime | None = None
    total_seats: int
    available_seats: int
    fare_per_seat: float
    distance_km: float | None = None
    route_polyline: str | None = None
    is_recurring: bool
    recurrence_rule: str | None = None
    status: RideStatus
    cancel_reason: str | None = None
    created_at: datetime | None = None


class RideMatchOut(BaseModel):
    ride: RideOut
    driver: UserOut
    vehicle: VehicleOut
    match_score: float
    origin_distance_km: float
    dest_distance_km: float


class RideDetailOut(RideOut):
    driver: UserOut
    vehicle: VehicleOut


class CancelRequest(BaseModel):
    reason: str | None = None


class RideSeriesUpdate(BaseModel):
    departure_time: datetime | None = None
    total_seats: int | None = Field(default=None, ge=1, le=20)
    fare_per_seat: Decimal | None = Field(default=None, gt=0)
    recurrence_rule: str | None = None


class RideSeriesExceptionCreate(BaseModel):
    exception_date: date
    reason: str | None = Field(default=None, max_length=500)


class RideSeriesExceptionOut(ORMModel):
    id: str
    template_ride_id: str
    exception_date: date
    kind: str
    reason: str | None = None
    created_by: str | None = None
    created_at: datetime | None = None


class LocationCreate(BaseModel):
    lat: Latitude
    lng: Longitude
    eta: int | None = Field(default=None, ge=0)


class LocationOut(ORMModel):
    id: str
    ride_id: str
    lat: float
    lng: float
    eta: int | None = None
    recorded_at: datetime | None = None


# --------------------------- Bookings ---------------------------
class BookingCreate(BaseModel):
    ride_id: str
    seats: int = Field(ge=1, le=20)
    pickup_lat: Latitude | None = None
    pickup_lng: Longitude | None = None
    drop_lat: Latitude | None = None
    drop_lng: Longitude | None = None


class BookingOut(ORMModel):
    id: str
    ride_id: str
    passenger_id: str
    seats: int
    pickup_lat: float | None = None
    pickup_lng: float | None = None
    drop_lat: float | None = None
    drop_lng: float | None = None
    fare_amount: float
    status: BookingStatus
    cancelled_at: datetime | None = None
    cancel_reason: str | None = None
    booked_at: datetime | None = None


class BookingDetailOut(BookingOut):
    ride: RideOut | None = None


class RideBookingOut(BookingOut):
    """Booking row for the driver, with passenger identity for 1:1 chat."""

    passenger: UserOut


# --------------------------- Wallet ---------------------------
class WalletTxnOut(ORMModel):
    id: str
    wallet_id: str
    type: WtxnType
    amount: float
    balance_after: float
    ref_payment_id: str | None = None
    created_at: datetime | None = None


class WalletOut(BaseModel):
    id: str
    balance: float
    transactions: list[WalletTxnOut]


class PaymentMethodCreate(BaseModel):
    type: PmType
    detail: str = Field(min_length=3, max_length=128)
    label: str | None = Field(default=None, max_length=128)
    is_default: bool = False


class PaymentMethodUpdate(BaseModel):
    label: str | None = Field(default=None, max_length=128)
    is_default: bool | None = None


class PaymentMethodOut(ORMModel):
    id: str
    user_id: str
    type: PmType
    label: str | None = None
    masked_detail: str | None = None
    is_default: bool
    created_at: datetime | None = None


class RechargeRequest(BaseModel):
    amount: Decimal = Field(gt=0)
    method: PayMethod = PayMethod.upi


class RechargeOrderRequest(BaseModel):
    amount: Decimal = Field(gt=0)


class RechargeOrderOut(BaseModel):
    order_id: str
    amount: int  # in paise
    currency: str
    key_id: str
    razorpay: bool = True


class RechargeVerifyRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


# --------------------------- Payments ---------------------------
class PaymentCreate(BaseModel):
    booking_id: str
    method: PayMethod


class RidePaymentOrderRequest(BaseModel):
    booking_id: str
    method: PayMethod


class RidePaymentOrderOut(BaseModel):
    order_id: str
    amount: int  # in paise
    currency: str
    key_id: str
    razorpay: bool = True


class RidePaymentVerifyRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class PaymentOut(ORMModel):
    id: str
    booking_id: str | None = None
    payer_id: str
    payee_id: str | None = None
    type: PaymentType
    amount: float
    method: PayMethod
    status: PayStatus
    gateway_ref: str | None = None
    refund_status: RefundStatus = RefundStatus.none
    refunded_amount: float = 0
    refund_ref: str | None = None
    created_at: datetime | None = None


# --------------------------- Support ---------------------------
class SupportTicketCreate(BaseModel):
    subject: str = Field(min_length=3, max_length=255)
    body: str | None = Field(default=None, max_length=4000)


class SupportTicketUpdate(BaseModel):
    status: TicketStatus


class SupportTicketOut(ORMModel):
    id: str
    user_id: str
    subject: str
    body: str | None = None
    status: TicketStatus
    user_name: str | None = None
    user_email: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


# --------------------------- Reports ---------------------------
class PerVehicleReport(BaseModel):
    model: str
    trips: int
    distance: float
    fuel: float
    cost: float


class MonthlyReport(BaseModel):
    month: str
    trips: int
    distance_km: float
    fuel_litres: float
    cost: float


class ReportSummary(BaseModel):
    total_trips: int
    total_distance_km: float
    total_fuel_litres: float
    avg_cost_per_km: float
    co2_saved_kg: float = 0.0
    utilization_rate: float = 0.0
    per_vehicle: list[PerVehicleReport]
    monthly: list[MonthlyReport] = []


# --------------------------- Ratings ---------------------------
class RatingCreate(BaseModel):
    ride_id: str
    ratee_id: str
    stars: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=1000)


class RatingOut(ORMModel):
    id: str
    ride_id: str
    rater_id: str
    ratee_id: str
    stars: int
    comment: str | None = None


class RatingSummary(BaseModel):
    user_id: str
    average_stars: float
    total_ratings: int


# --------------------------- Notifications ---------------------------
class NotificationOut(ORMModel):
    id: str
    type: str | None = None
    title: str | None = None
    body: str | None = None
    ref_id: str | None = None
    is_read: bool
    created_at: datetime | None = None


class UnreadCount(BaseModel):
    count: int


# --------------------------- Messages ---------------------------
class MessageCreate(BaseModel):
    receiver_id: str
    body: str = Field(min_length=1, max_length=2000)


class MessageOut(ORMModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    ride_id: str
    sender_id: str
    receiver_id: str
    sender_name: str | None = None
    body: str
    is_read: bool = False
    # Stored on the model as ``sent_at``; exposed as ``created_at`` for the client.
    created_at: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("sent_at", "created_at"),
        serialization_alias="created_at",
    )


class ChatWsPacket(BaseModel):
    """Envelope for WebSocket chat frames (ready / message / pong / error)."""

    type: str
    peer_id: str | None = None
    user_id: str | None = None
    room: str | None = None
    data: MessageOut | None = None
    detail: str | None = None


class ChatUnreadOut(BaseModel):
    count: int
    ride_id: str | None = None
