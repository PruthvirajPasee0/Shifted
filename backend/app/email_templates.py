"""Branded transactional email templates.

Email clients are hostile to modern CSS, so everything here is a table-based
layout with inline styles and web-safe fonts. Palette mirrors the app's
"Twilight Transit" system: indigo brand, emerald accent, deep-navy ink.

Each builder returns a dict: {"subject", "html", "text"}.
"""
from __future__ import annotations

from .config import settings

BRAND = "#4f46e5"
BRAND_DARK = "#4338ca"
ACCENT = "#0d9488"
INK = "#141a30"
PAPER = "#f4f6fb"
MUTED = "#6a7291"
LINE = "#e5e9f3"
DANGER = "#dc2626"
SUCCESS = "#0d9488"

FONT = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace"


def _button(label: str, url: str) -> str:
    return f"""
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
      <tr>
        <td align="center" bgcolor="{BRAND}" style="border-radius:10px;">
          <a href="{url}" target="_blank"
             style="display:inline-block;padding:13px 30px;font-family:{FONT};
                    font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;
                    border-radius:10px;background:{BRAND};">
            {label}
          </a>
        </td>
      </tr>
    </table>
    """


def _render(
    *,
    preheader: str,
    eyebrow: str,
    heading: str,
    body_html: str,
    accent: str = BRAND,
) -> str:
    """Wrap content in the shared branded shell."""
    return f"""<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:{PAPER};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">{preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{PAPER};padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="max-width:600px;width:100%;background:#ffffff;border:1px solid {LINE};border-radius:16px;overflow:hidden;">
          <!-- header -->
          <tr>
            <td style="background:{INK};padding:26px 32px;">
              <span style="font-family:{MONO};font-size:20px;font-weight:700;letter-spacing:1px;color:#ffffff;">
                Shifted
              </span>
              <span style="font-family:{MONO};font-size:11px;color:rgba(255,255,255,0.45);margin-left:10px;letter-spacing:1px;">
                CARPOOL/OS
              </span>
            </td>
          </tr>
          <!-- accent bar -->
          <tr><td style="height:4px;background:{accent};font-size:0;line-height:0;">&nbsp;</td></tr>
          <!-- body -->
          <tr>
            <td style="padding:36px 32px 8px;">
              <div style="font-family:{MONO};font-size:11px;font-weight:600;letter-spacing:2px;
                          text-transform:uppercase;color:{accent};margin-bottom:12px;">{eyebrow}</div>
              <h1 style="margin:0 0 18px;font-family:{FONT};font-size:23px;line-height:1.25;
                         font-weight:700;color:{INK};">{heading}</h1>
              <div style="font-family:{FONT};font-size:15px;line-height:1.65;color:#3a4160;">
                {body_html}
              </div>
            </td>
          </tr>
          <!-- footer -->
          <tr>
            <td style="padding:24px 32px 30px;border-top:1px solid {LINE};">
              <p style="margin:0;font-family:{FONT};font-size:12px;line-height:1.6;color:{MUTED};">
                You're receiving this because you have a Shifted account.<br>
                Ride together, save together — smarter commuting for your organisation.
              </p>
            </td>
          </tr>
        </table>
        <p style="font-family:{MONO};font-size:10px;color:#9aa1bd;margin:16px 0 0;letter-spacing:1px;">
          SHIFTED · ENTERPRISE CARPOOLING
        </p>
      </td></tr>
    </table>
  </body>
</html>"""


def _fact_row(label: str, value: str) -> str:
    return f"""
      <tr>
        <td style="padding:7px 0;font-family:{MONO};font-size:11px;letter-spacing:1px;
                   text-transform:uppercase;color:{MUTED};width:120px;vertical-align:top;">{label}</td>
        <td style="padding:7px 0;font-family:{FONT};font-size:14px;color:{INK};font-weight:600;">{value}</td>
      </tr>"""


def _facts(rows: list[tuple[str, str]]) -> str:
    body = "".join(_fact_row(k, v) for k, v in rows)
    return f"""
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="margin:18px 0;background:{PAPER};border:1px solid {LINE};border-radius:12px;padding:6px 18px;">
      {body}
    </table>"""


