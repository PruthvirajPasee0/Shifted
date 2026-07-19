"""Build the Enterprise Carpooling Platform schema PDF (reportlab)."""
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, Image, PageBreak, HRFlowable)
from reportlab.lib.utils import ImageReader
import os

BASE = r"C:\Users\pulse\OneDrive\Documents\Odoo_hackathon"
ERD  = os.path.join(BASE, "carpool_schema_erd.png")
OUT  = os.path.join(BASE, "Carpool_Platform_Schema.pdf")

NAVY   = colors.HexColor("#0f172a")
BLUE   = colors.HexColor("#2563eb")
LBLUE  = colors.HexColor("#dbeafe")
SLATE  = colors.HexColor("#475569")
LIGHT  = colors.HexColor("#f1f5f9")
AMBER  = colors.HexColor("#b45309")
TEAL   = colors.HexColor("#0f766e")
WHITE  = colors.white

ss = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=ss["Heading1"], textColor=NAVY, fontSize=22,
                    spaceAfter=6, leading=26)
H2 = ParagraphStyle("H2", parent=ss["Heading2"], textColor=BLUE, fontSize=14,
                    spaceBefore=12, spaceAfter=4, leading=17)
BODY = ParagraphStyle("BODY", parent=ss["BodyText"], textColor=colors.HexColor("#1e293b"),
                      fontSize=10, leading=14, alignment=TA_LEFT)
SMALL = ParagraphStyle("SMALL", parent=BODY, fontSize=8.5, leading=11,
                       textColor=SLATE)
CELL = ParagraphStyle("CELL", parent=BODY, fontSize=8.3, leading=10.5)
CELLB = ParagraphStyle("CELLB", parent=CELL, fontName="Helvetica-Bold")
TITLE = ParagraphStyle("TITLE", parent=ss["Title"], textColor=NAVY, fontSize=30,
                       leading=34, spaceAfter=4)
SUB = ParagraphStyle("SUB", parent=BODY, fontSize=13, textColor=SLATE, leading=18)

story = []

# ---------- COVER ----------
story += [Spacer(1, 60*mm)]
story.append(Paragraph("Enterprise Carpooling Platform", TITLE))
story.append(Paragraph("Database Schema &amp; Technical Design", SUB))
story.append(Spacer(1, 4*mm))
story.append(HRFlowable(width="100%", thickness=2, color=BLUE))
story.append(Spacer(1, 6*mm))
story.append(Paragraph(
    "This document defines the relational data model for an enterprise ride-sharing "
    "platform where employees of registered organizations discover, offer, book, track, "
    "and pay for shared rides. It covers every table, its columns, keys, constraints, and "
    "the enumerations that drive the trip and payment lifecycle, followed by a recommended "
    "technology stack for the hackathon build.", BODY))
story.append(Spacer(1, 8*mm))
meta = Table([
    ["Scope", "Multi-tenant (multiple organizations)"],
    ["Engine", "PostgreSQL 15+ (+ PostGIS for matching)"],
    ["Stack", "FastAPI (Python) · React · PostgreSQL+PostGIS · free OSM maps — CONFIRMED"],
    ["Modules", "Auth · KYC/Docs · Rides · Bookings · Trips · Live Tracking · Wallet/Payments · Reports"],
    ["Tables", "17 core entities"],
], colWidths=[35*mm, 130*mm])
meta.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (0,-1), LIGHT),
    ("TEXTCOLOR", (0,0), (0,-1), NAVY),
    ("FONTNAME", (0,0), (0,-1), "Helvetica-Bold"),
    ("FONTSIZE", (0,0), (-1,-1), 9.5),
    ("GRID", (0,0), (-1,-1), 0.5, colors.HexColor("#cbd5e1")),
    ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
    ("LEFTPADDING", (0,0), (-1,-1), 8),
    ("TOPPADDING", (0,0), (-1,-1), 6),
    ("BOTTOMPADDING", (0,0), (-1,-1), 6),
]))
story.append(meta)
story.append(PageBreak())

# ---------- ERD IMAGE ----------
story.append(Paragraph("1 · Entity Relationship Diagram", H1))
story.append(Paragraph(
    "The diagram below shows all entities and their relationships. "
    "Diamonds (◆) mark primary keys and open diamonds (◇) mark foreign keys. "
    "Every connector represents a one-to-many relationship (1 → ∞).", BODY))
