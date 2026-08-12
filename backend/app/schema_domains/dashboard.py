from pydantic import BaseModel, Field


class DashboardStatusOut(BaseModel):
    queue_revision: str
    active_patient_count: int = Field(ge=0)
    check_in_revision: str
    pending_check_in_count: int = Field(ge=0)
