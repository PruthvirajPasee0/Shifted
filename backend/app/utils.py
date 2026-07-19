import math
from decimal import Decimal


EARTH_RADIUS_KM = 6371.0088


def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in km between two lat/lng points."""
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    )
    c = 2 * math.asin(min(1.0, math.sqrt(a)))
    return EARTH_RADIUS_KM * c


def bbox_deg(lat: float, radius_km: float) -> tuple[float, float]:
    """Return (lat_delta, lng_delta) in degrees for a bounding box of `radius_km`.

    Used as a cheap pre-filter before running the (more expensive) haversine.
    """
    lat_delta = radius_km / 110.574
    # Guard against division by zero at the poles.
    cos_lat = max(math.cos(math.radians(lat)), 1e-6)
    lng_delta = radius_km / (111.320 * cos_lat)
    return lat_delta, lng_delta


def match_score(origin_dist_km: float, dest_dist_km: float, radius_km: float) -> float:
    """Simple 0..100 score: closer pickup + drop => higher score."""
    max_total = radius_km * 2
    combined = origin_dist_km + dest_dist_km
    score = max(0.0, (max_total - combined) / max_total) * 100
    return round(score, 2)


def point_to_segment_km(
    plat: float, plng: float, alat: float, alng: float, blat: float, blng: float
) -> float:
    """Approx distance (km) from point P to segment AB using local equirectangular projection."""
    # metres-ish local plane around A
    lat0 = math.radians(alat)
    ax, ay = 0.0, 0.0
    bx = (blng - alng) * math.cos(lat0) * 111.320
    by = (blat - alat) * 110.574
    px = (plng - alng) * math.cos(lat0) * 111.320
    py = (plat - alat) * 110.574
    ab2 = bx * bx + by * by
    if ab2 < 1e-9:
        return haversine(plat, plng, alat, alng)
    t = max(0.0, min(1.0, (px * bx + py * by) / ab2))
    cx, cy = ax + t * bx, ay + t * by
    return math.hypot(px - cx, py - cy)


def along_corridor(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    ride_o_lat: float,
    ride_o_lng: float,
    ride_d_lat: float,
    ride_d_lng: float,
    corridor_km: float,
) -> bool:
    """True if passenger OD both lie within corridor_km of the ride OD segment."""
    o_ok = point_to_segment_km(
        origin_lat, origin_lng, ride_o_lat, ride_o_lng, ride_d_lat, ride_d_lng
    ) <= corridor_km
    d_ok = point_to_segment_km(
        dest_lat, dest_lng, ride_o_lat, ride_o_lng, ride_d_lat, ride_d_lng
    ) <= corridor_km
    return o_ok and d_ok


def fuel_litres(distance_km, mileage_kmpl) -> Decimal:
    """Litres consumed for a distance given fuel efficiency (km per litre)."""
    d = Decimal(str(distance_km or 0))
    m = Decimal(str(mileage_kmpl or 0))
    if m <= 0:
        return Decimal("0")
    return (d / m).quantize(Decimal("0.01"))


def trip_cost(distance_km, mileage_kmpl, fuel_cost_per_litre) -> Decimal:
    """Fuel cost of a trip = litres * cost per litre."""
    litres = fuel_litres(distance_km, mileage_kmpl)
    cost = Decimal(str(fuel_cost_per_litre or 0))
    return (litres * cost).quantize(Decimal("0.01"))