story.append(Spacer(1, 4*mm))
iw, ih = ImageReader(ERD).getSize()
maxw = 170*mm
img = Image(ERD, width=maxw, height=maxw*ih/iw)
story.append(img)
story.append(PageBreak())

# ---------- SCHEMA REVIEW ----------
story.append(Paragraph("2 · Schema Review — Gaps Closed &amp; Fixes Applied", H1))
story.append(Paragraph(
    "A close re-read of the problem statement surfaced <b>functional gaps</b> (features the brief "
    "requires that the first draft could not represent) plus several <b>integrity</b> gaps. This "
    "revision closes both. The entity set grows from 14 to 17 tables "
    "(adds <b>documents</b>, <b>payment_methods</b>, <b>support_tickets</b>).", BODY))
story.append(Spacer(1, 3*mm))
review = [
    ("Gap / Issue", "Fix applied", "Type"),
    ("Drivers must upload &amp; verify a driving licence before publishing rides (KYC).",
     "NEW documents table (licence, ID, vehicle RC/insurance) with pending/verified/rejected + expiry + admin verifier.", "Feature"),
    ("Admin 'provides access' / revokes an employee — no way to represent it.",
     "users.status enum(invited/active/suspended) + revoked_at + revoked_by; checked on login & each request.", "Feature"),
    ("Reports need Fuel Consumption / Cost-per-km / Efficiency — no mileage stored.",
     "Added vehicles.mileage_kmpl; fuel used = distance ÷ mileage × org fuel price.", "Feature"),
    ("Wallet Recharge is a payment with no booking, but booking_id was NOT NULL.",
     "booking_id now nullable; added payments.type; partial-unique only for ride payments.", "Feature"),
    ("Trip lifecycle & reports need ACTUAL start/end times (only scheduled existed).",
     "Added rides.started_at / ended_at (nullable).", "Feature"),
    ("Settings screens 'Payment Methods' and 'Help & Support' had no storage.",
     "NEW payment_methods (tokenised display) and support_tickets tables.", "Feature"),
    ("Ride Cancellation (bonus) had no metadata.",
     "Added cancelled_at + cancel_reason to rides and bookings; restore seats on cancel.", "Feature"),
    ("A passenger could book the same ride twice.",
     "UNIQUE(ride_id, passenger_id) on bookings.", "Integrity"),
    ("available_seats could drift below 0 / above total_seats.",
     "CHECK (0 ≤ available_seats ≤ total_seats); decrement in a transaction.", "Integrity"),
    ("Proximity ride-matching would table-scan raw lat/lng.",
     "PostGIS geography + GiST index (or bounding-box + composite index).", "Integrity"),
    ("Money/rating integrity + audit trail.",
     "All money numeric(_,2), CHECK ≥ 0, stars 1–5; updated_at on mutable tables.", "Integrity"),
]
rdata = [[Paragraph(c, CELLB) for c in review[0]]]
for a, b, sev in review[1:]:
    rdata.append([Paragraph(a, CELL), Paragraph(b, CELL), Paragraph(sev, CELL)])
rtbl = Table(rdata, colWidths=[56*mm, 82*mm, 22*mm], repeatRows=1)
rtbl.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), BLUE),
    ("TEXTCOLOR", (0,0), (-1,0), WHITE),
    ("GRID", (0,0), (-1,-1), 0.4, colors.HexColor("#cbd5e1")),
    ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
    ("LEFTPADDING", (0,0), (-1,-1), 5),
    ("RIGHTPADDING", (0,0), (-1,-1), 5),
    ("TOPPADDING", (0,0), (-1,-1), 4),
    ("BOTTOMPADDING", (0,0), (-1,-1), 4),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [WHITE, LIGHT]),
]))
story.append(rtbl)
story.append(PageBreak())

# ---------- TABLE SPECS ----------
story.append(Paragraph("3 · Table Definitions", H1))
story.append(Paragraph(
    "Types use PostgreSQL notation. <b>PK</b> = primary key, <b>FK</b> = foreign key, "
    "<b>UQ</b> = unique, <b>NN</b> = not null.", SMALL))
story.append(Spacer(1, 3*mm))

