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
      },
    ] as ContactLensEyeEntry[],
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
    entry.fit_notes.trim(),
  );
}

export function hasContactLensData(contactLens?: ContactLensPayload | null) {
  if (!contactLens) {
    return false;
  }
  return Boolean(
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

export function createEmptyBinocularVision(): BinocularVisionPayload {
  return {
    symptom_notes: "",
    asthenopia: false,
    headache: false,
    diplopia: false,
    blur_near: false,
    blur_distance: false,
    reading_difficulty: false,
    poor_concentration: false,
    distance_cover_test: "",
    near_cover_test: "",
    distance_deviation_pd: "",
    near_deviation_pd: "",
    binocular_visual_acuity_distance: "",
    binocular_visual_acuity_near: "",
    motility: "",
    pursuits: "",
    saccades: "",
    npc_break_cm: "",
    npc_recovery_cm: "",
    convergence_notes: "",
    bo_distance: "",
    bo_near: "",
    bi_distance: "",
    bi_near: "",
    vergence_notes: "",
    stereo_test_name: "",
    stereo_result_arcsec: "",
    worth_four_dot_distance: "",
    worth_four_dot_near: "",
    sensory_notes: "",
    amplitude_right: "",
    amplitude_left: "",
    facility_cpm: "",
    facility_lens: "",
    accommodation_notes: "",
    working_diagnosis: "",
    management_plan: "",
    follow_up_interval: "",
  };
}

export function hasBinocularVisionData(binocular?: BinocularVisionPayload | null) {
  if (!binocular) {
    return false;
  }
  return Boolean(
    binocular.symptom_notes.trim() ||
    binocular.asthenopia ||
    binocular.headache ||
    binocular.diplopia ||
    binocular.blur_near ||
    binocular.blur_distance ||
    binocular.reading_difficulty ||
    binocular.poor_concentration ||
    binocular.distance_cover_test.trim() ||
    binocular.near_cover_test.trim() ||
    binocular.distance_deviation_pd.trim() ||
    binocular.near_deviation_pd.trim() ||
    binocular.binocular_visual_acuity_distance.trim() ||
    binocular.binocular_visual_acuity_near.trim() ||
    binocular.motility.trim() ||
    binocular.pursuits.trim() ||
    binocular.saccades.trim() ||
    binocular.npc_break_cm.trim() ||
    binocular.npc_recovery_cm.trim() ||
    binocular.convergence_notes.trim() ||
    binocular.bo_distance.trim() ||
    binocular.bo_near.trim() ||
    binocular.bi_distance.trim() ||
    binocular.bi_near.trim() ||
    binocular.vergence_notes.trim() ||
    binocular.stereo_test_name.trim() ||
    binocular.stereo_result_arcsec.trim() ||
    binocular.worth_four_dot_distance.trim() ||
    binocular.worth_four_dot_near.trim() ||
    binocular.sensory_notes.trim() ||
    binocular.amplitude_right.trim() ||
    binocular.amplitude_left.trim() ||
    binocular.facility_cpm.trim() ||
    binocular.facility_lens.trim() ||
    binocular.accommodation_notes.trim() ||
    binocular.working_diagnosis.trim() ||
    binocular.management_plan.trim() ||
    binocular.follow_up_interval.trim(),
  );
}

export function buildBinocularVisionSummary(binocular: BinocularVisionPayload) {
  const parts = [
    binocular.working_diagnosis.trim(),
    binocular.npc_break_cm.trim() ? `NPC ${binocular.npc_break_cm.trim()} cm` : "",
    binocular.stereo_result_arcsec.trim() ? `Stereo ${binocular.stereo_result_arcsec.trim()} arc sec` : "",
    binocular.near_deviation_pd.trim() ? `Near ${binocular.near_deviation_pd.trim()} pd` : "",
  ].filter(Boolean);
  return parts.slice(0, 3).join(" · ") || "Binocular vision data saved.";
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
