from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.schema_domains.common import UserRole
from app.schema_domains.patients import AuditEventOut


class SuperuserOrgSummaryOut(BaseModel):
    org_id: UUID
    clinic_name: str
    created_at: datetime
    user_count: int = 0
    patient_count: int = 0
    note_count: int = 0
    invoice_count: int = 0
    follow_up_count: int = 0
    total_tokens: int = 0
    media_storage_bytes: int = 0
    last_activity_at: datetime | None = None
    recent_error_count: int = 0


class SuperuserOrgUserOut(BaseModel):
    id: UUID
    org_id: UUID
    identifier: str
    name: str
    role: UserRole
    created_at: datetime


class PlatformErrorOut(BaseModel):
    id: UUID
    org_id: UUID | None = None
    user_id: UUID | None = None
    identifier: str = ""
    path: str
    method: str
    status_code: int | None = None
    error_type: str
    message: str
    details: str = ""
    context: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class SuperuserUsageSummaryOut(BaseModel):
    total_tokens: int = 0
    total_requests: int = 0
    by_feature: dict[str, int] = Field(default_factory=dict)


class SuperuserOrgDetailOut(BaseModel):
    summary: SuperuserOrgSummaryOut
    users: list[SuperuserOrgUserOut] = Field(default_factory=list)
    recent_errors: list[PlatformErrorOut] = Field(default_factory=list)
    usage: SuperuserUsageSummaryOut
    recent_audit_events: list[AuditEventOut] = Field(default_factory=list)


class SuperdashboardMetricPointOut(BaseModel):
    date: str
    value: int | float


class SuperdashboardDashboardOut(BaseModel):
    org_count: int = 0
    active_org_count: int = 0
    user_count: int = 0
    patient_count: int = 0
    note_count: int = 0
    invoice_count: int = 0
    follow_up_count: int = 0
    ai_tokens_7d: int = 0
    ai_requests_7d: int = 0
    media_storage_bytes: int = 0
    error_count_7d: int = 0
    error_rate_7d: float = 0
    top_error_context: str = ""


class SuperdashboardTrendsOut(BaseModel):
    requests: list[SuperdashboardMetricPointOut] = Field(default_factory=list)
    tokens: list[SuperdashboardMetricPointOut] = Field(default_factory=list)
    storage: list[SuperdashboardMetricPointOut] = Field(default_factory=list)
    errors: list[SuperdashboardMetricPointOut] = Field(default_factory=list)


class SuperdashboardOrgUsageRowOut(BaseModel):
    org_id: UUID
    clinic_name: str
    total_tokens: int = 0
    media_storage_bytes: int = 0


class SuperdashboardUsageByOrgOut(BaseModel):
    ai_usage: list[SuperdashboardOrgUsageRowOut] = Field(default_factory=list)
    media_storage: list[SuperdashboardOrgUsageRowOut] = Field(default_factory=list)


class CustomerOnboardingCreate(BaseModel):
    customer_name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=5, max_length=40)
    users_allowed: int = Field(default=2, ge=1, le=500)


class CustomerOnboardingUpdate(BaseModel):
    customer_name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = Field(default=None, min_length=5, max_length=40)
    users_allowed: int | None = Field(default=None, ge=1, le=500)
    status: str | None = Field(default=None, pattern="^(pending|claimed|disabled)$")


class CustomerOnboardingOut(BaseModel):
    id: UUID
    customer_id: str
    customer_name: str
    phone: str
    users_allowed: int = 2
    users_used: int = 0
    status: str
    claimed_org_id: UUID | None = None
    claimed_org_name: str | None = None
    claimed_at: datetime | None = None
    created_by: UUID | None = None
    created_at: datetime
    updated_at: datetime


class SuperdashboardOnboardingSummaryOut(BaseModel):
    pending_count: int = 0
    claimed_count: int = 0
    disabled_count: int = 0
    default_users_allowed: int = 2


class SuperdashboardOnboardingOut(BaseModel):
    summary: SuperdashboardOnboardingSummaryOut
    customers: list[CustomerOnboardingOut] = Field(default_factory=list)


class ExportRow(BaseModel):
    row: dict[str, Any]