# ---------------------------------------------------------------------------
# Specific templates
# ---------------------------------------------------------------------------
def welcome_employee(name: str, email: str, temp_password: str, org_name: str) -> dict:
    login_url = f"{settings.FRONTEND_URL}/login"
    body = f"""
      <p style="margin:0 0 6px;">Hi {name},</p>
      <p style="margin:0 0 6px;">
        An administrator has created a Carpool account for you at <strong>{org_name}</strong>.
        Use the temporary credentials below to sign in, then change your password from your profile.
      </p>
      {_facts([("Email", email), ("Temp password", temp_password)])}
      {_button("Sign in to Carpool", login_url)}
      <p style="margin:14px 0 0;font-size:13px;color:{MUTED};">
        For your security, please change this password after your first sign-in.
      </p>
    """
    return {
        "subject": f"Your Carpool account at {org_name}",
        "html": _render(
            preheader="Your Carpool account is ready — sign in with your temporary password.",
            eyebrow="Account created",
            heading="Welcome to Carpool",
            body_html=body,
        ),
        "text": (
            f"Hi {name},\n\nAn account was created for you at {org_name}.\n"
            f"Email: {email}\nTemporary password: {temp_password}\n\n"
            f"Sign in: {login_url}\nPlease change your password after signing in."
        ),
    }


def booking_created(driver_name: str, passenger_name: str, seats: int, route: str, when: str, ride_id: str) -> dict:
    url = f"{settings.FRONTEND_URL}/trips/{ride_id}"
    body = f"""
      <p style="margin:0 0 6px;">Hi {driver_name},</p>
      <p style="margin:0 0 6px;"><strong>{passenger_name}</strong> booked
        {seats} seat{'s' if seats != 1 else ''} on your ride.</p>
      {_facts([("Route", route), ("Departure", when), ("Seats booked", str(seats))])}
      {_button("View trip", url)}
    """
    return {
        "subject": f"New booking: {passenger_name} joined your ride",
        "html": _render(
            preheader=f"{passenger_name} booked {seats} seat(s) on your ride.",
            eyebrow="New booking",
            heading="You have a new passenger",
            body_html=body,
        ),
        "text": f"{passenger_name} booked {seats} seat(s) on your ride ({route}, {when}). View: {url}",
    }


def booking_cancelled(driver_name: str, passenger_name: str, route: str, ride_id: str) -> dict:
    url = f"{settings.FRONTEND_URL}/trips/{ride_id}"
    body = f"""
      <p style="margin:0 0 6px;">Hi {driver_name},</p>
      <p style="margin:0 0 6px;"><strong>{passenger_name}</strong> cancelled their booking on your ride.
        Those seats are available again.</p>
      {_facts([("Route", route)])}
      {_button("View trip", url)}
    """
    return {
        "subject": f"Booking cancelled: {passenger_name}",
        "html": _render(
            preheader=f"{passenger_name} cancelled their booking.",
            eyebrow="Booking cancelled",
            heading="A passenger cancelled",
            body_html=body,
            accent=DANGER,
        ),
        "text": f"{passenger_name} cancelled their booking on your ride ({route}). View: {url}",
    }


def ride_cancelled(passenger_name: str, route: str, reason: str | None) -> dict:
    reason_html = f"<p style='margin:0 0 6px;'>Reason: <em>{reason}</em></p>" if reason else ""
    body = f"""
      <p style="margin:0 0 6px;">Hi {passenger_name},</p>
      <p style="margin:0 0 6px;">Unfortunately the driver cancelled a ride you had booked.
        Any seats you reserved have been released.</p>
      {reason_html}
      {_facts([("Route", route)])}
      {_button("Find another ride", f"{settings.FRONTEND_URL}/find")}
    """
    return {
        "subject": "A ride you booked was cancelled",
        "html": _render(
            preheader="The driver cancelled a ride you booked.",
            eyebrow="Ride cancelled",
            heading="Your ride was cancelled",
            body_html=body,
            accent=DANGER,
        ),
        "text": f"The driver cancelled your ride ({route}). {('Reason: ' + reason) if reason else ''}",
    }


