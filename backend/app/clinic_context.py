from datetime import datetime

from app.schemas import GenerateNoteRequest


def build_clinic_context(clinic_settings: dict) -> str:
    clinic_context_bits = [
        f"Clinic Name: {clinic_settings.get('clinic_name', 'ClinicOS') or 'ClinicOS'}",
        f"Clinic Address: {clinic_settings.get('clinic_address', '')}" if clinic_settings.get("clinic_address") else "",
        f"Clinic Phone: {clinic_settings.get('clinic_phone', '')}" if clinic_settings.get("clinic_phone") else "",
        f"Doctor Name: {clinic_settings.get('doctor_name', '')}" if clinic_settings.get("doctor_name") else "",
        f"Custom Header: {clinic_settings.get('custom_header', '')}" if clinic_settings.get("custom_header") else "",
        f"Custom Footer: {clinic_settings.get('custom_footer', '')}" if clinic_settings.get("custom_footer") else "",
    ]
    return "\n".join(bit for bit in clinic_context_bits if bit)


def build_patient_context(patient: dict | None, *, generated_at: str | None = None) -> str:
    if not patient:
        return ""

    rendered_at = generated_at or datetime.now().strftime("%b %d, %Y %I:%M %p")
    context_bits = [
        f"Name: {patient['name']}",
        f"Phone: {patient['phone']}",
        f"Age: {patient['age']}" if patient.get("age") is not None else "",
        f"Height: {patient['height']} cm" if patient.get("height") is not None else "",
        f"Weight: {patient['weight']} kg" if patient.get("weight") is not None else "",
        f"Temperature: {patient['temperature']} F" if patient.get("temperature") is not None else "",
        f"Reason for Visit: {patient['reason']}",
        f"Generated On: {rendered_at}",
    ]
    return "\n".join(bit for bit in context_bits if bit)


def build_measurements_context(payload: GenerateNoteRequest) -> str:
    measurement_bits: list[str] = []
    if payload.blood_pressure_systolic is not None and payload.blood_pressure_diastolic is not None:
        measurement_bits.append(
            f"Blood Pressure: {payload.blood_pressure_systolic}/{payload.blood_pressure_diastolic} mmHg"
        )
    elif payload.blood_pressure_systolic is not None or payload.blood_pressure_diastolic is not None:
        bp_parts = [
            str(payload.blood_pressure_systolic) if payload.blood_pressure_systolic is not None else "?",
            str(payload.blood_pressure_diastolic) if payload.blood_pressure_diastolic is not None else "?",
        ]
        measurement_bits.append(f"Blood Pressure: {'/'.join(bp_parts)} mmHg")
    if payload.pulse is not None:
        measurement_bits.append(f"Pulse: {payload.pulse} bpm")
    if payload.spo2 is not None:
        measurement_bits.append(f"SpO2: {payload.spo2}%")
    if payload.blood_sugar is not None:
        measurement_bits.append(f"Blood Sugar: {payload.blood_sugar}")
    for score in payload.test_scores:
        measurement_bits.append(f"{score.label}: {score.value}")
    if payload.eye_exam:
        eye_exam_lines = ["Eye Exam:"]
        for entry in payload.eye_exam:
            row_bits = [
                f"Sphere {entry.sphere}" if entry.sphere else "",
                f"Cylinder {entry.cylinder}" if entry.cylinder else "",
                f"Axis {entry.axis}" if entry.axis else "",
                f"Vision {entry.vision}" if entry.vision else "",
            ]
            eye_exam_lines.append(
                f"- {entry.eye.title()} Eye: " + ", ".join(bit for bit in row_bits if bit)
            )
        measurement_bits.append("\n".join(line for line in eye_exam_lines if line.strip()))
    return "\n".join(bit for bit in measurement_bits if bit)
