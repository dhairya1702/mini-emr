import { AuthUser, ClinicSettings, Patient } from "@/lib/types";

export type ClinicSetupStepKey =
  | "specialty"
  | "hours"
  | "signature"
  | "sender_email"
  | "first_staff_user"
  | "first_patient"
  | "document_template";

export type ClinicSetupStepStatus = "complete" | "incomplete" | "recommended";

export type ClinicSetupStep = {
  key: ClinicSetupStepKey;
  title: string;
  description: string;
  status: ClinicSetupStepStatus;
};

export type ClinicSetupChecklist = {
  items: ClinicSetupStep[];
  requiredCompleted: number;
  requiredTotal: number;
  allRequiredComplete: boolean;
  optionalCompleted: number;
  optionalTotal: number;
};

export function hasUserSignature(user: AuthUser | null | undefined) {
  return Boolean(user?.doctor_signature_name || user?.doctor_signature_url);
}

export function hasClinicDocumentTemplate(settings: ClinicSettings | null | undefined) {
  return Boolean(settings?.document_template_name || settings?.document_template_url);
}

export function hasClinicHoursConfigured(settings: ClinicSettings | null | undefined) {
  if (!settings) {
    return false;
  }

  return Boolean(
    settings.appointment_start_time &&
      settings.appointment_end_time &&
      settings.appointments_per_hour &&
      settings.appointments_per_hour > 0,
  );
}

export function buildClinicSetupChecklist(args: {
  currentUser: AuthUser | null;
  users: AuthUser[];
  patients: Patient[];
  clinicSettings: ClinicSettings | null;
}): ClinicSetupChecklist {
  const { currentUser, users, patients, clinicSettings } = args;

  const steps: ClinicSetupStep[] = [
    {
      key: "specialty",
      title: "Select specialty",
      description: "Choose the clinic specialty so the right modules and workflows appear.",
      status: clinicSettings?.clinic_specialty ? "complete" : "incomplete",
    },
    {
      key: "hours",
      title: "Set clinic hours",
      description: "Define opening time, closing time, and appointments per hour for scheduling.",
      status: hasClinicHoursConfigured(clinicSettings) ? "complete" : "incomplete",
    },
    {
      key: "signature",
      title: "Upload your signature",
      description: "Attach the doctor signoff used on generated notes, letters, and PDFs.",
      status: hasUserSignature(currentUser) ? "complete" : "incomplete",
    },
    {
      key: "sender_email",
      title: "Configure sender email",
      description: "Set the Gmail sender used for letters, notes, invoices, and reminders.",
      status: clinicSettings?.email_configured ? "complete" : "incomplete",
    },
    {
      key: "first_staff_user",
      title: "Add first staff user",
      description: "Invite another clinic user so the workspace is ready for team use.",
      status: users.some((user) => user.id !== currentUser?.id) ? "complete" : "incomplete",
    },
    {
      key: "first_patient",
      title: "Create first patient",
      description: "Add your first real patient record so the clinic can start using the system.",
      status: patients.length > 0 ? "complete" : "incomplete",
    },
    {
      key: "document_template",
      title: "Upload document template",
      description: "Optional: add shared clinic paper for polished notes, letters, and invoices.",
      status: hasClinicDocumentTemplate(clinicSettings) ? "complete" : "recommended",
    },
  ];

  const requiredSteps = steps.filter((step) => step.key !== "document_template");
  const optionalSteps = steps.filter((step) => step.key === "document_template");

  return {
    items: steps,
    requiredCompleted: requiredSteps.filter((step) => step.status === "complete").length,
    requiredTotal: requiredSteps.length,
    allRequiredComplete: requiredSteps.every((step) => step.status === "complete"),
    optionalCompleted: optionalSteps.filter((step) => step.status === "complete").length,
    optionalTotal: optionalSteps.length,
  };
}
