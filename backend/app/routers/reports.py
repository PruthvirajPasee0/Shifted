import csv
import io
from decimal import Decimal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_active_user
from ..models import (
    CONFIRMED_BOOKING_STATUSES,
    User,
    Ride,
    Vehicle,
    Booking,
    Organization,
    RideStatus,
    BookingStatus,
    UserRole,
)
from ..schemas import ReportSummary, PerVehicleReport, MonthlyReport
from ..utils import fuel_litres, trip_cost

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/summary", response_model=ReportSummary)
def summary(db: Session = Depends(get_db), user: User = Depends(get_current_active_user)):
    org = db.get(Organization, user.org_id)
    fuel_cost_per_litre = org.fuel_cost_per_litre if org else 0

    if user.role == UserRole.admin:
        # All completed rides driven by users in the org.
        stmt = (
            select(Ride)
            .join(User, Ride.driver_id == User.id)
            .where(Ride.status == RideStatus.completed, User.org_id == user.org_id)
        )
        rides = db.scalars(stmt).all()
    else:
        # Employee: trips as driver OR as passenger (non-cancelled booking).
        driven = db.scalars(
            select(Ride).where(
                Ride.status == RideStatus.completed, Ride.driver_id == user.id
            )
        ).all()
        passenger_ids = db.scalars(
            select(Booking.ride_id).where(
                Booking.passenger_id == user.id,
                Booking.status.in_(CONFIRMED_BOOKING_STATUSES),
            )
        ).all()
        as_passenger = []
        if passenger_ids:
            as_passenger = db.scalars(
                select(Ride).where(
                    Ride.status == RideStatus.completed,
                    Ride.id.in_(list(passenger_ids)),
                )
            ).all()
        seen: dict[str, Ride] = {}
        for r in list(driven) + list(as_passenger):
            seen[r.id] = r
        rides = list(seen.values())

    total_trips = 0
    total_distance = Decimal("0")
    total_fuel = Decimal("0")
    total_cost = Decimal("0")
    seats_offered = 0
    seats_used = 0
    co2_saved_kg = 0.0
    per_vehicle: dict[str, dict] = {}
    monthly: dict[str, dict] = {}

    for ride in rides:
        vehicle = db.get(Vehicle, ride.vehicle_id)
        if not vehicle:
            continue
        dist = Decimal(str(ride.distance_km or 0))
        litres = fuel_litres(dist, vehicle.mileage_kmpl)
        cost = trip_cost(dist, vehicle.mileage_kmpl, fuel_cost_per_litre)

        total_trips += 1
        total_distance += dist
        total_fuel += litres
        total_cost += cost

        booked = db.scalar(
            select(func.coalesce(func.sum(Booking.seats), 0)).where(
                Booking.ride_id == ride.id,
                Booking.status.in_(CONFIRMED_BOOKING_STATUSES),
            )
        )
        seats_offered += ride.total_seats or 0
        seats_used += int(booked or 0)
        # For passenger-only view of someone else's car, count own seats toward CO2.
        if user.role != UserRole.admin and ride.driver_id != user.id:
            my_seats = db.scalar(
                select(func.coalesce(func.sum(Booking.seats), 0)).where(
                    Booking.ride_id == ride.id,
                    Booking.passenger_id == user.id,
                    Booking.status.in_(CONFIRMED_BOOKING_STATUSES),
                )
            )
            co2_saved_kg += float(dist) * 0.121 * int(my_seats or 0)
        else:
            co2_saved_kg += float(dist) * 0.121 * int(booked or 0)

        row = per_vehicle.setdefault(
            vehicle.id,
            {
                "model": vehicle.model,
                "trips": 0,
                "distance": Decimal("0"),
                "fuel": Decimal("0"),
                "cost": Decimal("0"),
            },
        )
        row["trips"] += 1
        row["distance"] += dist
        row["fuel"] += litres
        row["cost"] += cost

        when = ride.ended_at or ride.departure_time
        mkey = when.strftime("%Y-%m") if when else "—"
        mrow = monthly.setdefault(
            mkey,
            {
                "trips": 0,
                "distance": Decimal("0"),
                "fuel": Decimal("0"),
                "cost": Decimal("0"),
            },
        )
        mrow["trips"] += 1
        mrow["distance"] += dist
        mrow["fuel"] += litres
        mrow["cost"] += cost

    avg_cost_per_km = float(total_cost / total_distance) if total_distance > 0 else 0.0
    utilization_rate = round(100 * seats_used / seats_offered, 1) if seats_offered else 0.0

    return ReportSummary(
        total_trips=total_trips,
        total_distance_km=float(total_distance),
        total_fuel_litres=float(total_fuel),
        avg_cost_per_km=round(avg_cost_per_km, 4),
        co2_saved_kg=round(co2_saved_kg, 1),
        utilization_rate=utilization_rate,
        per_vehicle=[
            PerVehicleReport(
                model=r["model"],
                trips=r["trips"],
                distance=float(r["distance"]),
                fuel=float(r["fuel"]),
                cost=float(r["cost"]),
            )
            for r in per_vehicle.values()
        ],
        monthly=[
            MonthlyReport(
                month=k,
                trips=v["trips"],
                distance_km=float(v["distance"]),
                fuel_litres=float(v["fuel"]),
                cost=float(v["cost"]),
            )
            for k, v in sorted(monthly.items())
        ],
    )


