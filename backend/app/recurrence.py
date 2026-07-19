"""Weekly ride recurrence.

A recurring ride is expressed as a small subset of the iCal RRULE grammar so
the value stored in ``rides.recurrence_rule`` is a recognisable standard:

    FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=2026-08-15

Supported today:
  * ``FREQ=WEEKLY``            — the only frequency (pick all 7 days for "daily").
  * ``BYDAY=<two-letter,…>``   — which weekdays repeat (SU MO TU WE TH FR SA).
  * ``UNTIL=YYYY-MM-DD``       — inclusive end date of the series.

``generate_occurrences`` turns a base departure + rule into the concrete list of
departure datetimes to materialise. The base departure is always the first
occurrence (the "parent" ride); subsequent occurrences fall on the selected
weekdays, at the same time of day, up to and including ``UNTIL``.
"""
from __future__ import annotations

from datetime import datetime, timedelta, date as date_cls

# iCal weekday code -> Python date.weekday() index (Mon=0 … Sun=6).
WEEKDAY_CODES: dict[str, int] = {
    "MO": 0,
    "TU": 1,
    "WE": 2,
    "TH": 3,
    "FR": 4,
    "SA": 5,
    "SU": 6,
}

# Hard ceiling so a malformed / abusive rule can never spawn thousands of rows.
MAX_OCCURRENCES = 60


class RecurrenceError(ValueError):
    """Raised when a recurrence rule is missing/invalid (maps to HTTP 400)."""


def _parse_rule(rule: str) -> tuple[list[int], date_cls]:
    """Parse a weekly RRULE into (sorted weekday indices, until date)."""
    parts: dict[str, str] = {}
    for token in (rule or "").split(";"):
        token = token.strip()
        if not token:
            continue
        if "=" not in token:
            raise RecurrenceError("Malformed recurrence rule")
        key, value = token.split("=", 1)
        parts[key.strip().upper()] = value.strip()

    if parts.get("FREQ", "").upper() != "WEEKLY":
        raise RecurrenceError("Only weekly recurrence is supported")

    codes = [c.strip().upper() for c in parts.get("BYDAY", "").split(",") if c.strip()]
    if not codes:
        raise RecurrenceError("Select at least one weekday to repeat on")
    try:
        weekday_idx = sorted({WEEKDAY_CODES[c] for c in codes})
    except KeyError:
        raise RecurrenceError("Invalid weekday in recurrence rule")

    until_raw = parts.get("UNTIL")
    if not until_raw:
        raise RecurrenceError("Recurrence needs an end date")
    try:
        until = date_cls.fromisoformat(until_raw[:10])
    except ValueError:
        raise RecurrenceError("Invalid recurrence end date")

    return weekday_idx, until


def generate_occurrences(start: datetime, rule: str) -> list[datetime]:
    """Expand ``rule`` into departure datetimes, starting from ``start``.

    ``start`` is always the first item (the parent ride). Children follow on the
    selected weekdays at the same time of day, through the ``UNTIL`` date, capped
    at :data:`MAX_OCCURRENCES` for safety.
    """
    weekday_idx, until = _parse_rule(rule)

    occurrences: list[datetime] = [start]
    cursor = start.date() + timedelta(days=1)
    while cursor <= until and len(occurrences) < MAX_OCCURRENCES:
        if cursor.weekday() in weekday_idx:
            # Preserve the exact time-of-day (and tzinfo) of the base departure.
            occurrences.append(datetime.combine(cursor, start.timetz()))
        cursor += timedelta(days=1)

    return occurrences
