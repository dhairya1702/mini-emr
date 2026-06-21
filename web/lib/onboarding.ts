import type { ClinicSettings } from "@/lib/types";

export function hasRequiredOnboardingSettings(settings: ClinicSettings | null | undefined) {
  return Boolean(
    settings?.clinic_specialty &&
      settings.appointment_start_time &&
      settings.appointment_end_time &&
      settings.appointments_per_hour > 0,
  );
}

export function requiresOnboarding(settings: ClinicSettings | null | undefined) {
  return Boolean(settings?.onboarding_required && !settings.onboarding_completed_at);
}
