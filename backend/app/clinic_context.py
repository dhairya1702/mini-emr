from datetime import datetime

from app.schema_domains.documents import GenerateNoteRequest


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
    if payload.contact_lens:
        contact_lens = payload.contact_lens
        assessment_rows = [
            ["Goal", contact_lens.wearing_goal],
            ["Current Lens Brand", contact_lens.current_lens_brand],
            ["Wear Schedule", contact_lens.current_wear_schedule],
            ["Replacement", contact_lens.replacement_frequency],
            ["Comfort Issues", contact_lens.comfort_issues],
            ["Dryness", contact_lens.dryness_symptoms],
            ["Handling Issues", contact_lens.handling_issues],
            ["Care Solution", contact_lens.care_solution],
            ["Allergy History", contact_lens.allergy_history],
            ["Assessment Notes", contact_lens.assessment_notes],
        ]
        rendered_assessment_rows = [[label, value] for label, value in assessment_rows if value]
        assessment_table = _render_pipe_table("Contact Lens Assessment:", ["Field", "Value"], rendered_assessment_rows)
        if assessment_table:
            measurement_bits.append(assessment_table)

        order_bits = [
            ["Lens Type", contact_lens.lens_type],
            ["Manufacturer", contact_lens.manufacturer],
            ["Brand", contact_lens.brand],
            ["Wear Modality", contact_lens.wear_modality],
            ["Trial Lens Used", contact_lens.trial_lens_used],
            ["Vendor", contact_lens.vendor_name],
            ["Quantity", contact_lens.quantity],
            ["Special Instructions", contact_lens.special_instructions],
        ]
        rendered_order_bits = [[label, value] for label, value in order_bits if value]
        order_table = _render_pipe_table("Contact Lens Order Summary:", ["Field", "Value"], rendered_order_bits)
        if order_table:
            measurement_bits.append(order_table)

        eye_rows: list[list[str]] = []
        for entry in contact_lens.eyes:
            if not any([
                entry.sphere,
                entry.cylinder,
                entry.axis,
                entry.base_curve,
                entry.diameter,
                entry.add_power,
                entry.visual_acuity,
                entry.over_refraction,
                entry.fit_notes,
            ]):
                continue
            eye_rows.append([
                entry.eye.title(),
                entry.sphere or "-",
                entry.cylinder or "-",
                entry.axis or "-",
                entry.base_curve or "-",
                entry.diameter or "-",
                entry.add_power or "-",
                entry.visual_acuity or "-",
                entry.over_refraction or "-",
                entry.fit_notes or "-",
            ])
        eye_table = _render_pipe_table(
            "Contact Lens Eye Details:",
            ["Eye", "Sphere", "Cylinder", "Axis", "BC", "Dia", "Add", "VA", "Over Ref", "Fit Notes"],
            eye_rows,
        )
        if eye_table:
            measurement_bits.append(eye_table)
    if payload.binocular_vision:
        binocular = payload.binocular_vision
        symptom_flags = [
            label for label, is_present in (
                ("Asthenopia", binocular.asthenopia),
                ("Headache", binocular.headache),
                ("Diplopia", binocular.diplopia),
                ("Blur Near", binocular.blur_near),
                ("Blur Distance", binocular.blur_distance),
                ("Reading Difficulty", binocular.reading_difficulty),
                ("Poor Concentration", binocular.poor_concentration),
            ) if is_present
        ]
        overview_rows = [
            ["Symptoms", ", ".join(symptom_flags)],
            ["Symptom Notes", binocular.symptom_notes],
            ["Distance Cover Test", binocular.distance_cover_test],
            ["Near Cover Test", binocular.near_cover_test],
            ["Distance Deviation", binocular.distance_deviation_pd],
            ["Near Deviation", binocular.near_deviation_pd],
            ["Binocular VA Distance", binocular.binocular_visual_acuity_distance],
            ["Binocular VA Near", binocular.binocular_visual_acuity_near],
            ["Motility", binocular.motility],
            ["Pursuits", binocular.pursuits],
            ["Saccades", binocular.saccades],
        ]
        overview_table = _render_pipe_table(
            "Binocular Vision Overview:",
            ["Field", "Value"],
            [[label, value] for label, value in overview_rows if value],
        )
        if overview_table:
            measurement_bits.append(overview_table)

        convergence_rows = [
            ["NPC Break", binocular.npc_break_cm],
            ["NPC Recovery", binocular.npc_recovery_cm],
            ["Convergence Notes", binocular.convergence_notes],
            ["BO Distance", binocular.bo_distance],
            ["BO Near", binocular.bo_near],
            ["BI Distance", binocular.bi_distance],
            ["BI Near", binocular.bi_near],
            ["Vergence Notes", binocular.vergence_notes],
        ]
        convergence_table = _render_pipe_table(
            "Binocular Vision Convergence:",
            ["Field", "Value"],
            [[label, value] for label, value in convergence_rows if value],
        )
        if convergence_table:
            measurement_bits.append(convergence_table)

        sensory_rows = [
            ["Stereo Test", binocular.stereo_test_name],
            ["Stereo Result", binocular.stereo_result_arcsec],
            ["Worth 4 Dot Distance", binocular.worth_four_dot_distance],
            ["Worth 4 Dot Near", binocular.worth_four_dot_near],
            ["Sensory Notes", binocular.sensory_notes],
            ["Amplitude Right", binocular.amplitude_right],
            ["Amplitude Left", binocular.amplitude_left],
            ["Facility", binocular.facility_cpm],
            ["Facility Lens", binocular.facility_lens],
            ["Accommodation Notes", binocular.accommodation_notes],
            ["Working Diagnosis", binocular.working_diagnosis],
            ["Management Plan", binocular.management_plan],
            ["Follow-up", binocular.follow_up_interval],
        ]
        sensory_table = _render_pipe_table(
            "Binocular Vision Sensory & Plan:",
            ["Field", "Value"],
            [[label, value] for label, value in sensory_rows if value],
        )
        if sensory_table:
            measurement_bits.append(sensory_table)
    if payload.low_vision:
        low_vision = payload.low_vision
        needs_flags = [
            label for label, is_present in (
                ("Reading Difficulty", low_vision.reading_difficulty),
                ("Distance Difficulty", low_vision.distance_difficulty),
                ("Mobility Difficulty", low_vision.mobility_difficulty),
                ("Face Recognition Difficulty", low_vision.face_recognition_difficulty),
                ("Glare Complaints", low_vision.glare_complaints),
                ("Lighting Difficulty", low_vision.lighting_difficulty),
            ) if is_present
        ]
        needs_rows = [
            ["Primary Complaint", low_vision.primary_complaint],
            ["Goals", low_vision.goals],
            ["Key Difficulties", ", ".join(needs_flags)],
            ["Distance VA", low_vision.distance_visual_acuity],
            ["Near VA", low_vision.near_visual_acuity],
            ["Habitual Correction", low_vision.habitual_correction],
            ["Best Correction", low_vision.best_correction],
            ["Contrast Sensitivity", low_vision.contrast_sensitivity],
            ["Glare Function", low_vision.glare_function],
            ["Central Vision", low_vision.central_vision],
            ["Visual Field", low_vision.visual_field],
        ]
        needs_table = _render_pipe_table(
            "Low Vision Assessment:",
            ["Field", "Value"],
            [[label, value] for label, value in needs_rows if value],
        )
        if needs_table:
            measurement_bits.append(needs_table)

        function_rows = [
            ["Functional Reading", low_vision.functional_reading],
            ["Sustained Near Task", low_vision.sustained_near_task],
            ["TV / Phone / Mobility", low_vision.tv_phone_mobility_notes],
            ["Illumination Response", low_vision.illumination_response],
            ["Posture / Working Distance", low_vision.posture_working_distance],
            ["Magnifier Type", low_vision.magnifier_type],
            ["Magnification", low_vision.magnification],
            ["Near Add", low_vision.near_add],
            ["Electronic Aid", low_vision.electronic_aid],
            ["Tint / Filter", low_vision.tint_filter],
            ["Task Performance With Device", low_vision.task_performance_with_device],
            ["Device Recommended", low_vision.device_recommended],
        ]
        function_table = _render_pipe_table(
            "Low Vision Functional & Device Trial:",
            ["Field", "Value"],
            [[label, value] for label, value in function_rows if value],
        )
        if function_table:
            measurement_bits.append(function_table)

        plan_rows = [
            ["Lighting Advice", low_vision.lighting_advice],
            ["Non-optical Aids", low_vision.non_optical_aids],
            ["Rehab Referral", low_vision.rehab_referral],
            ["Support Referral", low_vision.support_referral],
            ["Training Required", low_vision.training_required],
            ["Follow-up Plan", low_vision.follow_up_plan],
            ["Cause of Low Vision", low_vision.cause_of_low_vision],
            ["Prognosis", low_vision.prognosis],
            ["Emotional Support", low_vision.emotional_support_notes],
            ["Charles Bonnet Screening", low_vision.charles_bonnet_screening],
            ["Final Plan", low_vision.final_plan],
        ]
        plan_table = _render_pipe_table(
            "Low Vision Plan & Support:",
            ["Field", "Value"],
            [[label, value] for label, value in plan_rows if value],
        )
        if plan_table:
            measurement_bits.append(plan_table)
    if payload.myopia_measurement:
        myopia = payload.myopia_measurement
        myopia_rows = [
            ["Measured At", myopia.measured_at.isoformat()],
            ["Age", f"{myopia.age_years:g} years"],
            ["Axial Length Right", f"{myopia.axial_length_right_mm:.2f} mm"],
            ["Axial Length Left", f"{myopia.axial_length_left_mm:.2f} mm"],
            ["Treatment Type", myopia.treatment_type],
            ["Treatment Notes", myopia.treatment_notes],
            ["Visit Notes", myopia.visit_notes],
            ["Refraction Right", myopia.refraction_right],
            ["Refraction Left", myopia.refraction_left],
        ]
        myopia_table = _render_pipe_table(
            "Myopia Management:",
            ["Field", "Value"],
            [[label, value] for label, value in myopia_rows if value],
        )
        if myopia_table:
            measurement_bits.append(myopia_table)
    for module in payload.structured_modules:
        module_type = module.module_type.strip()
        if not module_type:
            continue
        module_rows = [
            [key.replace("_", " ").title(), str(value)]
            for key, value in module.payload.items()
            if value not in (None, "", [], {})
        ]
        if not module_rows:
            continue
        module_table = _render_pipe_table(
            f"Structured Module: {module_type}",
            ["Field", "Value"],
            module_rows,
        )
        if module_table:
            measurement_bits.append(module_table)
    return "\n".join(bit for bit in measurement_bits if bit)
