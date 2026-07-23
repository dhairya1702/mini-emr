from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


ControlRoomStatus = Literal["healthy", "warning", "failing", "unknown"]


class ControlRoomCheckOut(BaseModel):
    key: str
    label: str
    status: ControlRoomStatus
    evidence: str = ""
    next_action: str = ""
    checked_at: datetime


class ControlRoomStatusOut(BaseModel):
    checked_at: datetime
    overall_status: ControlRoomStatus
    checks: list[ControlRoomCheckOut] = Field(default_factory=list)


class ControlRoomMigrationOut(BaseModel):
    name: str
    checksum_sha256: str = ""
    applied_at: datetime | None = None


class ControlRoomTableStatOut(BaseModel):
    table_name: str
    estimated_rows: int = 0


class ControlRoomIntegrityCheckOut(BaseModel):
    key: str
    label: str
    status: ControlRoomStatus
    invalid_count: int = 0
    evidence: str = ""


class ControlRoomDatabaseOut(BaseModel):
    checked_at: datetime
    reachable: bool
    migration_status: ControlRoomStatus
    pending_migrations: list[str] = Field(default_factory=list)
    database_only_migrations: list[str] = Field(default_factory=list)
    applied_migrations: list[ControlRoomMigrationOut] = Field(default_factory=list)
    table_stats: list[ControlRoomTableStatOut] = Field(default_factory=list)
    integrity_checks: list[ControlRoomIntegrityCheckOut] = Field(default_factory=list)


class ControlRoomIncidentSampleOut(BaseModel):
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


class ControlRoomIncidentOut(BaseModel):
    fingerprint: str
    severity: Literal["critical", "high", "medium", "low"]
    method: str
    path: str
    status_code: int | None = None
    error_type: str
    message: str
    count: int
    affected_org_count: int
    affected_user_count: int
    first_seen_at: datetime
    last_seen_at: datetime
    latest_sample: ControlRoomIncidentSampleOut


class ControlRoomIncidentsOut(BaseModel):
    checked_at: datetime
    window_hours: int
    incidents: list[ControlRoomIncidentOut] = Field(default_factory=list)


class ControlRoomRunbookStepOut(BaseModel):
    label: str
    command: str = ""
    note: str = ""
    dangerous: bool = False


class ControlRoomRunbookOut(BaseModel):
    key: str
    title: str
    summary: str
    steps: list[ControlRoomRunbookStepOut] = Field(default_factory=list)


class ControlRoomRunbooksOut(BaseModel):
    runbooks: list[ControlRoomRunbookOut] = Field(default_factory=list)
