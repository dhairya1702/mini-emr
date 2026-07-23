from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.email_validation import normalize_single_email
from app.schema_domains.common import CatalogItemType, PaymentStatus


class CatalogItemBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    item_type: CatalogItemType
    default_price: float = Field(ge=0, le=100000)
    track_inventory: bool = False
    stock_quantity: float = Field(default=0, ge=0, le=1000000)
    low_stock_threshold: float = Field(default=0, ge=0, le=1000000)
    unit: str = Field(default="", max_length=40)
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


class CatalogItemCreate(CatalogItemBase):
    pass


class CatalogItemOut(CatalogItemBase):
    id: UUID
    org_id: UUID
    created_at: datetime


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
    total: float
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


class FinalizeInvoiceRequest(BaseModel):
    invoice_id: UUID


class InvoiceActionResponse(BaseModel):
    success: bool
    message: str
    invoice: InvoiceOut
