from datetime import datetime

from app.schemas import GenerateNoteRequest


def _render_pipe_table(title: str, headers: list[str], rows: list[list[str]]) -> str:
    if not rows:
        return ""
    table_lines = [
        title,
        " | ".join(headers),
        " | ".join(["---"] * len(headers)),
    ]
    table_lines.extend(" | ".join(row) for row in rows)
    return "\n".join(table_lines)


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
    vital_rows: list[list[str]] = []
    if payload.blood_pressure_systolic is not None and payload.blood_pressure_diastolic is not None:
        vital_rows.append(
            ["Blood Pressure", f"{payload.blood_pressure_systolic}/{payload.blood_pressure_diastolic} mmHg"]
        )
    elif payload.blood_pressure_systolic is not None or payload.blood_pressure_diastolic is not None:
        bp_parts = [
            str(payload.blood_pressure_systolic) if payload.blood_pressure_systolic is not None else "?",
            str(payload.blood_pressure_diastolic) if payload.blood_pressure_diastolic is not None else "?",
        ]
        vital_rows.append(["Blood Pressure", f"{'/'.join(bp_parts)} mmHg"])
    if payload.pulse is not None:
        vital_rows.append(["Pulse", f"{payload.pulse} bpm"])
    if payload.spo2 is not None:
        vital_rows.append(["SpO2", f"{payload.spo2}%"])
    if payload.blood_sugar is not None:
        vital_rows.append(["Blood Sugar", str(payload.blood_sugar)])
    vitals_table = _render_pipe_table("Vitals Table:", ["Measurement", "Value"], vital_rows)
    if vitals_table:
        measurement_bits.append(vitals_table)
    score_rows: list[list[str]] = []
    for score in payload.test_scores:
        score_rows.append([score.label, score.value])
    score_table = _render_pipe_table("Test Scores:", ["Test", "Result"], score_rows)
    if score_table:
        measurement_bits.append(score_table)
    if payload.eye_exam:
        eye_rows: list[list[str]] = []
        for entry in payload.eye_exam:
            if not (entry.sphere or entry.cylinder or entry.axis or entry.vision):
                continue
            eye_rows.append(
                [
                    entry.eye.title(),
                    entry.sphere or "-",
                    entry.cylinder or "-",
                    entry.axis or "-",
                    entry.vision or "-",
                ]
            )
        eye_table = _render_pipe_table("Eye Exam:", ["Eye", "Sphere", "Cylinder", "Axis", "Vision"], eye_rows)
        if eye_table:
            measurement_bits.append(eye_table)
    return "\n".join(bit for bit in measurement_bits if bit)