# (table_name, description, [ (col, type, key, notes) ])
TABLES = [
 ("organizations", "A registered company / tenant. Every user and ride belongs to one org.", [
    ("id", "uuid", "PK", "Tenant identifier"),
    ("name", "varchar(150)", "NN", "Company name"),
    ("domain", "varchar(120)", "UQ", "Email domain used to verify employees"),
    ("address", "text", "", "Head-office address"),
    ("fuel_cost_per_litre", "numeric(8,2)", "", "Admin-set, feeds cost reports"),
    ("cost_per_km", "numeric(8,2)", "", "Admin-set travel cost baseline"),
    ("currency", "char(3)", "", "ISO code, e.g. INR"),
    ("created_at", "timestamptz", "NN", "default now()"),
 ]),
 ("users", "An employee. The same user can be a driver and a passenger.", [
    ("id", "uuid", "PK", ""),
    ("org_id", "uuid", "FK→organizations", "Tenant scope"),
    ("name", "varchar(120)", "NN", ""),
    ("email", "varchar(160)", "UQ, NN", "Login identifier"),
    ("phone", "varchar(20)", "", "For call feature"),
    ("password_hash", "text", "NN", "bcrypt/argon2"),
    ("role", "enum(user_role)", "NN", "'admin' | 'employee'"),
    ("status", "enum(user_status)", "NN", "invited | active | suspended (access control)"),
    ("photo_url", "text", "", "Profile picture"),
    ("revoked_at", "timestamptz", "", "Set when admin suspends access"),
    ("revoked_by", "uuid", "FK→users", "The admin who revoked; nullable"),
    ("created_at", "timestamptz", "NN", "default now()"),
    ("updated_at", "timestamptz", "NN", "auto-touch on update"),
 ]),
 ("vehicles", "Vehicles owned by an employee. Required before offering a ride.", [
    ("id", "uuid", "PK", ""),
    ("owner_id", "uuid", "FK→users", ""),
    ("model", "varchar(120)", "NN", "e.g. Honda City"),
    ("reg_number", "varchar(20)", "UQ, NN", "License plate"),
    ("seating_capacity", "smallint", "NN", "Total seats, CHECK > 0"),
    ("fuel_type", "enum(fuel_type)", "", "'petrol'|'diesel'|'ev'|'cng'"),
    ("mileage_kmpl", "numeric(5,2)", "", "Fuel efficiency (km/litre); CHECK > 0 — feeds fuel & cost reports"),
    ("color", "varchar(30)", "", ""),
    ("is_active", "boolean", "NN", "Soft-retire without deleting"),
    ("updated_at", "timestamptz", "NN", "auto-touch on update"),
 ]),
 ("saved_places", "Frequently used pickup/drop points (Home, Office, ...).", [
    ("id", "uuid", "PK", ""),
    ("user_id", "uuid", "FK→users", ""),
    ("label", "varchar(60)", "NN", "'Home', 'Office', custom"),
    ("address", "text", "NN", ""),
    ("lat", "numeric(9,6)", "NN", ""),
    ("lng", "numeric(9,6)", "NN", ""),
 ]),
 ("rides", "A ride offered by a driver. Passengers book seats against it.", [
    ("id", "uuid", "PK", ""),
    ("driver_id", "uuid", "FK→users", ""),
    ("vehicle_id", "uuid", "FK→vehicles", ""),
    ("parent_ride_id", "uuid", "FK→rides (self)", "Links recurring instances to a template; NULL for one-off"),
    ("origin", "text", "NN", "Pickup label"),
    ("origin_lat / origin_lng", "numeric(9,6)", "NN", "Start coordinates"),
    ("destination", "text", "NN", "Drop label"),
    ("dest_lat / dest_lng", "numeric(9,6)", "NN", "End coordinates"),
    ("departure_time", "timestamptz", "NN", "Scheduled start"),
    ("started_at", "timestamptz", "", "Actual trip start (driver taps Start)"),
    ("ended_at", "timestamptz", "", "Actual completion; gives real duration"),
    ("total_seats", "smallint", "NN", "Seats offered"),
    ("available_seats", "smallint", "NN", "CHECK 0 ≤ available_seats ≤ total_seats"),
    ("fare_per_seat", "numeric(8,2)", "NN", "CHECK ≥ 0"),
    ("distance_km", "numeric(8,2)", "", "From maps API, feeds reports"),
    ("route_polyline", "text", "", "Encoded route for map redraw"),
    ("is_recurring", "boolean", "NN", "default false"),
    ("recurrence_rule", "varchar(120)", "", "iCal RRULE / weekday mask"),
    ("status", "enum(ride_status)", "NN", "See lifecycle below"),
    ("cancelled_at", "timestamptz", "", "Set on cancellation"),
    ("cancel_reason", "varchar(200)", "", "Free-text reason"),
    ("created_at", "timestamptz", "NN", "default now()"),
    ("updated_at", "timestamptz", "NN", "auto-touch on update"),
 ]),
 ("bookings", "A passenger's reservation of one or more seats on a ride.", [
    ("id", "uuid", "PK", ""),
    ("ride_id", "uuid", "FK→rides", "UNIQUE(ride_id, passenger_id) — no double-booking"),
    ("passenger_id", "uuid", "FK→users", ""),
    ("seats", "smallint", "NN", "CHECK > 0"),
    ("pickup_lat / pickup_lng", "numeric(9,6)", "", "Passenger pickup"),
    ("drop_lat / drop_lng", "numeric(9,6)", "", "Passenger drop"),
    ("fare_amount", "numeric(10,2)", "NN", "seats × fare_per_seat"),
    ("status", "enum(booking_status)", "NN", "'booked'|'cancelled'|'completed'"),
    ("cancelled_at", "timestamptz", "", "Set on cancellation; restore seats"),
    ("cancel_reason", "varchar(200)", "", "Free-text reason"),
    ("booked_at", "timestamptz", "NN", "default now()"),
    ("updated_at", "timestamptz", "NN", "auto-touch on update"),
 ]),
 ("trip_locations", "Time-series GPS pings for live tracking while a trip is active.", [
    ("id", "bigserial", "PK", ""),
    ("ride_id", "uuid", "FK→rides", ""),
    ("lat", "numeric(9,6)", "NN", ""),
    ("lng", "numeric(9,6)", "NN", ""),
    ("eta", "integer", "", "Seconds to destination"),
    ("recorded_at", "timestamptz", "NN", "Ping timestamp"),
 ]),
 ("payments", "A payment: either a ride settlement OR a wallet top-up (Razorpay test / cash / wallet).", [
    ("id", "uuid", "PK", ""),
    ("booking_id", "uuid", "FK→bookings", "NULL for wallet recharge. Partial UNIQUE WHERE type='ride_payment'"),
    ("payer_id", "uuid", "FK→users", "Passenger (or wallet owner)"),
    ("payee_id", "uuid", "FK→users", "Driver; NULL for recharge"),
    ("type", "enum(payment_type)", "NN", "'ride_payment' | 'wallet_recharge'"),
    ("amount", "numeric(10,2)", "NN", "CHECK ≥ 0"),
    ("method", "enum(pay_method)", "NN", "'cash'|'card'|'upi'|'wallet'"),
    ("status", "enum(pay_status)", "NN", "'pending'|'success'|'failed'"),
    ("gateway_ref", "varchar(120)", "", "Razorpay payment id; nullable for cash"),
    ("created_at", "timestamptz", "NN", "default now()"),
 ]),
 ("documents", "Driver/vehicle KYC documents. A verified driving licence is required before publishing rides.", [
    ("id", "uuid", "PK", ""),
    ("user_id", "uuid", "FK→users", "Document owner (driver)"),
    ("vehicle_id", "uuid", "FK→vehicles", "Set for vehicle docs (RC/insurance); NULL for personal"),
    ("doc_type", "enum(doc_type)", "NN", "driving_license | id_proof | vehicle_rc | vehicle_insurance"),
    ("doc_number", "varchar(60)", "", "Licence / document number"),
    ("file_url", "text", "NN", "Uploaded scan/photo"),
    ("status", "enum(doc_status)", "NN", "pending | verified | rejected (default pending)"),
    ("expiry_date", "date", "", "Licence/insurance expiry; blocks if past"),
    ("verified_by", "uuid", "FK→users", "Admin who verified; nullable"),
    ("verified_at", "timestamptz", "", ""),
    ("rejection_reason", "varchar(200)", "", "Why rejected"),
    ("uploaded_at", "timestamptz", "NN", "default now()"),
 ]),
 ("payment_methods", "Saved payment instruments shown on the Settings → Payment Methods screen.", [
    ("id", "uuid", "PK", ""),
    ("user_id", "uuid", "FK→users", ""),
    ("type", "enum(pm_type)", "NN", "'card' | 'upi'"),
    ("label", "varchar(60)", "", "e.g. 'HDFC Credit'"),
    ("masked_detail", "varchar(40)", "", "Tokenised display only (e.g. **** 4242) — Razorpay holds real data"),
    ("is_default", "boolean", "NN", "default false"),
    ("created_at", "timestamptz", "NN", "default now()"),
 ]),
 ("support_tickets", "Help & Support requests raised from Settings.", [
    ("id", "uuid", "PK", ""),
    ("user_id", "uuid", "FK→users", ""),
    ("subject", "varchar(150)", "NN", ""),
    ("body", "text", "NN", ""),
    ("status", "enum(ticket_status)", "NN", "open | in_progress | closed"),
    ("created_at", "timestamptz", "NN", "default now()"),
    ("updated_at", "timestamptz", "NN", "auto-touch on update"),
 ]),
 ("wallets", "One prepaid wallet per user.", [
    ("id", "uuid", "PK", ""),
    ("user_id", "uuid", "FK→users, UQ", ""),
    ("balance", "numeric(12,2)", "NN", "default 0"),
    ("updated_at", "timestamptz", "NN", ""),
 ]),
 ("wallet_transactions", "Ledger of every wallet credit/debit.", [
    ("id", "bigserial", "PK", ""),
    ("wallet_id", "uuid", "FK→wallets", ""),
    ("type", "enum(wtxn_type)", "NN", "'recharge'|'debit'|'credit'"),
    ("amount", "numeric(12,2)", "NN", ""),
    ("balance_after", "numeric(12,2)", "NN", "Running balance"),
    ("ref_payment_id", "uuid", "FK→payments", "Nullable link"),
    ("created_at", "timestamptz", "NN", "default now()"),
 ]),
 ("messages", "In-trip chat between driver and passengers.", [
    ("id", "bigserial", "PK", ""),
    ("ride_id", "uuid", "FK→rides", ""),
    ("sender_id", "uuid", "FK→users", ""),
    ("receiver_id", "uuid", "FK→users", ""),
    ("body", "text", "NN", ""),
    ("sent_at", "timestamptz", "NN", "default now()"),
 ]),
 ("notifications", "Push / in-app notifications (bonus feature).", [
    ("id", "bigserial", "PK", ""),
    ("user_id", "uuid", "FK→users", ""),
    ("type", "varchar(50)", "NN", "'booking'|'trip'|'payment'..."),
    ("title", "varchar(150)", "NN", ""),
    ("body", "text", "", ""),
    ("is_read", "boolean", "NN", "default false"),
    ("created_at", "timestamptz", "NN", "default now()"),
 ]),
 ("ratings", "Optional post-trip rating between participants.", [
    ("id", "uuid", "PK", ""),
    ("ride_id", "uuid", "FK→rides", ""),
    ("rater_id", "uuid", "FK→users", ""),
    ("ratee_id", "uuid", "FK→users", ""),
    ("stars", "smallint", "NN", "1–5"),
    ("comment", "text", "", ""),
 ]),
]

