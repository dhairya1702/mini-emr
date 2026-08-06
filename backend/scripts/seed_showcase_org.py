"""Add and verify deterministic optometry showcase data for an existing organization.

See backend/scripts/README.md for the production runbook and safety requirements.
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID, NAMESPACE_URL, uuid5

import psycopg
from psycopg.types.json import Jsonb


TARGET_EMAIL = "clinicos.notifications@gmail.com"
SEED_VERSION = "clinic-os-showcase-v1"


@dataclass(frozen=True)
class PatientSpec:
    key: str
    name: str
    phone: str
    dob: date
    sex: str
    reason: str
    address: str
    weight: float
    height: float
    temperature: float
    status: str
    billed: bool
    priority: str = "normal"


PATIENTS = [
    PatientSpec("aarav", "Aarav Mehta", "0000000001", date(2013, 11, 18), "male", "Progressive distance blur and myopia review", "Andheri West, Mumbai", 42.0, 153.0, 98.4, "consultation", False, "urgent"),
    PatientSpec("meera", "Meera Shah", "0000000002", date(1991, 4, 7), "female", "Routine annual eye examination", "Bandra West, Mumbai", 58.0, 162.0, 98.1, "waiting", False),
    PatientSpec("rajiv", "Rajiv Malhotra", "0000000003", date(1967, 9, 22), "male", "Raised IOP and glaucoma surveillance", "Powai, Mumbai", 78.0, 174.0, 98.6, "done", True),
    PatientSpec("nisha", "Nisha Kapoor", "0000000004", date(1997, 2, 13), "female", "Soft contact lens fitting and dryness", "Vile Parle East, Mumbai", 55.0, 165.0, 98.2, "consultation", False),
    PatientSpec("kabir", "Kabir Sethi", "0000000005", date(2002, 6, 30), "male", "RGP fitting for irregular astigmatism", "Chembur, Mumbai", 69.0, 178.0, 98.0, "waiting", False),
    PatientSpec("ananya", "Ananya Rao", "0000000006", date(1985, 1, 16), "female", "Headache and eyestrain during near work", "Dadar, Mumbai", 61.0, 164.0, 98.3, "done", True),
    PatientSpec("leela", "Leela Nair", "0000000007", date(1958, 8, 9), "female", "Low vision assessment for reading difficulty", "Thane West, Thane", 64.0, 158.0, 98.4, "done", False),
    PatientSpec("rohan", "Rohan Desai", "0000000008", date(1995, 12, 3), "male", "Visual symptoms following concussion", "Lower Parel, Mumbai", 73.0, 176.0, 98.5, "done", False),
    PatientSpec("priya", "Priya Menon", "0000000009", date(1981, 5, 25), "female", "Dryness, burning and intermittent blur", "Matunga, Mumbai", 59.0, 160.0, 98.6, "waiting", False),
    PatientSpec("vikram", "Vikram Joshi", "0000000010", date(1974, 10, 11), "male", "Diabetic retinal screening", "Goregaon East, Mumbai", 82.0, 172.0, 98.1, "done", True),
    PatientSpec("ishita", "Ishita Verma", "0000000011", date(2017, 3, 14), "female", "Amblyopia and spectacle compliance review", "Santacruz East, Mumbai", 29.0, 132.0, 98.7, "waiting", False),
    PatientSpec("sanjay", "Sanjay Bhatia", "0000000012", date(1963, 7, 2), "male", "Glare and reduced night vision", "Navi Mumbai", 76.0, 170.0, 98.2, "done", True),
    PatientSpec("tara", "Tara Iyer", "0000000013", date(1999, 9, 19), "female", "Routine refraction and spectacle update", "Colaba, Mumbai", 52.0, 161.0, 98.0, "done", False),
    PatientSpec("dev", "Dev Patel", "0000000014", date(2009, 1, 27), "male", "Sports vision and myopia review", "Borivali West, Mumbai", 56.0, 169.0, 98.3, "done", True),
    PatientSpec("farah", "Farah Khan", "0000000015", date(1988, 11, 5), "female", "Near blur and recurrent frontal headache", "Kurla West, Mumbai", 63.0, 166.0, 98.5, "done", False),
]


CATALOG = [
    ("comprehensive_exam", "Comprehensive Eye Examination", "service", Decimal("1200.00"), False, Decimal("0"), Decimal("0"), "visit"),
    ("refraction", "Refraction and Prescription", "service", Decimal("500.00"), False, Decimal("0"), Decimal("0"), "visit"),
    ("contact_lens", "Contact Lens Fitting", "service", Decimal("1800.00"), False, Decimal("0"), Decimal("0"), "fitting"),
    ("binocular", "Binocular Vision Assessment", "service", Decimal("1600.00"), False, Decimal("0"), Decimal("0"), "assessment"),
    ("low_vision", "Low Vision Assessment", "service", Decimal("2200.00"), False, Decimal("0"), Decimal("0"), "assessment"),
    ("myopia", "Myopia Management Review", "service", Decimal("1400.00"), False, Decimal("0"), Decimal("0"), "review"),
    ("tbi", "Neurovision Assessment", "service", Decimal("2500.00"), False, Decimal("0"), Decimal("0"), "assessment"),
    ("lubricant", "Preservative-free Lubricant Drops", "medicine", Decimal("420.00"), True, Decimal("4"), Decimal("8"), "bottle"),
    ("lid_wipes", "Daily Lid Hygiene Wipes", "medicine", Decimal("360.00"), True, Decimal("22"), Decimal("10"), "box"),
    ("lens_solution", "Multipurpose Lens Solution", "medicine", Decimal("650.00"), True, Decimal("6"), Decimal("8"), "bottle"),
]


def stable_id(org_id: UUID, kind: str, key: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"{SEED_VERSION}:{org_id}:{kind}:{key}")


def json_data(value: Any) -> Jsonb:
    return Jsonb(value)


def age_on(dob: date, day: date) -> int:
    return day.year - dob.year - ((day.month, day.day) < (dob.month, dob.day))


def eye_exam_payload(index: int, *, glaucoma: bool = False, cataract: bool = False) -> dict[str, Any]:
    sphere_od = f"{-1.00 - (index % 5) * 0.50:+.2f}"
    sphere_os = f"{-0.75 - (index % 4) * 0.50:+.2f}"
    cyl_od = f"{-0.50 - (index % 2) * 0.25:+.2f}"
    cyl_os = f"{-0.50 - ((index + 1) % 2) * 0.25:+.2f}"
    iop_od = "23" if glaucoma else str(14 + index % 4)
    iop_os = "22" if glaucoma else str(14 + (index + 1) % 4)
    lens_finding = "Early nuclear sclerosis" if cataract else "Clear"
    disc_finding = "C/D 0.65, rims intact" if glaucoma else "C/D 0.30, healthy rim"
    return {
        "version": 2,
        "case_sheet": {
            "visual_acuity": {
                "right": {"ucva_distance": "6/18", "ucva_near": "N8", "pinhole_distance": "6/9", "glasses_distance": "6/6", "glasses_near": "N6", "comments": "Reliable responses"},
                "left": {"ucva_distance": "6/12", "ucva_near": "N8", "pinhole_distance": "6/6", "glasses_distance": "6/6", "glasses_near": "N6", "comments": "Reliable responses"},
                "comments": "Binocular vision comfortable with habitual correction.",
            },
            "iop": {
                "right": {"value": iop_od, "method": "Goldmann applanation", "time": "10:20", "comments": "Good fixation"},
                "left": {"value": iop_os, "method": "Goldmann applanation", "time": "10:22", "comments": "Good fixation"},
            },
            "autorefraction": {
                "dry": {
                    "right": {"sphere": sphere_od, "cylinder": cyl_od, "axis": "175"},
                    "left": {"sphere": sphere_os, "cylinder": cyl_os, "axis": "010"},
                },
                "dilated": {
                    "right": {"sphere": sphere_od, "cylinder": cyl_od, "axis": "175"},
                    "left": {"sphere": sphere_os, "cylinder": cyl_os, "axis": "010"},
                },
            },
            "refraction": {
                "dry": {
                    "right": {"sphere": sphere_od, "cylinder": cyl_od, "axis": "175", "distance_vision": "6/6", "add": "+1.00", "near_vision": "N6", "retinoscopy": "With movement neutralized"},
                    "left": {"sphere": sphere_os, "cylinder": cyl_os, "axis": "010", "distance_vision": "6/6", "add": "+1.00", "near_vision": "N6", "retinoscopy": "With movement neutralized"},
                    "comments": "Comfortable binocular acceptance.",
                },
                "dilated": {
                    "right": {"sphere": sphere_od, "cylinder": cyl_od, "axis": "175", "distance_vision": "6/6", "add": "", "near_vision": ""},
                    "left": {"sphere": sphere_os, "cylinder": cyl_os, "axis": "010", "distance_vision": "6/6", "add": "", "near_vision": ""},
                    "drug_used": "Tropicamide 1%",
                    "comments": "Cycloplegic findings stable.",
                },
            },
            "prescriptions": {
                "pgp_1": {"eyes": {"right": {"sphere": sphere_od, "cylinder": cyl_od, "axis": "175", "vision": "6/6", "add": "+1.00"}, "left": {"sphere": sphere_os, "cylinder": cyl_os, "axis": "010", "vision": "6/6", "add": "+1.00"}}, "lens_type": "Single vision", "lens_material": "High index", "lens_tint": "Clear", "ipd": "62"},
                "distance": {"eyes": {"right": {"sphere": sphere_od, "cylinder": cyl_od, "axis": "175", "vision": "6/6", "add": ""}, "left": {"sphere": sphere_os, "cylinder": cyl_os, "axis": "010", "vision": "6/6", "add": ""}}, "lens_type": "Single vision", "lens_material": "1.60 index", "lens_tint": "UV clear", "ipd": "62"},
                "dispensing": {"frame_material": "Acetate", "frame_size": "Medium", "diameter": "68", "prism": "Nil", "base": "", "fitting_height": "20"},
                "advice": "Use for distance and classroom or driving tasks as discussed.",
            },
            "retinoscopy": {
                "right": {"horizontal": sphere_od, "vertical": cyl_od, "va": "6/6", "ha": "175", "working_distance": "67 cm", "drug_used": "None", "comments": "Clear reflex"},
                "left": {"horizontal": sphere_os, "vertical": cyl_os, "va": "6/6", "ha": "010", "working_distance": "67 cm", "drug_used": "None", "comments": "Clear reflex"},
            },
            "keratometry": {
                "right": {"k1": "42.25", "k1_axis": "180", "k2": "43.00", "k2_axis": "090", "average_k": "42.63", "k_cylinder": "0.75"},
                "left": {"k1": "42.00", "k1_axis": "175", "k2": "42.75", "k2_axis": "085", "average_k": "42.38", "k_cylinder": "0.75"},
                "comments": "Regular mires in both eyes.",
            },
            "amsler": {"right": {"status": "Normal", "comments": "No distortion"}, "left": {"status": "Normal", "comments": "No distortion"}},
            "colour_vision": {"right": {"result": "Ishihara 14/14"}, "left": {"result": "Ishihara 14/14"}},
            "contrast_sensitivity": {"right": {"value": "1.80", "comments": "Within expected range"}, "left": {"value": "1.80", "comments": "Within expected range"}},
            "orthoptics": {"screening": "Full ocular movements; no manifest deviation."},
            "additional_tests": {"comments": "Pupils equal and reactive; no RAPD."},
            "examination": {
                "general": "Normal", "one_eyed": "No", "squint": "No",
                "eyes": {
                    "right": {"Appearance": {"status": "Normal", "finding": "Quiet eye"}, "Conjunctiva": {"status": "Normal", "finding": "White and quiet"}, "Cornea": {"status": "Normal", "finding": "Clear"}, "Anterior chamber (AC)": {"status": "Normal", "finding": "Deep and quiet"}, "Pupil": {"status": "Normal", "finding": "Round and reactive"}, "Lens": {"status": "Normal" if not cataract else "Abnormal", "finding": lens_finding}, "Fundus": {"status": "Normal" if not glaucoma else "Abnormal", "finding": disc_finding}},
                    "left": {"Appearance": {"status": "Normal", "finding": "Quiet eye"}, "Conjunctiva": {"status": "Normal", "finding": "White and quiet"}, "Cornea": {"status": "Normal", "finding": "Clear"}, "Anterior chamber (AC)": {"status": "Normal", "finding": "Deep and quiet"}, "Pupil": {"status": "Normal", "finding": "Round and reactive"}, "Lens": {"status": "Normal" if not cataract else "Abnormal", "finding": lens_finding}, "Fundus": {"status": "Normal" if not glaucoma else "Abnormal", "finding": disc_finding}},
                },
                "comments": "Anterior and posterior segment findings documented; review advised as planned.",
            },
        },
        "objective": [{"eye": "right", "sphere": sphere_od, "cylinder": cyl_od, "axis": "175", "vision": "6/6"}, {"eye": "left", "sphere": sphere_os, "cylinder": cyl_os, "axis": "010", "vision": "6/6"}],
        "subjective": [{"eye": "right", "sphere": sphere_od, "cylinder": cyl_od, "axis": "175", "vision": "6/6"}, {"eye": "left", "sphere": sphere_os, "cylinder": cyl_os, "axis": "010", "vision": "6/6"}],
        "cycloplegic_dilated": [{"eye": "right", "sphere": sphere_od, "cylinder": cyl_od, "axis": "175", "vision": "6/6"}, {"eye": "left", "sphere": sphere_os, "cylinder": cyl_os, "axis": "010", "vision": "6/6"}],
    }


def history_payload(spec: PatientSpec, index: int) -> dict[str, Any]:
    wears_contacts = spec.key in {"nisha", "kabir"}
    return {
        "ocular": "Previous spectacles; no ocular surgery or trauma reported.",
        "ocular_conditions": [{"condition": "Refractive error", "comment": "Stable with current correction"}],
        "systemic": "General health reviewed during consultation.",
        "systemic_conditions": [{"condition": "Diabetes", "comment": "Under physician care"}] if spec.key == "vikram" else [],
        "no_known_allergies": True,
        "drug_allergies": "", "contact_allergies": "", "food_allergies": "",
        "drug_allergy_entries": [], "contact_allergy_entries": [], "food_allergy_entries": [], "allergies": "",
        "current_medications": "Metformin as prescribed" if spec.key == "vikram" else "No regular ocular medication",
        "family": "Family history of glaucoma" if spec.key == "rajiv" else "No significant ocular family history",
        "wears_glasses": True, "glasses_since": "Several years", "glasses_usage": "Full time", "lens_type": "Single vision", "prescription_age": "12 months", "pd": "62",
        "right_power": {"sphere": f"{-1.00 - index % 4 * 0.50:+.2f}", "cylinder": "-0.50", "axis": "175", "add": ""},
        "left_power": {"sphere": f"{-0.75 - index % 3 * 0.50:+.2f}", "cylinder": "-0.50", "axis": "010", "add": ""},
        "glasses_notes": "Comfortable with current frame; prescription review due.",
        "wears_contact_lenses": wears_contacts, "contacts_since": "3 years" if wears_contacts else "", "contact_lens_type": "Daily soft" if spec.key == "nisha" else "RGP" if spec.key == "kabir" else "",
        "right_contact_power": {"sphere": "-2.50" if wears_contacts else "", "cylinder": "", "axis": "", "add": ""},
        "left_contact_power": {"sphere": "-2.25" if wears_contacts else "", "cylinder": "", "axis": "", "add": ""},
        "contact_lens_notes": "Handling and hygiene reviewed." if wears_contacts else "",
    }


def contact_lens_payload(kind: str) -> dict[str, Any]:
    return {
        "case_sheet_type": kind,
        "case_sheets": {"general": {"assessment": "Suitable for lens wear"}, "soft": {"fit": "Well centered with adequate movement"} if kind == "soft" else {}, "rgp": {"fluorescein_pattern": "Alignment fit"} if kind == "rgp" else {}, "scleral": {}},
        "workup": {"reason_for_wear": "Full-day clear vision", "previous_lens_experience": "Experienced wearer", "wearing_requirements": "Work and social use", "occupation_environment": "Air-conditioned office", "preferred_modality": "Daily wear", "lids_lashes": "Healthy", "conjunctiva": "Quiet", "cornea": "Clear", "tear_film": "Adequate", "keratometry_right": "42.25 / 43.00", "keratometry_left": "42.00 / 42.75", "tbut_right": "9 sec", "tbut_left": "10 sec"},
        "trials": [{"trial": 1, "brand": "Diagnostic lens", "comfort": "8/10", "movement": "0.5 mm", "vision": "6/6"}, {"trial": 2, "brand": "Final trial", "comfort": "9/10", "movement": "0.4 mm", "vision": "6/6"}],
        "dispensing": {"dispensed_on": datetime.now(UTC).date().isoformat(), "pre_insertion_findings": "Clear cornea and quiet conjunctiva", "hygiene_explained": True, "insertion_removal_taught": True, "patient_confidence": "Independent", "care_solution": "Multipurpose solution", "care_kit_given": True, "instruction_booklet_given": True, "wearing_schedule": "Build to 8 hours", "replacement_schedule": "Monthly", "advice": "No overnight wear; stop for redness or pain."},
        "follow_ups": [{"day": "1 week", "comfort": "Good", "vision": "6/6", "fit": "Stable"}],
        "wearing_goal": "Comfortable all-day distance vision", "current_lens_brand": "Monthly silicone hydrogel", "current_wear_schedule": "8 hours daily", "replacement_frequency": "Monthly", "comfort_issues": "Mild end-of-day awareness", "dryness_symptoms": "Occasional in air conditioning", "handling_issues": "None", "care_solution": "Multipurpose solution", "allergy_history": "None", "assessment_notes": "Good candidate after hygiene review", "lens_type": "Soft toric" if kind == "soft" else "RGP", "manufacturer": "Diagnostic set", "brand": "Final trial lens", "wear_modality": "Daily wear", "trial_lens_used": "Trial 2 accepted", "vendor_name": "Clinic optical", "quantity": "2 lenses", "special_instructions": "Return for scheduled fit review",
        "eyes": [{"eye": "right", "sphere": "-2.50", "cylinder": "-0.75", "axis": "180", "base_curve": "8.6" if kind == "soft" else "7.80", "diameter": "14.2" if kind == "soft" else "9.6", "visual_acuity": "6/6", "over_refraction": "Plano", "fit_notes": "Centered with adequate movement", "material": "Silicone hydrogel" if kind == "soft" else "Fluorosilicone acrylate", "design": "Toric" if kind == "soft" else "Aspheric"}, {"eye": "left", "sphere": "-2.25", "cylinder": "-0.75", "axis": "010", "base_curve": "8.6" if kind == "soft" else "7.85", "diameter": "14.2" if kind == "soft" else "9.6", "visual_acuity": "6/6", "over_refraction": "Plano", "fit_notes": "Centered with adequate movement", "material": "Silicone hydrogel" if kind == "soft" else "Fluorosilicone acrylate", "design": "Toric" if kind == "soft" else "Aspheric"}],
    }


def binocular_payload() -> dict[str, Any]:
    return {"history": {"main_complaints": "Frontal headache and eyestrain after 30 minutes of near work", "spectacle_use_history": "Uses distance correction", "near_work_hours": "8 hours daily", "associated_symptoms": "Intermittent blur and loss of place", "previous_vision_therapy": "None", "general_health_medications": "No relevant medication"}, "refraction": {"right": "-0.50 DS 6/6", "left": "-0.50 DS 6/6"}, "assessment_setup": {"working_distance": "40 cm", "correction_worn": "Best correction"}, "sensory_evaluation": {"stereopsis": {"near": "60 arc sec"}, "worth_four_dot": {"distance": "Fusion", "near": "Fusion"}}, "motor_evaluation": {"cover_test": {"distance": "Orthophoria", "near": "6 XP"}, "npc_accommodative_target": {"objective": "10/14 cm", "subjective": "9/13 cm"}, "vergence": {"bo_near": "12/18/10", "bi_near": "14/18/12"}, "accommodation": {"facility": "6 cpm with +/-2.00"}}, "impression": "Convergence insufficiency with reduced positive fusional vergence", "advice": "Near-task breaks and structured vergence exercises", "follow_up": "Review in 6 weeks"}


def low_vision_payload() -> dict[str, Any]:
    return {"case_sheet": {"initial": {"ocular_diagnosis": "Dry age-related macular degeneration", "presenting_distance_va": "6/60", "presenting_near_va": "N36"}, "plan": {"problem_summary": "Reading and face-recognition difficulty", "optical_devices": "3x illuminated stand magnifier"}}, "primary_complaint": "Unable to read medicine labels and newspaper print", "goals": "Read labels independently and improve television viewing", "reading_difficulty": True, "distance_difficulty": True, "mobility_difficulty": False, "face_recognition_difficulty": True, "glare_complaints": True, "lighting_difficulty": True, "distance_visual_acuity": "6/60", "near_visual_acuity": "N36", "habitual_correction": "+2.50 add", "best_correction": "6/36", "contrast_sensitivity": "Reduced", "glare_function": "Worse outdoors", "central_vision": "Central distortion", "visual_field": "Peripheral field functional", "functional_reading": "N12 with 3x illuminated magnifier", "sustained_near_task": "10 minutes", "tv_phone_mobility_notes": "Uses phone magnification", "illumination_response": "Improves with cool directional task light", "posture_working_distance": "20 cm with device", "magnifier_type": "Illuminated stand", "magnification": "3x", "near_add": "+6.00", "electronic_aid": "Tablet accessibility features", "tint_filter": "Amber fit-over", "task_performance_with_device": "Reads labels accurately", "device_recommended": "3x illuminated stand magnifier", "lighting_advice": "Directional LED task lamp", "non_optical_aids": "Large-print labels and contrast markings", "rehab_referral": "Low vision rehabilitation", "support_referral": "Family education", "training_required": "Two device-training sessions", "follow_up_plan": "Review in 8 weeks", "cause_of_low_vision": "Macular degeneration", "prognosis": "Functional improvement expected with aids", "emotional_support_notes": "Patient engaged and goal focused", "charles_bonnet_screening": "Negative", "final_plan": "Dispense magnifier and reinforce accessibility strategies"}


def tbi_payload() -> dict[str, Any]:
    return {"history": {"injury_date": "6 weeks ago", "mechanism": "Sports-related concussion", "loss_of_consciousness": "No", "current_symptoms": "Reading fatigue, light sensitivity and intermittent dizziness"}, "symptoms": {"headache": "4/10 after near work", "photophobia": "Moderate", "dizziness": "Intermittent", "blur": "Near tasks", "diplopia": "Occasional at near"}, "oculomotor": {"pursuits": "Mild saccadic intrusions", "saccades": "Reduced endurance", "npc": "12/16 cm", "accommodation": "Reduced facility"}, "vestibular": {"vor": "Provokes mild dizziness", "balance": "Stable stance"}, "assessment": "Post-concussion visual dysfunction with convergence and accommodative findings", "plan": "Pacing, tinted lens trial and graded oculomotor rehabilitation", "follow_up": "4 weeks"}


def execute_seed(connection: psycopg.Connection[Any], *, org_id: UUID, user_id: UUID) -> dict[str, int]:
    now = datetime.now(UTC).replace(second=0, microsecond=0)
    today = now.date()
    counts = {"patients": 0, "visits": 0, "appointments": 0, "notes": 0, "tracks": 0, "myopia": 0, "histories": 0, "catalog": 0, "invoices": 0, "follow_ups": 0, "case_studies": 0}
    patient_ids = {spec.key: stable_id(org_id, "patient", spec.key) for spec in PATIENTS}
    visit_ids = {spec.key: stable_id(org_id, "visit", spec.key) for spec in PATIENTS}

    with connection.cursor() as cursor:
        for index, spec in enumerate(PATIENTS):
            patient_id = patient_ids[spec.key]
            visit_id = visit_ids[spec.key]
            created_at = now - timedelta(days=15 - index)
            cursor.execute(
                """
                insert into public.patients (
                  id, org_id, name, phone, email, address, reason, date_of_birth, sex_at_birth,
                  gender_identity, age, weight, height, temperature, status, billed, queue_priority,
                  stage_entered_at, queue_position, current_visit_id, created_at, last_visit_at
                ) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,'',%s,%s,%s,%s,%s,%s,%s,%s,%s,null,%s,%s)
                on conflict (id) do nothing
                """,
                (patient_id, org_id, spec.name, spec.phone, TARGET_EMAIL, spec.address, spec.reason, spec.dob, spec.sex, age_on(spec.dob, today), spec.weight, spec.height, spec.temperature, spec.status, spec.billed, spec.priority, now - timedelta(hours=index), index + 1, created_at, created_at),
            )
            counts["patients"] += cursor.rowcount
            cursor.execute(
                """
                insert into public.patient_visits (
                  id, org_id, patient_id, name, phone, email, address, reason, date_of_birth,
                  sex_at_birth, gender_identity, age, weight, height, temperature, source, visit_kind, created_at
                ) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'',%s,%s,%s,%s,'queue','new',%s)
                on conflict (id) do nothing
                """,
                (visit_id, org_id, patient_id, spec.name, spec.phone, TARGET_EMAIL, spec.address, spec.reason, spec.dob, spec.sex, age_on(spec.dob, today), spec.weight, spec.height, spec.temperature, created_at),
            )
            counts["visits"] += cursor.rowcount
            cursor.execute("update public.patients set current_visit_id=%s where org_id=%s and id=%s and current_visit_id is null", (visit_id, org_id, patient_id))

        for index, key in enumerate(["aarav", "rajiv", "nisha", "ananya", "leela", "rohan"]):
            spec = next(item for item in PATIENTS if item.key == key)
            appointment_id = stable_id(org_id, "appointment", key)
            scheduled_for = now + timedelta(days=index // 2, hours=2 + (index % 2) * 2)
            cursor.execute(
                """
                insert into public.appointments (id,org_id,name,phone,email,address,reason,date_of_birth,sex_at_birth,gender_identity,age,weight,height,temperature,scheduled_for,status,created_at)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,'',%s,%s,%s,%s,%s,'scheduled',%s)
                on conflict (id) do nothing
                """,
                (appointment_id, org_id, spec.name, spec.phone, TARGET_EMAIL, spec.address, spec.reason, spec.dob, spec.sex, age_on(spec.dob, today), spec.weight, spec.height, spec.temperature, scheduled_for, now - timedelta(days=1)),
            )
            counts["appointments"] += cursor.rowcount

        catalog_ids: dict[str, UUID] = {}
        for key, name, item_type, price, track_inventory, stock, threshold, unit in CATALOG:
            cursor.execute("select id from public.catalog_items where org_id=%s and lower(name)=lower(%s) limit 1", (org_id, name))
            existing = cursor.fetchone()
            if existing:
                catalog_ids[key] = UUID(str(existing[0]))
                continue
            item_id = stable_id(org_id, "catalog", key)
            catalog_ids[key] = item_id
            cursor.execute(
                """
                insert into public.catalog_items (id,org_id,name,item_type,description,is_active,default_price,track_inventory,stock_quantity,low_stock_threshold,unit,aliases)
                values (%s,%s,%s,%s,%s,true,%s,%s,%s,%s,%s,%s)
                on conflict (id) do nothing
                """,
                (item_id, org_id, name, item_type, f"Clinic catalog item for {name.lower()}.", price, track_inventory, stock, threshold, unit, json_data([])),
            )
            counts["catalog"] += cursor.rowcount

        eye_exam_tracks: dict[str, dict[str, Any]] = {}
        for index, spec in enumerate(PATIENTS):
            payload = eye_exam_payload(index, glaucoma=spec.key == "rajiv", cataract=spec.key == "sanjay")
            eye_exam_tracks[spec.key] = payload
            measured_at = now - timedelta(days=index % 7, hours=2)
            track_id = stable_id(org_id, "track", f"{spec.key}:eye_exam:current")
            summary = f"Complete eye examination · OD {payload['case_sheet']['refraction']['dry']['right']['distance_vision']} · OS {payload['case_sheet']['refraction']['dry']['left']['distance_vision']}"
            cursor.execute(
                """
                insert into public.longitudinal_tracks (id,org_id,patient_id,track_type,measured_at,summary_fields,raw_payload,derived_metrics,created_at)
                values (%s,%s,%s,'eye_exam',%s,%s,%s,%s,%s)
                on conflict (id) do nothing
                """,
                (track_id, org_id, patient_ids[spec.key], measured_at, json_data({"summary": summary}), json_data(payload), json_data({}), measured_at),
            )
            counts["tracks"] += cursor.rowcount
            if spec.key in {"aarav", "rajiv", "nisha"}:
                prior_id = stable_id(org_id, "track", f"{spec.key}:eye_exam:prior")
                prior_at = now - timedelta(days=180 + index * 10)
                prior_payload = eye_exam_payload(max(0, index - 1), glaucoma=spec.key == "rajiv")
                cursor.execute(
                    """
                    insert into public.longitudinal_tracks (id,org_id,patient_id,track_type,measured_at,summary_fields,raw_payload,derived_metrics,created_at)
                    values (%s,%s,%s,'eye_exam',%s,%s,%s,%s,%s)
                    on conflict (id) do nothing
                    """,
                    (prior_id, org_id, patient_ids[spec.key], prior_at, json_data({"summary": "Previous comprehensive eye examination"}), json_data(prior_payload), json_data({}), prior_at),
                )
                counts["tracks"] += cursor.rowcount

            history_id = stable_id(org_id, "history", spec.key)
            history = history_payload(spec, index)
            cursor.execute(
                """
                insert into public.patient_optometry_histories (id,org_id,patient_id,payload,revision,updated_by,created_at,updated_at)
                values (%s,%s,%s,%s,1,%s,%s,%s)
                on conflict (org_id,patient_id) do nothing
                """,
                (history_id, org_id, patient_ids[spec.key], json_data(history), user_id, measured_at, measured_at),
            )
            counts["histories"] += cursor.rowcount

        specialty_tracks = [
            ("nisha", "contact_lens", contact_lens_payload("soft"), "Soft CL · 2 trials · 1 follow-up"),
            ("kabir", "contact_lens", contact_lens_payload("rgp"), "RGP · alignment fit · final lens accepted"),
            ("ananya", "binocular_vision", binocular_payload(), "Convergence insufficiency · NPC 10/14 cm"),
            ("farah", "binocular_vision", binocular_payload(), "Near-work eyestrain · reduced vergence reserves"),
            ("leela", "low_vision", low_vision_payload(), "Macular degeneration · 3x illuminated magnifier"),
            ("rohan", "tbi_evaluation", tbi_payload(), "Post-concussion visual dysfunction · rehabilitation plan"),
        ]
        for offset, (key, track_type, payload, summary) in enumerate(specialty_tracks):
            measured_at = now - timedelta(days=offset + 1)
            cursor.execute(
                """
                insert into public.longitudinal_tracks (id,org_id,patient_id,track_type,measured_at,summary_fields,raw_payload,derived_metrics,created_at)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                on conflict (id) do nothing
                """,
                (stable_id(org_id, "track", f"{key}:{track_type}"), org_id, patient_ids[key], track_type, measured_at, json_data({"summary": summary}), json_data(payload), json_data({}), measured_at),
            )
            counts["tracks"] += cursor.rowcount

        for key, base_age, base_od, base_os in [("aarav", 10.0, 24.10, 24.05), ("ishita", 7.0, 23.20, 23.18), ("dev", 13.0, 24.00, 23.96)]:
            for step in range(4):
                measured_at = now - timedelta(days=(3 - step) * 180)
                measurement_id = stable_id(org_id, "myopia", f"{key}:{step}")
                cursor.execute(
                    """
                    insert into public.myopia_measurements (id,org_id,patient_id,measured_at,age_years,axial_length_right_mm,axial_length_left_mm,treatment_type,treatment_notes,visit_notes,refraction_right,refraction_left,created_at)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    on conflict (id) do nothing
                    """,
                    (measurement_id, org_id, patient_ids[key], measured_at, base_age + step * 0.5, base_od + step * 0.12, base_os + step * 0.11, "Low-dose atropine and myopia-control spectacles", "Adherence and outdoor-time guidance reviewed", "Axial length and cycloplegic refraction recorded", f"{-2.00 - step * 0.50:+.2f} DS", f"{-1.75 - step * 0.50:+.2f} DS", measured_at),
                )
                counts["myopia"] += cursor.rowcount

        note_keys = ["aarav", "rajiv", "nisha", "ananya", "leela", "rohan", "priya", "vikram", "sanjay", "dev", "farah"]
        for index, key in enumerate(note_keys):
            spec = next(item for item in PATIENTS if item.key == key)
            note_id = stable_id(org_id, "note", key)
            note_at = now - timedelta(days=index + 1)
            modules = [{"module_type": "eye_exam", "payload": eye_exam_tracks[key]}]
            for candidate_key, track_type, payload, _ in specialty_tracks:
                if candidate_key == key:
                    modules.append({"module_type": track_type, "payload": payload})
            content = f"CONSULTATION NOTE\n\nPatient: {spec.name}\nPresenting concern: {spec.reason}.\n\nExamination: Visual acuity, refraction, intraocular pressure, anterior segment and posterior segment findings were reviewed and documented in the structured examination.\n\nAssessment: Findings discussed with the patient. No emergency ocular warning signs identified during this visit.\n\nPlan: Updated correction and condition-specific advice provided. Return precautions explained. Follow-up arranged according to the clinical plan."
            extractions = {"services_performed": [{"name": "Comprehensive Eye Examination", "quantity": 1, "evidence": "Completed during this visit"}], "medications_prescribed": []}
            cursor.execute(
                """
                insert into public.notes (id,org_id,patient_id,visit_id,content,status,version_number,root_note_id,snapshot_content,asset_payload,snapshot_asset_payload,structured_modules,clinical_extractions,snapshot_clinical_extractions,optometry_history,snapshot_optometry_history,finalized_at,created_at)
                values (%s,%s,%s,%s,%s,'final',1,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                on conflict (id) do nothing
                """,
                (note_id, org_id, patient_ids[key], visit_ids[key], content, note_id, content, json_data([]), json_data([]), json_data(modules), json_data(extractions), json_data(extractions), json_data({"revision": 1, "payload": history_payload(spec, index)}), json_data({"revision": 1, "payload": history_payload(spec, index)}), note_at, note_at),
            )
            counts["notes"] += cursor.rowcount

        invoice_plan = [
            ("rajiv", "paid", Decimal("1700.00"), [("comprehensive_exam", 1), ("refraction", 1)]),
            ("nisha", "partial", Decimal("1200.00"), [("contact_lens", 1), ("lens_solution", 1)]),
            ("ananya", "paid", Decimal("1600.00"), [("binocular", 1)]),
            ("leela", "unpaid", Decimal("0.00"), [("low_vision", 1)]),
            ("rohan", "partial", Decimal("1000.00"), [("tbi", 1)]),
            ("priya", "unpaid", Decimal("0.00"), [("comprehensive_exam", 1), ("lubricant", 2)]),
            ("vikram", "paid", Decimal("1200.00"), [("comprehensive_exam", 1)]),
            ("dev", "paid", Decimal("1400.00"), [("myopia", 1)]),
        ]
        catalog_by_key = {item[0]: item for item in CATALOG}
        for index, (key, payment_status, amount_paid, lines) in enumerate(invoice_plan):
            invoice_id = stable_id(org_id, "invoice", key)
            total = sum(catalog_by_key[item_key][3] * quantity for item_key, quantity in lines)
            completed_at = now - timedelta(days=index) if payment_status == "paid" else None
            paid_at = completed_at if payment_status == "paid" else None
            cursor.execute(
                """
                insert into public.invoices (id,org_id,patient_id,visit_id,subtotal,tax_total,cgst_total,sgst_total,total,supplier_gstin,payment_status,amount_paid,paid_at,completed_at,completed_by,created_at)
                values (%s,%s,%s,%s,%s,0,0,0,%s,'',%s,%s,%s,%s,%s,%s)
                on conflict (id) do nothing
                """,
                (invoice_id, org_id, patient_ids[key], visit_ids[key], total, total, payment_status, amount_paid, paid_at, completed_at, user_id if completed_at else None, now - timedelta(days=index)),
            )
            counts["invoices"] += cursor.rowcount
            for line_index, (item_key, quantity) in enumerate(lines):
                item = catalog_by_key[item_key]
                unit_price = item[3]
                cursor.execute(
                    """
                    insert into public.invoice_items (id,org_id,invoice_id,catalog_item_id,item_type,label,quantity,unit_price,line_total,hsn_sac_code,taxable_value,tax_amount,cgst_amount,sgst_amount,created_at)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,'',%s,0,0,0,%s)
                    on conflict (id) do nothing
                    """,
                    (stable_id(org_id, "invoice-item", f"{key}:{line_index}"), org_id, invoice_id, catalog_ids[item_key], item[2], item[1], quantity, unit_price, unit_price * quantity, unit_price * quantity, now - timedelta(days=index)),
                )

        follow_up_plan = [
            ("aarav", timedelta(hours=6), "Review myopia-control plan and axial-length findings"),
            ("nisha", timedelta(hours=12), "Contact lens comfort and fit review"),
            ("ananya", timedelta(hours=20), "Binocular vision exercise review"),
            ("rajiv", timedelta(days=2), "Repeat IOP and optic nerve assessment"),
            ("leela", timedelta(days=4), "Low vision device training review"),
            ("rohan", timedelta(days=7), "Neurovision symptom and rehabilitation review"),
        ]
        for key, delta, notes in follow_up_plan:
            follow_up_id = stable_id(org_id, "follow-up", key)
            cursor.execute(
                """
                insert into public.follow_ups (id,org_id,patient_id,created_by,scheduled_for,notes,status,reminder_sent_at,created_at)
                values (%s,%s,%s,%s,%s,%s,'scheduled',null,%s)
                on conflict (id) do nothing
                """,
                (follow_up_id, org_id, patient_ids[key], user_id, now + delta, notes, now),
            )
            counts["follow_ups"] += cursor.rowcount
        cursor.execute(
            """
            insert into public.follow_ups (id,org_id,patient_id,created_by,scheduled_for,notes,status,completed_at,reminder_sent_at,created_at)
            values (%s,%s,%s,%s,%s,%s,'completed',%s,%s,%s)
            on conflict (id) do nothing
            """,
            (stable_id(org_id, "follow-up", "vikram-completed"), org_id, patient_ids["vikram"], user_id, now - timedelta(days=14), "Diabetic retinal screening review", now - timedelta(days=14), now - timedelta(days=15), now - timedelta(days=30)),
        )
        counts["follow_ups"] += cursor.rowcount

        for key, title in [("aarav", "Progressive childhood myopia management"), ("rohan", "Post-concussion visual rehabilitation")]:
            case_id = stable_id(org_id, "case-study", key)
            content = f"CASE OVERVIEW\n\n{title}.\n\nThe longitudinal record includes presenting symptoms, structured clinical examinations, serial measurements, management decisions and planned follow-up. The chronology highlights the relationship between measured findings, functional concerns and the ongoing care plan."
            snapshot = {"patient_id": str(patient_ids[key]), "notes": [str(stable_id(org_id, "note", key))], "generated_at": now.isoformat()}
            cursor.execute(
                """
                insert into public.case_studies (id,org_id,patient_id,title,status,template_key,anonymized,author_instructions,generated_content,source_snapshot,created_by,created_at,updated_at)
                values (%s,%s,%s,%s,'final','teaching_rounds',true,'Highlight longitudinal findings and response to management.',%s,%s,%s,%s,%s)
                on conflict (id) do update set
                  generated_content=excluded.generated_content,
                  source_snapshot=excluded.source_snapshot,
                  updated_at=excluded.updated_at
                """,
                (case_id, org_id, patient_ids[key], title, content, json_data(snapshot), user_id, now, now),
            )
            counts["case_studies"] += cursor.rowcount

    return counts


def organization_summary(connection: psycopg.Connection[Any], identifier: str) -> dict[str, Any]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select u.id, u.org_id, u.name, u.role, o.name, s.clinic_specialty, s.timezone,
              s.email_sender_mode, s.sender_email,
              (select count(*) from public.patients p where p.org_id=u.org_id),
              (select count(*) from public.notes n where n.org_id=u.org_id),
              (select count(*) from public.invoices i where i.org_id=u.org_id),
              (select count(*) from public.follow_ups f where f.org_id=u.org_id)
            from public.clinic_users u
            join public.organizations o on o.id=u.org_id
            left join public.clinic_settings s on s.org_id=u.org_id
            where lower(u.identifier)=lower(%s)
            limit 1
            """,
            (identifier,),
        )
        row = cursor.fetchone()
    if not row:
        raise SystemExit(f"Account not found: {identifier}")
    return {
        "user_id": str(row[0]), "org_id": str(row[1]), "user_name": str(row[2] or ""), "role": str(row[3]),
        "organization": str(row[4]), "specialty": str(row[5] or ""), "timezone": str(row[6] or ""),
        "email_sender_mode": str(row[7] or ""), "sender_email": str(row[8] or ""),
        "existing": {"patients": int(row[9]), "notes": int(row[10]), "invoices": int(row[11]), "follow_ups": int(row[12])},
    }


