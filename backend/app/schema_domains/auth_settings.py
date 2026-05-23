from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field
from pydantic import field_validator, model_validator

from app.schema_domains.common import ClinicSpecialty, UserRole


DEFAULT_DOCUMENT_TEMPLATE_MARGIN = 54.0


class ClinicSettingsUpdate(BaseModel):
    clinic_name: str | None = Field(default=None, min_length=1, max_length=120)
    clinic_address: str | None = Field(default=None, max_length=300)
    clinic_phone: str | None = Field(default=None, max_length=40)
    clinic_specialty: ClinicSpecialty | None = None
    appointment_start_time: str | None = Field(default=None, min_length=5, max_length=5)
    appointment_end_time: str | None = Field(default=None, min_length=5, max_length=5)
    appointments_per_hour: int | None = Field(default=None, ge=1, le=12)
    doctor_name: str | None = Field(default=None, max_length=120)
    sender_name: str | None = Field(default=None, max_length=120)
    sender_email: str | None = Field(default=None, max_length=200)
    sender_email_app_password: str | None = Field(default=None, max_length=128)
    email_configured: bool | None = None
    custom_header: str | None = Field(default=None, max_length=500)
    custom_footer: str | None = Field(default=None, max_length=500)
    document_template_name: str | None = Field(default=None, max_length=255)
    document_template_url: str | None = None
    document_template_notes_enabled: bool | None = None
    document_template_letters_enabled: bool | None = None
    document_template_invoices_enabled: bool | None = None
    document_template_margin_top: float | None = Field(default=None, ge=0, le=288)
    document_template_margin_right: float | None = Field(default=None, ge=0, le=288)
    document_template_margin_bottom: float | None = Field(default=None, ge=0, le=288)
    document_template_margin_left: float | None = Field(default=None, ge=0, le=288)

    @field_validator("appointment_start_time", "appointment_end_time")
    @classmethod
    def validate_appointment_time(cls, value: str | None) -> str | None:
        if value is None:
            return value
        datetime.strptime(value, "%H:%M")
        return value

    @field_validator("appointments_per_hour")
    @classmethod
    def validate_appointments_per_hour(cls, value: int | None) -> int | None:
        if value is None:
            return value
        if 60 % value != 0:
            raise ValueError("Appointments per hour must divide evenly into 60 minutes.")
        return value

    @model_validator(mode="after")
    def validate_booking_window(self) -> "ClinicSettingsUpdate":
        if self.appointment_start_time and self.appointment_end_time:
            start = datetime.strptime(self.appointment_start_time, "%H:%M")
            end = datetime.strptime(self.appointment_end_time, "%H:%M")
            if start >= end:
                raise ValueError("Appointment closing time must be after opening time.")
        return self


class ClinicSettingsOut(BaseModel):
    clinic_name: str = "ClinicOS"
    clinic_address: str = ""
    clinic_phone: str = ""
    clinic_specialty: ClinicSpecialty | None = None
    appointment_start_time: str = "09:00"
    appointment_end_time: str = "18:00"
    appointments_per_hour: int = 4
    doctor_name: str = ""
    sender_name: str = ""
    sender_email: str = ""
    email_configured: bool = False
    custom_header: str = ""
    custom_footer: str = ""
    document_template_name: str | None = None
    document_template_url: str | None = None
    document_template_notes_enabled: bool = False
    document_template_letters_enabled: bool = False
    document_template_invoices_enabled: bool = False
    document_template_margin_top: float = DEFAULT_DOCUMENT_TEMPLATE_MARGIN
    document_template_margin_right: float = DEFAULT_DOCUMENT_TEMPLATE_MARGIN
    document_template_margin_bottom: float = DEFAULT_DOCUMENT_TEMPLATE_MARGIN
    document_template_margin_left: float = DEFAULT_DOCUMENT_TEMPLATE_MARGIN
    id: UUID
    org_id: UUID
    updated_at: datetime | None = None


class UserBase(BaseModel):
    identifier: str = Field(min_length=5, max_length=120)


class UserCreate(UserBase):
    password: str = Field(min_length=4, max_length=128)
    admin_name: str = Field(min_length=1, max_length=120)
    clinic_name: str = Field(min_length=1, max_length=120)
    clinic_address: str = Field(min_length=1, max_length=300)
    clinic_phone: str = Field(default="", max_length=40)
    doctor_name: str = Field(default="", max_length=120)


class StaffUserCreate(UserBase):
    password: str = Field(min_length=4, max_length=128)


class UserRoleUpdate(BaseModel):
    role: UserRole


class LoginRequest(UserBase):
    password: str = Field(min_length=4, max_length=128)


class UserAccountUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    doctor_dob: date | None = None
    doctor_address: str = Field(default="", max_length=300)


class UserPasswordUpdate(BaseModel):
    current_password: str = Field(min_length=4, max_length=128)
    new_password: str = Field(min_length=4, max_length=128)


class UserOut(UserBase):
    id: UUID
    org_id: UUID
    name: str
    role: UserRole
    doctor_dob: date | None = None
    doctor_address: str = ""
    doctor_signature_name: str | None = None
    doctor_signature_url: str | None = None
    doctor_signature_content_type: str | None = None
    created_at: datetime


class AuthResponse(BaseModel):
    token: str
    user: UserOut