def col_key_color(key):
    if key.startswith("PK"): return AMBER
    if key.startswith("FK"): return TEAL
    return SLATE

for name, desc, cols in TABLES:
    story.append(Paragraph(name, H2))
    story.append(Paragraph(desc, SMALL))
    story.append(Spacer(1, 1.5*mm))
    data = [[Paragraph("Column", CELLB), Paragraph("Type", CELLB),
             Paragraph("Key / Constraint", CELLB), Paragraph("Notes", CELLB)]]
    for c, t, k, n in cols:
        data.append([Paragraph(c, CELL), Paragraph(t, CELL),
                     Paragraph(k, CELL), Paragraph(n, CELL)])
    tbl = Table(data, colWidths=[42*mm, 34*mm, 42*mm, 52*mm], repeatRows=1)
    style = [
        ("BACKGROUND", (0,0), (-1,0), BLUE),
        ("TEXTCOLOR", (0,0), (-1,0), WHITE),
        ("GRID", (0,0), (-1,-1), 0.4, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("LEFTPADDING", (0,0), (-1,-1), 5),
        ("RIGHTPADDING", (0,0), (-1,-1), 5),
        ("TOPPADDING", (0,0), (-1,-1), 3),
        ("BOTTOMPADDING", (0,0), (-1,-1), 3),
    ]
    for r in range(1, len(data)):
        if r % 2 == 0:
            style.append(("BACKGROUND", (0,r), (-1,r), LIGHT))
    tbl.setStyle(TableStyle(style))
    story.append(tbl)
    story.append(Spacer(1, 4*mm))

story.append(PageBreak())

# ---------- ENUMS ----------
story.append(Paragraph("4 · Enumerations &amp; Lifecycle", H1))
story.append(Paragraph(
    "The trip lifecycle from the problem statement maps to two coordinated status "
    "fields: <b>rides.status</b> (the journey) and <b>payments.status</b> / "
    "<b>bookings.status</b> (settlement).", BODY))
story.append(Spacer(1, 3*mm))

enums = [
    ("ride_status", "scheduled → started → in_progress → completed  (or cancelled)"),
    ("booking_status", "booked · cancelled · completed"),
    ("pay_status", "pending · success · failed"),
    ("pay_method", "cash · card · upi · wallet"),
    ("payment_type", "ride_payment · wallet_recharge"),
    ("user_role", "admin · employee"),
    ("user_status", "invited · active · suspended"),
    ("doc_type", "driving_license · id_proof · vehicle_rc · vehicle_insurance"),
    ("doc_status", "pending · verified · rejected"),
    ("pm_type", "card · upi"),
    ("ticket_status", "open · in_progress · closed"),
    ("fuel_type", "petrol · diesel · ev · cng"),
    ("wtxn_type", "recharge · debit · credit"),
]
edata = [[Paragraph("Enum", CELLB), Paragraph("Allowed values", CELLB)]]
for e, v in enums:
    edata.append([Paragraph(e, CELL), Paragraph(v, CELL)])
etbl = Table(edata, colWidths=[45*mm, 125*mm])
etbl.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), BLUE),
    ("TEXTCOLOR", (0,0), (-1,0), WHITE),
    ("GRID", (0,0), (-1,-1), 0.4, colors.HexColor("#cbd5e1")),
    ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
    ("LEFTPADDING", (0,0), (-1,-1), 6),
    ("TOPPADDING", (0,0), (-1,-1), 4),
    ("BOTTOMPADDING", (0,0), (-1,-1), 4),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [WHITE, LIGHT]),
]))
story.append(etbl)
story.append(Spacer(1, 5*mm))