def verification_summary(connection: psycopg.Connection[Any], org_id: UUID) -> dict[str, Any]:
    patient_ids = [stable_id(org_id, "patient", spec.key) for spec in PATIENTS]
    with connection.cursor() as cursor:
        result: dict[str, int] = {}
        for label, table in [("patients", "patients"), ("notes", "notes"), ("invoices", "invoices"), ("follow_ups", "follow_ups"), ("tracks", "longitudinal_tracks"), ("myopia", "myopia_measurements"), ("appointments", "appointments")]:
            cursor.execute(f"select count(*) from public.{table} where org_id=%s and patient_id = any(%s::uuid[])" if table not in {"patients", "appointments"} else f"select count(*) from public.{table} where org_id=%s and " + ("id = any(%s::uuid[])" if table == "patients" else "lower(email)=lower(%s)"), (org_id, patient_ids) if table != "appointments" else (org_id, TARGET_EMAIL))
            result[label] = int(cursor.fetchone()[0])
        cursor.execute("select count(*) from public.catalog_items where org_id=%s and id = any(%s::uuid[])", (org_id, [stable_id(org_id, "catalog", item[0]) for item in CATALOG]))
        result["new_catalog_items"] = int(cursor.fetchone()[0])
        cursor.execute("select count(*) from public.follow_ups where org_id=%s and patient_id=any(%s::uuid[]) and status='scheduled' and reminder_sent_at is null", (org_id, patient_ids))
        result["pending_reminder_emails"] = int(cursor.fetchone()[0])
        cursor.execute("select count(*) from public.patients where org_id=%s and id=any(%s::uuid[]) and lower(email)<>lower(%s)", (org_id, patient_ids, TARGET_EMAIL))
        result["patient_email_mismatches"] = int(cursor.fetchone()[0])
        cursor.execute("select track_type, count(*) from public.longitudinal_tracks where org_id=%s and patient_id=any(%s::uuid[]) group by track_type order by track_type", (org_id, patient_ids))
        result["track_types"] = {str(row[0]): int(row[1]) for row in cursor.fetchall()}
        cursor.execute("select payment_status, count(*) from public.invoices where org_id=%s and patient_id=any(%s::uuid[]) group by payment_status order by payment_status", (org_id, patient_ids))
        result["invoice_statuses"] = {str(row[0]): int(row[1]) for row in cursor.fetchall()}
        cursor.execute("select status, count(*) from public.follow_ups where org_id=%s and patient_id=any(%s::uuid[]) group by status order by status", (org_id, patient_ids))
        result["follow_up_statuses"] = {str(row[0]): int(row[1]) for row in cursor.fetchall()}
        cursor.execute(
            """
            select
              (select count(*) from public.patients where org_id=%s and id=any(%s::uuid[]) and concat_ws(' ',name,reason,address) ~* %s)
              + (select count(*) from public.notes where org_id=%s and patient_id=any(%s::uuid[]) and content ~* %s)
              + (select count(*) from public.case_studies where org_id=%s and patient_id=any(%s::uuid[]) and concat_ws(' ',title,generated_content) ~* %s)
            """,
            (org_id, patient_ids, "demo|synthetic|showcase", org_id, patient_ids, "demo|synthetic|showcase", org_id, patient_ids, "demo|synthetic|showcase"),
        )
        result["visible_label_matches"] = int(cursor.fetchone()[0])
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Add a deterministic showcase dataset to an existing organization.")
    parser.add_argument("--identifier", required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--validate-rollback", action="store_true")
    mode.add_argument("--verify-only", action="store_true")
    parser.add_argument("--confirm-org-id", default="")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    database_url = str(os.environ.get("DATABASE_URL") or "").strip()
    if not database_url:
        raise SystemExit("DATABASE_URL is not configured.")
    with psycopg.connect(database_url) as connection:
        summary = organization_summary(connection, args.identifier)
        print(json.dumps({"target": summary, "planned": {"patients": len(PATIENTS), "patient_email": TARGET_EMAIL, "catalog_items": len(CATALOG), "invoices": 8, "scheduled_follow_ups": 6, "clinical_tracks": 24, "myopia_measurements": 12}}, indent=2))
        if summary["specialty"] != "optometry":
            raise SystemExit(f"Target organization specialty is {summary['specialty']!r}, expected 'optometry'.")
        if args.verify_only:
            print(json.dumps({"verified": verification_summary(connection, UUID(summary["org_id"]))}, indent=2))
            return
        if not args.apply and not args.validate_rollback:
            print("Dry run only. Re-run with --apply and --confirm-org-id to insert records.")
            return
        if args.confirm_org_id != summary["org_id"]:
            raise SystemExit("--confirm-org-id must exactly match the resolved organization ID.")
        counts = execute_seed(connection, org_id=UUID(summary["org_id"]), user_id=UUID(summary["user_id"]))
        verified = verification_summary(connection, UUID(summary["org_id"]))
        if args.validate_rollback:
            connection.rollback()
            print(json.dumps({"validated_then_rolled_back": counts, "transaction_view": verified}, indent=2))
            return
        connection.commit()
        print(json.dumps({"inserted_this_run": counts, "verified": verified}, indent=2))


if __name__ == "__main__":
    main()
