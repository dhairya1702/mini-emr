export type ClinicSpecialty = "optometry" | "general_physician" | "pediatrics" | "dentistry";

export const CLINIC_SPECIALTY_OPTIONS: Array<{
  value: ClinicSpecialty;
  label: string;
  description: string;
}> = [
  {
    value: "optometry",
    label: "Optometry",
    description: "For eye exams, refraction, prescriptions, lenses, and optical clinic workflows.",
  },
  {
    value: "general_physician",
    label: "General Physician",
    description: "For everyday outpatient care, diagnosis, prescriptions, certificates, and billing.",
  },
  {
    value: "pediatrics",
    label: "Pediatrics",
    description: "For child visits, growth tracking, vaccination context, parent guidance, and pediatric notes.",
  },
  {
    value: "dentistry",
    label: "Dentistry",
    description: "For dental complaints, procedures, tooth-specific notes, treatment plans, and billing.",
  },
];