story.append(Paragraph("Key business rules enforced by the schema", H2))
rules = [
    "Multi-tenant: users.org_id scopes every query; ride matching only joins users of the same org.",
    "Access control: only users with status='active' can log in / call the API; login and every request re-check status.",
    "Publishing a ride requires (a) status='active', (b) a verified, non-expired driving_license in documents, and (c) at least one is_active vehicle.",
    "available_seats is decremented on booking (in a transaction) and restored on cancellation.",
    "trip_locations rows are only written while rides.status = 'started'/'in_progress'.",
    "One ride payment per booking (partial unique); wallet recharge is a payment with type='wallet_recharge' + a wallet_transactions credit.",
    "Reports: fuel used = distance_km ÷ vehicles.mileage_kmpl; cost = fuel_used × organizations.fuel_cost_per_litre; actual distance/duration come from rides.started_at/ended_at.",
]
for r in rules:
    story.append(Paragraph("• " + r, BODY))
story.append(Spacer(1, 4*mm))

story.append(Paragraph("Recommended indexes", H2))
idx = [
    ("users(email)", "UNIQUE — login lookup"),
    ("users(org_id, status)", "Tenant scope + admin participation/access monitoring"),
    ("documents(user_id, doc_type, status)", "Licence-verified check before publishing"),
    ("payment_methods(user_id)", "Settings → Payment Methods list"),
    ("rides(status, departure_time)", "Find-a-ride search filter"),
    ("rides(origin_lat, origin_lng) / GiST(geog)", "Proximity matching (PostGIS)"),
    ("bookings(passenger_id)", "My Trips (passenger view)"),
    ("bookings(ride_id)", "Driver's passenger list"),
    ("trip_locations(ride_id, recorded_at)", "Live-tracking replay / latest ping"),
    ("payments(booking_id)", "UNIQUE — one payment per booking"),
    ("wallet_transactions(wallet_id, created_at)", "Wallet statement"),
]
idata = [[Paragraph("Index", CELLB), Paragraph("Purpose", CELLB)]]
for a, b in idx:
    idata.append([Paragraph(a, CELL), Paragraph(b, CELL)])
