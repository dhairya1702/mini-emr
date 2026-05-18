export type ClinicSpecialty = "optometry" | "general_physician" | "pediatrics";

export const CLINIC_SPECIALTY_OPTIONS: Array<{
  value: ClinicSpecialty;
  label: string;
  description: string;
}> = [
  {
    value: "optometry",
    label: "Optometrist",
    description: "Enable eye exam and optometry-specific workflows as they are added.",
  },
  {
    value: "general_physician",
    label: "General Physician",
    description: "Keep the shared clinic workflow without optometry-specific modules.",
  },
  {
    value: "pediatrics",
    label: "Pediatrics",
    description: "Enable growth tracking, well-child structured visits, pediatric handouts, and pediatric follow-ups.",
  },
];
