from typing import Literal


PatientStatus = Literal["waiting", "consultation", "done"]
UserRole = Literal["admin", "staff"]
ClinicSpecialty = Literal["optometry", "general_physician", "pediatrics"]
CatalogItemType = Literal["service", "medicine"]
PaymentStatus = Literal["unpaid", "paid", "partial"]
FollowUpStatus = Literal["scheduled", "completed", "cancelled"]
AppointmentStatus = Literal["scheduled", "checked_in", "cancelled"]
NoteStatus = Literal["draft", "final", "sent"]
CaseStudyStatus = Literal["draft", "final"]
CaseStudyTemplateKey = Literal["conference_presentation", "teaching_rounds", "hospital_case_discussion"]

TimelineEventType = Literal[
    "patient_created",
    "visit_recorded",
    "appointment_booked",
    "appointment_checked_in",
    "consultation_note",
    "myopia_measurement",
    "growth_measurement",
    "well_child_visit",
    "invoice_created",
    "bill_sent",
    "follow_up_scheduled",
    "follow_up_completed",
]
