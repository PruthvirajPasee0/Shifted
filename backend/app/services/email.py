"""SMTP email delivery.

Uses the Python standard library (smtplib + EmailMessage) so no extra
dependency is required. Sends are meant to be scheduled via FastAPI
BackgroundTasks so a slow/unreachable SMTP server never blocks a response.
"""
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

from ..config import settings

logger = logging.getLogger("carpool.email")


def send_email(to_email: str, subject: str, html_body: str, text_body: str | None = None) -> bool:
    """Send a single HTML email. Returns True on success, False otherwise.

    Never raises — email is best-effort and must not break the request that
    triggered it (it usually runs in a background task anyway).
    """
    if not settings.email_configured:
        logger.info("Email not configured; skipping send to %s (%s)", to_email, subject)
        return False
    if not to_email:
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((settings.SMTP_FROM_NAME, settings.SMTP_USER))
    msg["To"] = to_email
    msg.set_content(text_body or "Open this message in an HTML-capable email client.")
    msg.add_alternative(html_body, subtype="html")

    # App passwords are often stored/copied with spaces — normalise.
    password = (settings.SMTP_PASSWORD or "").replace(" ", "")

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as server:
            server.ehlo()
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
            server.login(settings.SMTP_USER, password)
            server.send_message(msg)
        logger.info("Sent email to %s: %s", to_email, subject)
        return True
    except Exception as exc:  # noqa: BLE001 - best-effort, log and move on
        logger.warning("Failed to send email to %s (%s): %s", to_email, subject, exc)
        return False
