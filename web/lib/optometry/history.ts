import { OptometryHistoryPayload } from "@/lib/types";

export function createEmptyOptometryHistory(): OptometryHistoryPayload {
  return {
    ocular: "",
    ocular_conditions: [],
    systemic: "",
    systemic_conditions: [],
    no_known_allergies: false,
    drug_allergies: "",
    contact_allergies: "",
    food_allergies: "",
    drug_allergy_entries: [],
    contact_allergy_entries: [],
    food_allergy_entries: [],
    allergies: "",
    current_medications: "",
    family: "",
    wears_glasses: null,
    glasses_since: "",
    glasses_usage: "",
    lens_type: "",
    prescription_age: "",
    pd: "",
    right_power: { sphere: "", cylinder: "", axis: "", add: "" },
    left_power: { sphere: "", cylinder: "", axis: "", add: "" },
    glasses_notes: "",
    wears_contact_lenses: null,
    contacts_since: "",
    contact_lens_type: "",
    right_contact_power: { sphere: "", cylinder: "", axis: "", add: "" },
    left_contact_power: { sphere: "", cylinder: "", axis: "", add: "" },
    contact_lens_notes: "",
  };
}

export function hasOptometryHistoryDetails(payload: OptometryHistoryPayload): boolean {
  return Boolean(
    payload.ocular.trim()
    || payload.ocular_conditions.some((entry) => entry.condition.trim() || entry.comment.trim())
    || payload.systemic.trim()
    || payload.systemic_conditions.some((entry) => entry.condition.trim() || entry.comment.trim())
    || payload.no_known_allergies
    || payload.drug_allergies.trim()
    || payload.contact_allergies.trim()
    || payload.food_allergies.trim()
    || payload.drug_allergy_entries.some((entry) => entry.condition.trim() || entry.comment.trim())
    || payload.contact_allergy_entries.some((entry) => entry.condition.trim() || entry.comment.trim())
    || payload.food_allergy_entries.some((entry) => entry.condition.trim() || entry.comment.trim())
    || payload.allergies.trim()
    || payload.current_medications.trim()
    || payload.family.trim()
    || payload.wears_glasses !== null
    || payload.glasses_since.trim()
    || payload.glasses_usage.trim()
    || payload.lens_type.trim()
    || payload.prescription_age.trim()
    || payload.pd.trim()
    || Object.values(payload.right_power).some((value) => value.trim())
    || Object.values(payload.left_power).some((value) => value.trim())
    || payload.glasses_notes.trim()
    || payload.wears_contact_lenses !== null
    || payload.contacts_since.trim()
    || payload.contact_lens_type.trim()
    || Object.values(payload.right_contact_power).some((value) => value.trim())
    || Object.values(payload.left_contact_power).some((value) => value.trim())
    || payload.contact_lens_notes.trim()
  );
}
