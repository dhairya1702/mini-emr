import type {
  BinocularVisionPayload,
  ContactLensEyeEntry,
  ContactLensPayload,
  LowVisionPayload,
  MyopiaMeasurementPayload,
} from "@/lib/types";

export type MyopiaMeasurementDraft = MyopiaMeasurementPayload & {
  record_id: string;
};

export function formatLocalDateTimeInput(value?: Date) {
  const date = value ?? new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function createEmptyContactLens(): ContactLensPayload {
  return {
    workup: {
      reason_for_wear: "", previous_lens_experience: "", wearing_requirements: "", occupation_environment: "",
      preferred_modality: "", preferred_brand: "", lids_lashes: "", conjunctiva: "", cornea: "",
      anterior_chamber: "", tear_film: "", keratometry_right: "", keratometry_left: "", hvid_right: "",
      hvid_left: "", tbut_right: "", tbut_left: "", schirmer_right: "", schirmer_left: "",
      tear_prism_right: "", tear_prism_left: "", topography_notes: "", pachymetry_right: "", pachymetry_left: "",
    },
    trials: [],
    dispensing: {
      dispensed_on: "", pre_insertion_findings: "", hygiene_explained: false, insertion_removal_taught: false,
      patient_confidence: "", care_solution: "", care_kit_given: false, instruction_booklet_given: false,
      wearing_schedule: "", replacement_schedule: "", advice: "",
    },
    follow_ups: [],
    wearing_goal: "",
    current_lens_brand: "",
    current_wear_schedule: "",
    replacement_frequency: "",
    comfort_issues: "",
    dryness_symptoms: "",
    handling_issues: "",
    care_solution: "",
    allergy_history: "",
    assessment_notes: "",
    lens_type: "",
    manufacturer: "",
    brand: "",
    wear_modality: "",
    trial_lens_used: "",
    vendor_name: "",
    quantity: "",
    special_instructions: "",
    eyes: [
      {
        eye: "right",
        sphere: "",
        cylinder: "",
        axis: "",
        base_curve: "",
        diameter: "",
        add_power: "",
        visual_acuity: "",
        over_refraction: "",
        fit_notes: "",
        material: "",
        design: "",
        sagittal_depth: "",
        landing_zone: "",
      },
      {
        eye: "left",
        sphere: "",
        cylinder: "",
        axis: "",
        base_curve: "",
        diameter: "",
        add_power: "",
        visual_acuity: "",
        over_refraction: "",
        fit_notes: "",
        material: "",
        design: "",
        sagittal_depth: "",
        landing_zone: "",
      },
    ] as ContactLensEyeEntry[],
  };
}

export function normalizeContactLensPayload(payload?: Partial<ContactLensPayload> | null): ContactLensPayload {
  const empty = createEmptyContactLens();
  if (!payload) return empty;
  const savedEyes = Array.isArray(payload.eyes) ? payload.eyes : [];
  return {
    ...empty,
    ...payload,
    workup: { ...empty.workup, ...(payload.workup ?? {}) },
    dispensing: { ...empty.dispensing, ...(payload.dispensing ?? {}) },
    trials: Array.isArray(payload.trials) ? payload.trials : [],
    follow_ups: Array.isArray(payload.follow_ups) ? payload.follow_ups : [],
    eyes: empty.eyes.map((eye) => ({ ...eye, ...(savedEyes.find((saved) => saved.eye === eye.eye) ?? {}) })),
  };
}

export function hasContactLensEyeData(entry?: ContactLensEyeEntry | null) {
  if (!entry) {
    return false;
  }
  return Boolean(
    entry.sphere.trim() ||
    entry.cylinder.trim() ||
    entry.axis.trim() ||
    entry.base_curve.trim() ||
    entry.diameter.trim() ||
    entry.add_power.trim() ||
    entry.visual_acuity.trim() ||
    entry.over_refraction.trim() ||
    entry.fit_notes.trim() ||
    entry.material.trim() ||
    entry.design.trim() ||
    entry.sagittal_depth.trim() ||
    entry.landing_zone.trim(),
  );
}

export function hasContactLensData(contactLens?: ContactLensPayload | null) {
  if (!contactLens) {
    return false;
  }
  return Boolean(
    flattenValues(contactLens.workup).some((value) => value.trim()) ||
    contactLens.trials.some((trial) => flattenValues(trial).some((value) => value.trim())) ||
    flattenValues(contactLens.dispensing).some((value) => value.trim()) ||
    contactLens.follow_ups.some((followUp) => flattenValues(followUp).some((value) => value.trim())) ||
    contactLens.wearing_goal.trim() ||
    contactLens.current_lens_brand.trim() ||
    contactLens.current_wear_schedule.trim() ||
    contactLens.replacement_frequency.trim() ||
    contactLens.comfort_issues.trim() ||
    contactLens.dryness_symptoms.trim() ||
    contactLens.handling_issues.trim() ||
    contactLens.care_solution.trim() ||
    contactLens.allergy_history.trim() ||
    contactLens.assessment_notes.trim() ||
    contactLens.lens_type.trim() ||
    contactLens.manufacturer.trim() ||
    contactLens.brand.trim() ||
    contactLens.wear_modality.trim() ||
    contactLens.trial_lens_used.trim() ||
    contactLens.vendor_name.trim() ||
    contactLens.quantity.trim() ||
    contactLens.special_instructions.trim() ||
    contactLens.eyes.some(hasContactLensEyeData),
  );
}

export function buildContactLensSummary(contactLens: ContactLensPayload) {
  const parts = [
    contactLens.lens_type.trim(),
    contactLens.brand.trim(),
    contactLens.trials.length ? `${contactLens.trials.length} trial${contactLens.trials.length === 1 ? "" : "s"}` : "",
    contactLens.follow_ups.length ? `${contactLens.follow_ups.length} follow-up${contactLens.follow_ups.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "Contact lens case sheet saved.";
}

export function createEmptyBinocularVision(): BinocularVisionPayload {
  return {
    history: {
      main_complaints: "",
      spectacle_use_history: "",
      near_work_hours: "",
      associated_symptoms: "",
      previous_vision_therapy: "",
      general_health_medications: "",
    },
    refraction: {},
    assessment_setup: {},
    sensory_evaluation: {},
    motor_evaluation: {},
    impression: "",
    advice: "",
    follow_up: "",
  };
}

export function hasBinocularVisionData(binocular?: BinocularVisionPayload | null) {
  if (!binocular || typeof binocular !== "object") {
    return false;
  }
  return flattenValues(binocular).some((value) => value.trim());
}

export function buildBinocularVisionSummary(binocular: BinocularVisionPayload) {
  const valueAt = (path: string[]) => {
    let current: unknown = binocular;
    for (const part of path) {
      if (!current || typeof current !== "object") {
        return "";
      }
      current = (current as Record<string, unknown>)[part];
    }
    return typeof current === "string" ? current.trim() : "";
  };
  const parts = [
    valueAt(["impression"]),
    valueAt(["history", "main_complaints"]),
    valueAt(["motor_evaluation", "npc_accommodative_target", "objective"]) ? `NPC ${valueAt(["motor_evaluation", "npc_accommodative_target", "objective"])}` : "",
    valueAt(["sensory_evaluation", "stereopsis", "near"]) ? `Stereo N ${valueAt(["sensory_evaluation", "stereopsis", "near"])}` : "",
  ].filter(Boolean);
  return parts.slice(0, 3).join(" · ") || "Binocular vision evaluation saved.";
}

function flattenValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(flattenValues);
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(flattenValues);
  }
  return [];
}

export function createEmptyLowVision(): LowVisionPayload {
  return {
    primary_complaint: "",
    goals: "",
    reading_difficulty: false,
    distance_difficulty: false,
    mobility_difficulty: false,
    face_recognition_difficulty: false,
    glare_complaints: false,
    lighting_difficulty: false,
    distance_visual_acuity: "",
    near_visual_acuity: "",
    habitual_correction: "",
    best_correction: "",
    contrast_sensitivity: "",
    glare_function: "",
    central_vision: "",
    visual_field: "",
    functional_reading: "",
    sustained_near_task: "",
    tv_phone_mobility_notes: "",
    illumination_response: "",
    posture_working_distance: "",
    magnifier_type: "",
    magnification: "",
    near_add: "",
    electronic_aid: "",
    tint_filter: "",
    task_performance_with_device: "",
    device_recommended: "",
    lighting_advice: "",
    non_optical_aids: "",
    rehab_referral: "",
    support_referral: "",
    training_required: "",
    follow_up_plan: "",
    cause_of_low_vision: "",
    prognosis: "",
    emotional_support_notes: "",
    charles_bonnet_screening: "",
    final_plan: "",
  };
}

export function hasLowVisionData(lowVision?: LowVisionPayload | null) {
  if (!lowVision) {
    return false;
  }
  return Boolean(
    lowVision.primary_complaint.trim() ||
    lowVision.goals.trim() ||
    lowVision.reading_difficulty ||
    lowVision.distance_difficulty ||
    lowVision.mobility_difficulty ||
    lowVision.face_recognition_difficulty ||
    lowVision.glare_complaints ||
    lowVision.lighting_difficulty ||
    lowVision.distance_visual_acuity.trim() ||
    lowVision.near_visual_acuity.trim() ||
    lowVision.habitual_correction.trim() ||
    lowVision.best_correction.trim() ||
    lowVision.contrast_sensitivity.trim() ||
    lowVision.glare_function.trim() ||
    lowVision.central_vision.trim() ||
    lowVision.visual_field.trim() ||
    lowVision.functional_reading.trim() ||
    lowVision.sustained_near_task.trim() ||
    lowVision.tv_phone_mobility_notes.trim() ||
    lowVision.illumination_response.trim() ||
    lowVision.posture_working_distance.trim() ||
    lowVision.magnifier_type.trim() ||
    lowVision.magnification.trim() ||
    lowVision.near_add.trim() ||
    lowVision.electronic_aid.trim() ||
    lowVision.tint_filter.trim() ||
    lowVision.task_performance_with_device.trim() ||
    lowVision.device_recommended.trim() ||
    lowVision.lighting_advice.trim() ||
    lowVision.non_optical_aids.trim() ||
    lowVision.rehab_referral.trim() ||
    lowVision.support_referral.trim() ||
    lowVision.training_required.trim() ||
    lowVision.follow_up_plan.trim() ||
    lowVision.cause_of_low_vision.trim() ||
    lowVision.prognosis.trim() ||
    lowVision.emotional_support_notes.trim() ||
    lowVision.charles_bonnet_screening.trim() ||
    lowVision.final_plan.trim(),
  );
}

export function buildLowVisionSummary(lowVision: LowVisionPayload) {
  const parts = [
    lowVision.primary_complaint.trim(),
    lowVision.distance_visual_acuity.trim() ? `DVA ${lowVision.distance_visual_acuity.trim()}` : "",
    lowVision.near_visual_acuity.trim() ? `NVA ${lowVision.near_visual_acuity.trim()}` : "",
    lowVision.device_recommended.trim(),
  ].filter(Boolean);
  return parts.slice(0, 3).join(" · ") || "Low vision data saved.";
}

export function createEmptyMyopiaManagement(): MyopiaMeasurementDraft {
  return {
    record_id: "",
    measured_at: formatLocalDateTimeInput(),
    age_years: 0,
    axial_length_right_mm: 0,
    axial_length_left_mm: 0,
    treatment_type: "",
    treatment_notes: "",
    visit_notes: "",
    refraction_right: "",
    refraction_left: "",
  };
}

export function hasMyopiaManagementData(myopia?: MyopiaMeasurementDraft | null) {
  if (!myopia) {
    return false;
  }
  return Boolean(
    myopia.record_id ||
    myopia.age_years > 0 ||
    myopia.axial_length_right_mm > 0 ||
    myopia.axial_length_left_mm > 0 ||
    myopia.treatment_type.trim() ||
    myopia.treatment_notes.trim() ||
    myopia.visit_notes.trim() ||
    myopia.refraction_right.trim() ||
    myopia.refraction_left.trim(),
  );
}

export function buildMyopiaManagementSummary(myopia: MyopiaMeasurementDraft) {
  const parts = [
    myopia.axial_length_right_mm > 0 ? `OD ${myopia.axial_length_right_mm.toFixed(2)} mm` : "",
    myopia.axial_length_left_mm > 0 ? `OS ${myopia.axial_length_left_mm.toFixed(2)} mm` : "",
    myopia.treatment_type.trim(),
  ].filter(Boolean);
  return parts.join(" · ") || "Myopia management measurement saved.";
}
