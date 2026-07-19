from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./carpool.db"
    # No insecure fallback: a missing JWT_SECRET must fail startup, not sign
    # tokens with a publicly-known placeholder string.
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_MINUTES: int = 120
    GOOGLE_API_KEY: str | None = None

    # Public URL of the frontend, used to build links inside emails.
    FRONTEND_URL: str = "http://localhost:5173"
    # Comma-separated browser origins allowed by CORS.
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000"

    # --- Email / SMTP (Gmail app password) ---
    EMAIL_ENABLED: bool = True
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_FROM_NAME: str = "Shifted"

    # --- Razorpay (test mode) ---
    RAZORPAY_KEY_ID: str | None = None
    RAZORPAY_KEY_SECRET: str | None = None

    # --- Optional SMS (Phase 3 stub; logs when unconfigured) ---
    SMS_ENABLED: bool = False
    SMS_PROVIDER_URL: str | None = None
    SMS_API_KEY: str | None = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def email_configured(self) -> bool:
        return bool(self.EMAIL_ENABLED and self.SMTP_USER and self.SMTP_PASSWORD)

    @property
    def razorpay_configured(self) -> bool:
        return bool(self.RAZORPAY_KEY_ID and self.RAZORPAY_KEY_SECRET)

    @property
    def sms_configured(self) -> bool:
        return bool(self.SMS_ENABLED and self.SMS_PROVIDER_URL and self.SMS_API_KEY)


settings = Settings()
