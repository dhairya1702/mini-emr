from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class PatientAttachmentOut(BaseModel):
    id: UUID
    org_id: UUID
    patient_id: UUID
    uploaded_by: UUID | None = None
    file_name: str
    content_type: str
    file_size: int
    storage_path: str
    created_at: datetime
