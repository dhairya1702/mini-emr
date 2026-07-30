import { OptometryHistoryPayload } from "@/lib/types";

export function createEmptyOptometryHistory(): OptometryHistoryPayload {
  return {
    ocular: "",
    systemic: "",
    no_known_allergies: false,
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
    contact_lens_notes: "",
  };
}

export function hasOptometryHistoryDetails(payload: OptometryHistoryPayload): boolean {
  return Boolean(
    payload.ocular.trim()
    || payload.systemic.trim()
    || payload.no_known_allergies
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
    || payload.contact_lens_notes.trim()
  );
}
