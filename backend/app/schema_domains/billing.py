from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.email_validation import normalize_single_email
from app.schema_domains.care_programs import ProgramEnrollmentSummaryOut
from app.schema_domains.common import CatalogItemType, PaymentStatus
from app.schema_domains.documents import WhatsAppDeliveryOut


class CatalogItemBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    item_type: CatalogItemType
    default_price: float = Field(ge=0, le=100000)
    track_inventory: bool = False
    stock_quantity: float = Field(default=0, ge=0, le=1000000)
    low_stock_threshold: float = Field(default=0, ge=0, le=1000000)
    unit: str = Field(default="", max_length=40)
    hsn_sac_code: str = Field(default="", max_length=8, pattern=r"^\d{0,8}$")
    gst_rate: float | None = Field(default=None, gt=0, le=100)
    aliases: list[str] = Field(default_factory=list, max_length=30)
    description: str = Field(default="", max_length=1000)
    program_key: str | None = Field(default=None, max_length=80)
    program_definition: dict[str, Any] | None = None
    is_active: bool = True

    @field_validator("aliases")
    @classmethod
    def normalize_aliases(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        for alias in value:
            cleaned = alias.strip()
            if cleaned and cleaned.casefold() not in {entry.casefold() for entry in normalized}:
                normalized.append(cleaned[:120])
        return normalized

    @model_validator(mode="after")
    def validate_gst_pair(self) -> "CatalogItemBase":
        code = self.hsn_sac_code.strip()
        if code and len(code) not in {4, 6, 8}:
            raise ValueError("HSN/SAC code must contain 4, 6, or 8 digits.")
        if bool(code) != (self.gst_rate is not None):
            raise ValueError("Enter both HSN/SAC code and GST rate, or leave both blank.")
        self.hsn_sac_code = code
        return self


class CatalogItemCreate(CatalogItemBase):
    pass


class CatalogItemUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    item_type: CatalogItemType
    default_price: float = Field(ge=0, le=100000)
    track_inventory: bool = False
    low_stock_threshold: float = Field(default=0, ge=0, le=1000000)
    unit: str = Field(default="", max_length=40)
    hsn_sac_code: str = Field(default="", max_length=8, pattern=r"^\d{0,8}$")
    gst_rate: float | None = Field(default=None, gt=0, le=100)
    aliases: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("aliases")
    @classmethod
    def normalize_aliases(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        for alias in value:
            cleaned = alias.strip()
            if cleaned and cleaned.casefold() not in {entry.casefold() for entry in normalized}:
                normalized.append(cleaned[:120])
        return normalized

    @model_validator(mode="after")
    def validate_gst_pair(self) -> "CatalogItemUpdate":
        code = self.hsn_sac_code.strip()
        if code and len(code) not in {4, 6, 8}:
            raise ValueError("HSN/SAC code must contain 4, 6, or 8 digits.")
        if bool(code) != (self.gst_rate is not None):
            raise ValueError("Enter both HSN/SAC code and GST rate, or leave both blank.")
        self.hsn_sac_code = code
        return self


class CatalogItemOut(CatalogItemBase):
    id: UUID
    org_id: UUID
    created_at: datetime


class MedicineCatalogItemOut(BaseModel):
    id: UUID
    name: str
    unit: str = ""
    default_price: float = 0
    track_inventory: bool = False
    stock_quantity: float = 0


class CatalogStockUpdate(BaseModel):
    delta: float = Field(ge=-1000000, le=1000000)


class InvoiceItemInput(BaseModel):
    catalog_item_id: UUID | None = None
    item_type: CatalogItemType
    label: str = Field(min_length=1, max_length=120)
    quantity: float = Field(gt=0, le=10000)
    unit_price: float = Field(ge=0, le=100000)


class InvoiceItemOut(InvoiceItemInput):
    id: UUID
    line_total: float
    hsn_sac_code: str = ""
    gst_rate: float | None = None
    taxable_value: float = 0
    tax_amount: float = 0
    cgst_amount: float = 0
    sgst_amount: float = 0


class InvoiceCreate(BaseModel):
    invoice_id: UUID | None = None
    patient_id: UUID
    items: list[InvoiceItemInput] = Field(min_length=1)
    payment_status: PaymentStatus = "paid"
    amount_paid: float | None = Field(default=None, ge=0, le=100000000)


class InvoiceOut(BaseModel):
    id: UUID
    org_id: UUID
    patient_id: UUID
    visit_id: UUID | None = None
    patient_name: str | None = None
    subtotal: float
    tax_total: float = 0
    cgst_total: float = 0
    sgst_total: float = 0
    total: float
    supplier_gstin: str = ""
    payment_status: PaymentStatus
    amount_paid: float = 0
    balance_due: float = 0
    paid_at: datetime | None = None
    completed_at: datetime | None = None
    completed_by: UUID | None = None
    completed_by_name: str | None = None
    sent_at: datetime | None = None
    created_at: datetime
    items: list[InvoiceItemOut]


class InvoiceSummaryOut(BaseModel):
    id: UUID
    patient_id: UUID
    patient_name: str | None = None
    item_count: int = Field(ge=0)
    total: float
    payment_status: PaymentStatus
    amount_paid: float = 0
    balance_due: float = 0
    created_at: datetime


class BillingStatusOut(BaseModel):
    billable_patients_revision: str
    billable_patient_count: int = Field(ge=0)
    invoices_revision: str


class BillingDashboardOut(BillingStatusOut):
    recent_invoices: list[InvoiceSummaryOut]


class SendInvoiceRequest(BaseModel):
    invoice_id: UUID
    recipient_email: str = Field(min_length=5, max_length=200)

    @field_validator("recipient_email")
    @classmethod
    def validate_recipient_email(cls, value: str) -> str:
        return normalize_single_email(value)


class SendInvoiceWhatsAppRequest(BaseModel):
    invoice_id: UUID
    recipient_phone: str | None = Field(default=None, max_length=40)
    idempotency_key: str = Field(default="", max_length=200)


class FinalizeInvoiceRequest(BaseModel):
    invoice_id: UUID


class InvoicePaymentUpdate(BaseModel):
    amount_paid: float = Field(gt=0, le=100000000)


class InvoiceActionResponse(BaseModel):
    success: bool
    message: str
    invoice: InvoiceOut
    program_enrollments: list[ProgramEnrollmentSummaryOut] = Field(default_factory=list)
    delivery: WhatsAppDeliveryOut | None = None