@router.get("/export.csv")
def export_summary_csv(
    db: Session = Depends(get_db), user: User = Depends(get_current_active_user)
):
    """CSV download of the same aggregates as /reports/summary."""
    data = summary(db=db, user=user)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "total_trips",
            "total_distance_km",
            "total_fuel_litres",
            "avg_cost_per_km",
            "co2_saved_kg",
            "utilization_rate",
        ]
    )
    writer.writerow(
        [
            data.total_trips,
            data.total_distance_km,
            data.total_fuel_litres,
            data.avg_cost_per_km,
            data.co2_saved_kg,
            data.utilization_rate,
        ]
    )
    writer.writerow([])
    writer.writerow(["vehicle_model", "trips", "distance_km", "fuel_litres", "cost"])
    for row in data.per_vehicle:
        writer.writerow([row.model, row.trips, row.distance, row.fuel, row.cost])
    writer.writerow([])
    writer.writerow(["month", "trips", "distance_km", "fuel_litres", "cost"])
    for row in data.monthly:
        writer.writerow(
            [row.month, row.trips, row.distance_km, row.fuel_litres, row.cost]
        )

    buf.seek(0)
    filename = "shifted-report.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export.pdf")
def export_summary_pdf(
    db: Session = Depends(get_db), user: User = Depends(get_current_active_user)
):
    """PDF download of the same aggregates as /reports/summary."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    data = summary(db=db, user=user)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
    )
    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "TitleBrand",
        parent=styles["Heading1"],
        fontSize=18,
        textColor=colors.HexColor("#141a30"),
        spaceAfter=4,
    )
    sub = ParagraphStyle(
        "Sub",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.HexColor("#6a7291"),
        spaceAfter=12,
    )
    section = ParagraphStyle(
        "Section",
        parent=styles["Heading2"],
        fontSize=12,
        textColor=colors.HexColor("#4f46e5"),
        spaceBefore=10,
        spaceAfter=6,
    )

    story = [
        Paragraph("Shifted — Fleet report", title),
        Paragraph(
            f"Organisation report · generated for {user.name} · {user.email}",
            sub,
        ),
        Paragraph("Summary", section),
    ]

    summary_table = Table(
        [
            ["Metric", "Value"],
            ["Total trips", str(data.total_trips)],
            ["Distance (km)", f"{data.total_distance_km:.1f}"],
            ["Fuel (litres)", f"{data.total_fuel_litres:.1f}"],
            ["Avg cost / km", f"{data.avg_cost_per_km:.4f}"],
            ["CO₂ saved (kg)", f"{data.co2_saved_kg:.1f}"],
            ["Seat utilisation %", f"{data.utilization_rate:.1f}"],
        ],
        colWidths=[90 * mm, 70 * mm],
    )
    summary_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#141a30")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e5e9f3")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7f8fc")]),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.extend([summary_table, Spacer(1, 8)])

    story.append(Paragraph("Per vehicle", section))
    vehicle_rows = [["Vehicle", "Trips", "Distance km", "Fuel L", "Cost"]]
    for row in data.per_vehicle:
        vehicle_rows.append(
            [
                row.model,
                str(row.trips),
                f"{row.distance:.1f}",
                f"{row.fuel:.1f}",
                f"{row.cost:.2f}",
            ]
        )
    if len(vehicle_rows) == 1:
        vehicle_rows.append(["—", "0", "0.0", "0.0", "0.00"])
    vehicle_table = Table(vehicle_rows, colWidths=[50 * mm, 25 * mm, 30 * mm, 25 * mm, 30 * mm])
    vehicle_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#4f46e5")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e5e9f3")),
                ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7f8fc")]),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.extend([vehicle_table, Spacer(1, 8)])

    story.append(Paragraph("Monthly", section))
    monthly_rows = [["Month", "Trips", "Distance km", "Fuel L", "Cost"]]
    for row in data.monthly:
        monthly_rows.append(
            [
                row.month,
                str(row.trips),
                f"{row.distance_km:.1f}",
                f"{row.fuel_litres:.1f}",
                f"{row.cost:.2f}",
            ]
        )
    if len(monthly_rows) == 1:
        monthly_rows.append(["—", "0", "0.0", "0.0", "0.00"])
    monthly_table = Table(monthly_rows, colWidths=[40 * mm, 25 * mm, 35 * mm, 30 * mm, 30 * mm])
    monthly_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0d9488")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e5e9f3")),
                ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7f8fc")]),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(monthly_table)

    doc.build(story)
    buf.seek(0)
    filename = "shifted-report.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