itbl = Table(idata, colWidths=[80*mm, 90*mm])
itbl.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), BLUE),
    ("TEXTCOLOR", (0,0), (-1,0), WHITE),
    ("GRID", (0,0), (-1,-1), 0.4, colors.HexColor("#cbd5e1")),
    ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
    ("LEFTPADDING", (0,0), (-1,-1), 6),
    ("TOPPADDING", (0,0), (-1,-1), 3),
    ("BOTTOMPADDING", (0,0), (-1,-1), 3),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [WHITE, LIGHT]),
]))
story.append(itbl)
story.append(PageBreak())

# ---------- TECH STACK ----------
story.append(Paragraph("5 · Recommended Technology Stack", H1))
story.append(Paragraph(
    "Confirmed direction: <b>Python backend, React frontend.</b> This stack is optimised "
    "for a hackathon — fast to build, strong real-time support, runs fully on localhost, and "
    "every third-party service has a free or sandbox tier.", BODY))
story.append(Spacer(1, 3*mm))

stack = [
 ("Layer", "Recommended", "Why"),
 ("Frontend", "React + Vite + TypeScript, Tailwind CSS",
  "Fast dev server; quick to build forms, dashboards and the map screens."),
 ("Map render", "React-Leaflet + OpenStreetMap tiles",
  "Free, no API key locally; draws route, pickup/drop markers, live vehicle."),
 ("Charts", "Recharts (or Chart.js)",
  "Reports dashboard: trips, distance, fuel, cost/km."),
 ("Backend", "Python + FastAPI",
  "Async, native WebSockets, auto OpenAPI docs — ideal for REST + real-time."),
 ("ORM / migrations", "SQLAlchemy 2.0 + Alembic (or SQLModel)",
  "Typed models matching this schema; versioned migrations."),
 ("Validation", "Pydantic v2",
  "Request/response schemas, tight with FastAPI."),
 ("Real-time", "FastAPI WebSockets (or python-socketio) + Redis pub/sub",
  "Live location pings + chat; Redis fans out across workers."),
 ("Database", "PostgreSQL 15 (+ PostGIS for matching)",
  "Relational fit; PostGIS makes proximity ride-matching fast."),
 ("Auth", "JWT access/refresh (python-jose) + passlib[bcrypt]",
  "Stateless; role guard for admin vs employee."),
 ("Payments", "Razorpay Test Mode (razorpay Python SDK)",
  "Orders API + Checkout + webhook; sandbox, no real money."),
 ("Background jobs", "FastAPI BackgroundTasks / Celery (optional)",
  "Recurring-ride generation, notification fan-out."),
 ("Dev / run", "Docker Compose (Postgres + Redis) + uvicorn",
  "One command locally; no cloud hosting required."),
]
sdata = [[Paragraph(c, CELLB) for c in stack[0]]]
for row in stack[1:]:
    sdata.append([Paragraph(row[0], CELLB), Paragraph(row[1], CELL), Paragraph(row[2], CELL)])
