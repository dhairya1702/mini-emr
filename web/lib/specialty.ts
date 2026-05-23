import type { ClinicSpecialty } from "@/lib/clinic-specialty";

export type SpecialtyModuleKey =
  | "eye_exam"
  | "contact_lens"
  | "binocular_vision"
  | "low_vision"
  | "myopia_management"
  | "pediatric_growth_measurement"
  | "well_child_visit"
  | "parent_handout_request"
  | "pediatric_follow_up_plan";

const SPECIALTY_MODULES: Record<Exclude<ClinicSpecialty, null>, SpecialtyModuleKey[]> = {
  general_physician: [],
  optometry: [
    "eye_exam",
    "contact_lens",
    "binocular_vision",
    "low_vision",
    "myopia_management",
  ],
  pediatrics: [
    "pediatric_growth_measurement",
    "well_child_visit",
    "parent_handout_request",
    "pediatric_follow_up_plan",
  ],
};

export function getSpecialtyModules(clinicSpecialty: ClinicSpecialty | null | undefined) {
  if (!clinicSpecialty) {
    return [];
  }
  return SPECIALTY_MODULES[clinicSpecialty] ?? [];
}

export function specialtyHasModule(clinicSpecialty: ClinicSpecialty | null | undefined, moduleKey: SpecialtyModuleKey) {
  return getSpecialtyModules(clinicSpecialty).includes(moduleKey);
}
