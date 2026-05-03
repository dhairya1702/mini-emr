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
    last_activity_at: datetime | None = None


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


class ExportRow(BaseModel):
    row: dict[str, Any]