def ride_started(passenger_name: str, route: str, ride_id: str) -> dict:
    url = f"{settings.FRONTEND_URL}/trips/{ride_id}"
    body = f"""
      <p style="margin:0 0 6px;">Hi {passenger_name},</p>
      <p style="margin:0 0 6px;">Your ride is now on the way. Track it live and stay in touch with your driver.</p>
      {_facts([("Route", route)])}
      {_button("Track live", url)}
    """
    return {
        "subject": "Your ride has started",
        "html": _render(
            preheader="Your driver is on the way — track live.",
            eyebrow="Trip started",
            heading="Your ride is on the way",
            body_html=body,
            accent=ACCENT,
        ),
        "text": f"Your ride ({route}) has started. Track: {url}",
    }


def ride_completed(passenger_name: str, route: str, amount: str, ride_id: str) -> dict:
    url = f"{settings.FRONTEND_URL}/trips/{ride_id}"
    body = f"""
      <p style="margin:0 0 6px;">Hi {passenger_name},</p>
      <p style="margin:0 0 6px;">Your ride is complete. Please settle the fare to close out the trip.</p>
      {_facts([("Route", route), ("Amount due", amount)])}
      {_button("Pay now", url)}
    """
    return {
        "subject": "Ride complete — payment due",
        "html": _render(
            preheader="Your ride is complete. Settle the fare.",
            eyebrow="Trip completed",
            heading="Time to settle up",
            body_html=body,
            accent=ACCENT,
        ),
        "text": f"Your ride ({route}) is complete. Amount due: {amount}. Pay: {url}",
    }


def payment_received(driver_name: str, payer_name: str, amount: str, route: str) -> dict:
    body = f"""
      <p style="margin:0 0 6px;">Hi {driver_name},</p>
      <p style="margin:0 0 6px;">You received a payment of <strong>{amount}</strong> from
        <strong>{payer_name}</strong>. It's been credited to your Carpool wallet.</p>
      {_facts([("Route", route), ("Amount", amount), ("From", payer_name)])}
      {_button("View wallet", f"{settings.FRONTEND_URL}/wallet")}
    """
    return {
        "subject": f"Payment received: {amount}",
        "html": _render(
            preheader=f"{payer_name} paid you {amount}.",
            eyebrow="Payment received",
            heading="You got paid",
            body_html=body,
            accent=SUCCESS,
        ),
        "text": f"{payer_name} paid you {amount} for the ride ({route}). Credited to your wallet.",
    }


def document_verified(name: str, doc_label: str) -> dict:
    body = f"""
      <p style="margin:0 0 6px;">Hi {name},</p>
      <p style="margin:0 0 6px;">Good news — your <strong>{doc_label}</strong> has been verified.
        You can now offer rides on Carpool.</p>
      {_button("Offer a ride", f"{settings.FRONTEND_URL}/offer")}
    """
    return {
        "subject": f"{doc_label} verified",
        "html": _render(
            preheader=f"Your {doc_label} has been verified.",
            eyebrow="Document verified",
            heading="You're verified to drive",
            body_html=body,
            accent=SUCCESS,
        ),
        "text": f"Your {doc_label} has been verified. You can now offer rides.",
    }


def document_rejected(name: str, doc_label: str, reason: str | None) -> dict:
    reason_html = f"<p style='margin:0 0 6px;'>Reason: <em>{reason}</em></p>" if reason else ""
    body = f"""
      <p style="margin:0 0 6px;">Hi {name},</p>
      <p style="margin:0 0 6px;">Your <strong>{doc_label}</strong> could not be verified.
        Please re-upload a clear, valid document.</p>
      {reason_html}
      {_button("Re-upload document", f"{settings.FRONTEND_URL}/documents")}
    """
    return {
        "subject": f"{doc_label} needs attention",
        "html": _render(
            preheader=f"Your {doc_label} was rejected.",
            eyebrow="Document rejected",
            heading="Action needed on your document",
            body_html=body,
            accent=DANGER,
        ),
        "text": f"Your {doc_label} was rejected. {('Reason: ' + reason) if reason else ''} Re-upload required.",
    }
