"""Generate the Enterprise Carpooling Platform ER diagram as a PNG."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

# ---- Theme ----
BG        = "#0f172a"
CARD      = "#1e293b"
HEADER    = "#2563eb"
HEADER_TX = "#ffffff"
FIELD_TX  = "#e2e8f0"
PK_TX     = "#fbbf24"
FK_TX     = "#5eead4"
LINE      = "#64748b"
TITLE_TX  = "#f8fafc"

ROW_H  = 2.05
HEAD_H = 3.0

E = {}

def add(key, x, y, w, title, fields):
    E[key] = dict(x=x, y=y, w=w, title=title, fields=fields)

# ---------------- Column A (x=2): org + user-satellites + wallet ----------------
add("org", 2, 116, 33, "organizations", [
    ("id", "pk"), ("name", ""), ("domain  UQ", ""), ("address", ""),
    ("fuel_cost_per_litre", ""), ("cost_per_km", ""), ("currency", ""),
    ("created_at", "")])

add("notif", 2, 91, 33, "notifications", [
    ("id", "pk"), ("user_id", "fk"), ("type", ""), ("title", ""),
    ("body", ""), ("is_read", ""), ("created_at", "")])

add("ticket", 2, 65, 33, "support_tickets", [
    ("id", "pk"), ("user_id", "fk"), ("subject", ""), ("body", ""),
    ("status", ""), ("created_at", ""), ("updated_at", "")])

add("wallet", 2, 40, 33, "wallets", [
    ("id", "pk"), ("user_id  UQ", "fk"), ("balance", ""), ("updated_at", "")])

add("wtxn", 2, 24, 33, "wallet_transactions", [
    ("id", "pk"), ("wallet_id", "fk"), ("type", ""), ("amount", ""),
    ("balance_after", ""), ("ref_payment_id", "fk"), ("created_at", "")])

# ---------------- Column B (x=44): users (hub) ----------------
add("user", 44, 116, 35, "users", [
    ("id", "pk"), ("org_id", "fk"), ("name", ""), ("email  UQ", ""),
    ("phone", ""), ("password_hash", ""), ("role", ""), ("status", ""),
    ("photo_url", ""), ("revoked_at", ""), ("revoked_by", "fk"),
    ("created_at", ""), ("updated_at", "")])

# ---------------- Column C (x=86): vehicles, documents, saved_places, payment_methods
add("vehicle", 86, 116, 35, "vehicles", [
    ("id", "pk"), ("owner_id", "fk"), ("model", ""), ("reg_number  UQ", ""),
    ("seating_capacity", ""), ("fuel_type", ""), ("mileage_kmpl", ""),
    ("color", ""), ("is_active", ""), ("updated_at", "")])

add("doc", 86, 88, 35, "documents", [
    ("id", "pk"), ("user_id", "fk"), ("vehicle_id", "fk"), ("doc_type", ""),
    ("doc_number", ""), ("file_url", ""), ("status", ""), ("expiry_date", ""),
    ("verified_by", "fk"), ("verified_at", ""), ("rejection_reason", ""),
    ("uploaded_at", "")])

add("place", 86, 58, 35, "saved_places", [
    ("id", "pk"), ("user_id", "fk"), ("label", ""), ("address", ""),
    ("lat", ""), ("lng", "")])

add("pm", 86, 40, 35, "payment_methods", [
    ("id", "pk"), ("user_id", "fk"), ("type", ""), ("label", ""),
    ("masked_detail", ""), ("is_default", ""), ("created_at", "")])

# ---------------- Column D (x=130): rides ----------------
add("ride", 130, 116, 37, "rides", [
    ("id", "pk"), ("driver_id", "fk"), ("vehicle_id", "fk"),
    ("parent_ride_id", "fk"), ("origin_lat/lng", ""), ("dest_lat/lng", ""),
    ("origin / destination", ""), ("departure_time", ""),
    ("started_at / ended_at", ""), ("total_seats", ""),
    ("available_seats", ""), ("fare_per_seat", ""), ("distance_km", ""),
    ("route_polyline", ""), ("is_recurring", ""), ("recurrence_rule", ""),
    ("status", ""), ("cancelled_at / reason", ""),
    ("created_at / updated_at", "")])

# ---------------- Column E (x=176): bookings, payments, trip_locations, messages
add("booking", 176, 116, 34, "bookings", [
    ("id", "pk"), ("ride_id", "fk"), ("passenger_id", "fk"), ("seats", ""),
    ("pickup_lat/lng", ""), ("drop_lat/lng", ""), ("fare_amount", ""),
    ("status", ""), ("cancelled_at / reason", ""),
    ("booked_at / updated_at", "")])

add("payment", 176, 84, 34, "payments", [
    ("id", "pk"), ("booking_id  (nullable)", "fk"), ("payer_id", "fk"),
    ("payee_id", "fk"), ("type", ""), ("amount", ""), ("method", ""),
    ("status", ""), ("gateway_ref", ""), ("created_at", "")])

add("triploc", 176, 52, 34, "trip_locations", [
    ("id", "pk"), ("ride_id", "fk"), ("lat", ""), ("lng", ""),
    ("eta", ""), ("recorded_at", "")])

add("msg", 176, 30, 34, "messages", [
    ("id", "pk"), ("ride_id", "fk"), ("sender_id", "fk"),
    ("receiver_id", "fk"), ("body", ""), ("sent_at", "")])

# ---------------- Column F (x=214): ratings ----------------
add("rating", 214, 100, 33, "ratings", [
    ("id", "pk"), ("ride_id", "fk"), ("rater_id", "fk"),
    ("ratee_id", "fk"), ("stars", ""), ("comment", "")])

# relationships: (parent, child, parent_side, child_side)
REL = [
    ("org", "user", "R", "L"),
    ("user", "notif", "L", "R"),
    ("user", "ticket", "L", "R"),
    ("user", "wallet", "L", "R"),
    ("wallet", "wtxn", "B", "T"),
    ("user", "vehicle", "R", "L"),
    ("user", "doc", "R", "L"),
    ("vehicle", "doc", "B", "T"),
    ("user", "place", "R", "L"),
    ("user", "pm", "R", "L"),
    ("user", "ride", "R", "L"),
    ("vehicle", "ride", "R", "L"),
    ("user", "booking", "R", "L"),
    ("ride", "booking", "R", "L"),
    ("booking", "payment", "B", "T"),
    ("ride", "triploc", "R", "L"),
    ("ride", "msg", "R", "L"),
    ("ride", "rating", "R", "L"),
]

def height(e):
    return HEAD_H + ROW_H * len(e["fields"])

def anchor(e, side):
    h = height(e)
    if side == "L":
        return (e["x"], e["y"] - h / 2)
    if side == "R":
        return (e["x"] + e["w"], e["y"] - h / 2)
    if side == "T":
        return (e["x"] + e["w"] / 2, e["y"])
    if side == "B":
        return (e["x"] + e["w"] / 2, e["y"] - h)

fig, ax = plt.subplots(figsize=(26, 15))
fig.patch.set_facecolor(BG)
ax.set_facecolor(BG)
ax.set_xlim(0, 250)
ax.set_ylim(0, 124)
ax.axis("off")

ax.text(2, 122.4, "Enterprise Carpooling Platform — Database Schema (ERD)",
        color=TITLE_TX, fontsize=24, fontweight="bold", va="bottom")
ax.text(2, 120.2, "◆ = primary key   ◇ = foreign key   •  lines show 1 → ∞ (one-to-many)   •  17 tables",
        color="#94a3b8", fontsize=11, va="bottom")

# relationships behind cards
for p, c, ps, cs in REL:
    x1, y1 = anchor(E[p], ps)
    x2, y2 = anchor(E[c], cs)
    rad = 0.14 if (x2 >= x1) else -0.14
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2),
                 connectionstyle=f"arc3,rad={rad}", arrowstyle="-",
                 color=LINE, lw=1.5, alpha=0.9, zorder=1))
    ax.text(x1, y1, "1", color=PK_TX, fontsize=9, fontweight="bold",
            ha="center", va="center", zorder=5,
            bbox=dict(boxstyle="circle,pad=0.15", fc=BG, ec=LINE, lw=0.8))
    ax.text(x2, y2, "∞", color=FK_TX, fontsize=10, fontweight="bold",
            ha="center", va="center", zorder=5,
            bbox=dict(boxstyle="circle,pad=0.12", fc=BG, ec=LINE, lw=0.8))

# cards
for key, e in E.items():
    h = height(e)
    x, ytop, w = e["x"], e["y"], e["w"]
    ax.add_patch(FancyBboxPatch((x, ytop - h), w, h,
                 boxstyle="round,pad=0,rounding_size=0.8",
                 fc=CARD, ec="#334155", lw=1.2, zorder=2))
    ax.add_patch(FancyBboxPatch((x, ytop - HEAD_H), w, HEAD_H,
                 boxstyle="round,pad=0,rounding_size=0.8",
                 fc=HEADER, ec=HEADER, lw=1.0, zorder=3))
    ax.text(x + w / 2, ytop - HEAD_H / 2, e["title"],
            color=HEADER_TX, fontsize=12, fontweight="bold",
            ha="center", va="center", zorder=4)
    for i, (f, kind) in enumerate(e["fields"]):
        fy = ytop - HEAD_H - ROW_H * (i + 0.5)
        if kind == "pk":
            col, label = PK_TX, f"◆ {f}   PK"
        elif kind == "fk":
            col, label = FK_TX, f"◇ {f}   FK"
        else:
            col, label = FIELD_TX, f"• {f}"
        ax.text(x + 1.6, fy, label, color=col, fontsize=9.4,
                ha="left", va="center", zorder=4)

plt.tight_layout(pad=0.6)
out = r"C:\Users\pulse\OneDrive\Documents\Odoo_hackathon\carpool_schema_erd.png"
plt.savefig(out, dpi=150, facecolor=BG, bbox_inches="tight")
print("saved", out)
