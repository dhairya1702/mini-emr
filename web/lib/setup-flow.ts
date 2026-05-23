import type { ClinicSetupChecklist, ClinicSetupStepKey } from "@/lib/setup-checklist";

export function setupQueryForStep(stepKey: ClinicSetupStepKey) {
  switch (stepKey) {
    case "hours":
      return "clinic-hours";
    case "sender_email":
      return "sender-email";
    case "first_staff_user":
      return "add-first-staff";
    case "first_patient":
      return "create-first-patient";
    case "document_template":
      return "document-template";
    default:
      return stepKey;
  }
}

export function setupStepFromQuery(value: string): ClinicSetupStepKey | null {
  switch (value) {
    case "specialty":
      return "specialty";
    case "clinic-hours":
      return "hours";
    case "signature":
      return "signature";
    case "sender-email":
      return "sender_email";
    case "add-first-staff":
      return "first_staff_user";
    case "create-first-patient":
      return "first_patient";
    case "document-template":
      return "document_template";
    default:
      return null;
  }
}

export function findNextSetupStep(
  checklist: ClinicSetupChecklist,
  completedStepKey: ClinicSetupStepKey,
) {
  return checklist.items.find(
    (step) =>
      step.key !== completedStepKey &&
      (step.status === "incomplete" || step.status === "recommended"),
  )?.key ?? null;
}