stbl = Table(sdata, colWidths=[30*mm, 58*mm, 82*mm], repeatRows=1)
stbl.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), NAVY),
    ("TEXTCOLOR", (0,0), (-1,0), WHITE),
    ("GRID", (0,0), (-1,-1), 0.4, colors.HexColor("#cbd5e1")),
    ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
    ("LEFTPADDING", (0,0), (-1,-1), 5),
    ("RIGHTPADDING", (0,0), (-1,-1), 5),
    ("TOPPADDING", (0,0), (-1,-1), 4),
    ("BOTTOMPADDING", (0,0), (-1,-1), 4),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [WHITE, LIGHT]),
]))
story.append(stbl)
story.append(Spacer(1, 4*mm))
story.append(Paragraph(
    "<b>Django alternative:</b> Django REST Framework + Channels + Django ORM is equally valid — "
    "and its built-in admin panel can double as the Company Administrator console, saving UI time. "
    "Trade-off: Channels real-time setup is heavier than FastAPI's native WebSockets.", SMALL))
story.append(PageBreak())

# ---------- API RESEARCH ----------
story.append(Paragraph("6 · External APIs &amp; Services per Feature", H1))
story.append(Paragraph(
    "Researched options per feature with a recommendation. Bias: free / sandbox tiers, "
    "works on localhost, India-friendly (the brief mandates Razorpay / INR). "
    "You confirm before we lock these in.", BODY))
story.append(Spacer(1, 3*mm))

apis = [
 ("Feature", "Options", "Recommended (free / sandbox)"),
 ("Map display",
  "OpenStreetMap tiles · Mapbox · Google Maps",
  "OSM tiles via React-Leaflet — no key, free."),
 ("Address search / autocomplete",
  "OSM Nominatim · Photon · Google Places · LocationIQ · Mappls (India)",
  "Photon or LocationIQ (free tier, autocomplete). Google Places if budget allows."),
 ("Geocoding (address ↔ lat/lng)",
  "Nominatim · LocationIQ · OpenCage · Google Geocoding",
  "Nominatim (self-host/demo) or LocationIQ free tier."),
 ("Routing / distance / ETA",
  "OSRM · OpenRouteService · GraphHopper · Mapbox Directions · Google Directions",
  "OSRM (self-host, unlimited, no key) or OpenRouteService free tier."),
 ("Route confirmation polyline",
  "Same routing engine returns encoded polyline",
  "OSRM /route → geometry; draw with Leaflet."),
 ("Live trip tracking",
  "Browser Geolocation API → your WebSocket · third-party fleet APIs",
  "Browser Geolocation + FastAPI WebSocket — no external cost."),
 ("Ride matching",
  "In-DB PostGIS query · custom scoring",
  "PostGIS ST_DWithin on origin/dest + time window; internal."),
 ("Payments (card/UPI/wallet-recharge)",
  "Razorpay · Stripe · Cashfree · PayU",
  "Razorpay Test Mode — mandated by the brief."),
 ("In-app chat",
  "Your WebSocket · Firebase · Stream · Sendbird",
  "FastAPI WebSocket + messages table — no external cost."),
 ("Voice call",
  "Twilio · Agora · Exotel (India) · plain tel: dial · WebRTC",
  "Demo: tel: deep-link to stored phone (free). Real masked calling: Exotel (IN) or Twilio."),
 ("Push notifications (bonus)",
  "Firebase Cloud Messaging · WebSocket in-app · OneSignal",
  "In-app via WebSocket; FCM (free) if you want true mobile push."),
 ("Email (verify / receipts)",
  "SMTP · SendGrid · Resend · Mailtrap (test)",
  "Mailtrap sandbox for dev; SendGrid/Resend free tier for real."),
 ("Image upload (profile / vehicle)",
  "Local disk · Cloudinary · AWS S3 · Supabase Storage",
  "Local disk for demo; Cloudinary free tier if hosted."),
]
adata = [[Paragraph(c, CELLB) for c in apis[0]]]
for row in apis[1:]:
    adata.append([Paragraph(row[0], CELLB), Paragraph(row[1], CELL), Paragraph(row[2], CELL)])
atbl = Table(adata, colWidths=[38*mm, 66*mm, 66*mm], repeatRows=1)
atbl.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), TEAL),
    ("TEXTCOLOR", (0,0), (-1,0), WHITE),
    ("GRID", (0,0), (-1,-1), 0.4, colors.HexColor("#cbd5e1")),
    ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
    ("LEFTPADDING", (0,0), (-1,-1), 5),
    ("RIGHTPADDING", (0,0), (-1,-1), 5),
    ("TOPPADDING", (0,0), (-1,-1), 4),
    ("BOTTOMPADDING", (0,0), (-1,-1), 4),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [WHITE, LIGHT]),
]))
story.append(atbl)
story.append(Spacer(1, 4*mm))
story.append(Paragraph(
    "<b>The one paid decision:</b> Voice Call. Everything else is free/sandbox and localhost-friendly. "
    "For the demo, a tel: dial link costs nothing; only invest in Exotel/Twilio masked calling if "
    "hiding phone numbers is a scoring criterion.", SMALL))
story.append(Spacer(1, 4*mm))

story.append(Paragraph("Suggested build order for the hackathon", H2))
order = [
    "Auth + org/user seed data (login, signup, roles, status).",
    "Document upload at signup + admin verification console (licence → verified).",
    "Vehicle management (incl. mileage) + saved places.",
    "Offer a ride → gate on verified licence + active vehicle → route confirmation (Leaflet + OSRM) → publish.",
    "Find a ride → PostGIS matching query → booking (seat decrement in a txn).",
    "My Trips + trip lifecycle state machine (scheduled→started→in_progress→completed).",
    "Live tracking via WebSocket + chat.",
    "Payments (Razorpay test) + wallet ledger + recharge.",
    "Reports dashboard (trips, distance, fuel, cost/km) + bonus features.",
]
for i, o in enumerate(order, 1):
    story.append(Paragraph(f"{i}. {o}", BODY))

doc = SimpleDocTemplate(OUT, pagesize=A4,
                        leftMargin=20*mm, rightMargin=20*mm,
                        topMargin=18*mm, bottomMargin=16*mm,
                        title="Enterprise Carpooling Platform — Schema & Tech Design")
doc.build(story)
print("saved", OUT)
