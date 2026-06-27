"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Clock, FileText, Mail, PenLine, Stethoscope, Upload, UserPlus, Users } from "lucide-react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { PasswordInput } from "@/components/password-input";
import { api } from "@/lib/api";
import { CLINIC_SPECIALTY_OPTIONS, type ClinicSpecialty } from "@/lib/clinic-specialty";
import { DEFAULT_CLINIC_TIMEZONE, getDefaultClinicTimeZone, listSupportedTimeZones, normalizeTimeZoneValue } from "@/lib/timezone";
import type { AuthUser, ClinicSettings, ClinicSettingsUpdatePayload } from "@/lib/types";

type StepKey = "specialty" | "hours" | "signature" | "email" | "staff" | "template" | "patient" | "done";

const steps: Array<{ key: StepKey; title: string; optional: boolean }> = [
  { key: "specialty", title: "Specialty", optional: false },
  { key: "hours", title: "Clinic Hours", optional: false },
  { key: "signature", title: "Signature", optional: true },
  { key: "email", title: "Gmail Sender", optional: true },
  { key: "staff", title: "Staff User", optional: true },
  { key: "template", title: "Letterhead", optional: true },
  { key: "patient", title: "First Patient", optional: true },
  { key: "done", title: "Done", optional: false },
];

const iconByStep: Record<StepKey, typeof Stethoscope> = {
  specialty: Stethoscope,
  hours: Clock,
  signature: PenLine,
  email: Mail,
  staff: UserPlus,
  template: FileText,
  patient: Users,
  done: Check,
};

function settingsPayload(settings: ClinicSettings, patch: Partial<ClinicSettingsUpdatePayload>): ClinicSettingsUpdatePayload {
  return {
    clinic_name: settings.clinic_name,
    clinic_address: settings.clinic_address,
    clinic_phone: settings.clinic_phone,
    clinic_specialty: settings.clinic_specialty,
    timezone: settings.timezone,
    appointment_start_time: settings.appointment_start_time,
    appointment_end_time: settings.appointment_end_time,
    appointments_per_hour: settings.appointments_per_hour,
    doctor_name: settings.doctor_name,
    sender_name: settings.sender_name,
    sender_email: settings.sender_email,
    email_configured: settings.email_configured,
    custom_header: settings.custom_header,
    custom_footer: settings.custom_footer,
    document_template_name: settings.document_template_name,
    document_template_url: settings.document_template_url,
    document_template_notes_enabled: settings.document_template_notes_enabled,
    document_template_letters_enabled: settings.document_template_letters_enabled,
    document_template_invoices_enabled: settings.document_template_invoices_enabled,
    document_template_margin_top: settings.document_template_margin_top,
    document_template_margin_right: settings.document_template_margin_right,
    document_template_margin_bottom: settings.document_template_margin_bottom,
    document_template_margin_left: settings.document_template_margin_left,
    onboarding_required: settings.onboarding_required,
    onboarding_completed_at: settings.onboarding_completed_at,
    workspace_mode: settings.workspace_mode,
    ...patch,
  };
}

function nextAppPath() {
  if (typeof window === "undefined") {
    return "/";
  }
  if (window.location.pathname.startsWith("/m")) {
    return "/m";
  }
  return window.matchMedia("(max-width: 767px)").matches ? "/m" : "/";
}

export default function OnboardingSetupPage() {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentUser,
    clinicSettings,
    isAuthReady,
    isRedirectingToLogin,
    applyClinicSettings,
    applyCurrentUser,
  } = useClinicShell();
  const [activeIndex, setActiveIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<StepKey>>(() => new Set());
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [specialty, setSpecialty] = useState<ClinicSpecialty>("optometry");
  const [hours, setHours] = useState({
    timezone: DEFAULT_CLINIC_TIMEZONE,
    start: "09:00",
    end: "18:00",
    perHour: "4",
  });
  const timeZoneOptions = listSupportedTimeZones(hours.timezone);
  const [email, setEmail] = useState({ sender_name: "", sender_email: "", app_password: "" });
  const [staff, setStaff] = useState({ identifier: "", password: "" });
  const [createdStaffUsers, setCreatedStaffUsers] = useState<AuthUser[]>([]);
  const [patient, setPatient] = useState({ name: "", phone: "", reason: "" });
  const [templateSettings, setTemplateSettings] = useState<ClinicSettings | null>(null);

  const activeStep = steps[activeIndex];
  const isMobileSurface = pathname.startsWith("/m");
  const requiredComplete = completedSteps.has("specialty") && completedSteps.has("hours");
  const canGoPreviousStep = activeIndex > 0;
  const canGoNextStep = activeIndex < steps.length - 1;

  useEffect(() => {
    if (!clinicSettings) {
      return;
    }
    if (clinicSettings.clinic_specialty) {
      setSpecialty(clinicSettings.clinic_specialty);
      setCompletedSteps((current) => new Set(current).add("specialty"));
    }
    setHours({
      timezone: normalizeTimeZoneValue(clinicSettings.timezone || getDefaultClinicTimeZone()),
      start: clinicSettings.appointment_start_time || "09:00",
      end: clinicSettings.appointment_end_time || "18:00",
      perHour: String(clinicSettings.appointments_per_hour || 4),
    });
    if (
      clinicSettings.onboarding_completed_at &&
      clinicSettings.appointment_start_time &&
      clinicSettings.appointment_end_time &&
      clinicSettings.appointments_per_hour > 0
    ) {
      setCompletedSteps((current) => new Set(current).add("hours"));
    }
    setEmail({
      sender_name: clinicSettings.sender_name || "",
      sender_email: clinicSettings.sender_email || "",
      app_password: "",
    });
    setTemplateSettings(clinicSettings);
  }, [clinicSettings]);

  useEffect(() => {
    if (currentUser?.doctor_signature_name || currentUser?.doctor_signature_url) {
      setCompletedSteps((current) => new Set(current).add("signature"));
    }
  }, [currentUser]);

  const canGoNext = useMemo(() => {
    if (activeStep.key === "specialty") return completedSteps.has("specialty");
    if (activeStep.key === "hours") return completedSteps.has("hours");
    return true;
  }, [activeStep.key, completedSteps]);

  function markComplete(stepKey: StepKey) {
    setCompletedSteps((current) => new Set(current).add(stepKey));
  }

  function goToNext() {
    setError("");
    setStatus("");
    setActiveIndex((current) => Math.min(current + 1, steps.length - 1));
  }

  function goToPrevious() {
    setError("");
    setStatus("");
    setActiveIndex((current) => Math.max(current - 1, 0));
  }

  function navigateToNextStep() {
    if (!canGoNextStep) {
      return;
    }
    if (activeStep.key === "specialty" && !completedSteps.has("specialty")) {
      setError("Save specialty before moving to the next step.");
      return;
    }
    if (activeStep.key === "hours" && !completedSteps.has("hours")) {
      setError("Save clinic hours before moving to the next step.");
      return;
    }
    goToNext();
  }

  function skipOptional() {
    if (!activeStep.optional) {
      return;
    }
    goToNext();
  }

  async function saveSpecialty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clinicSettings) {
      setError("Clinic settings are still loading.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const saved = await api.updateClinicSettings(settingsPayload(clinicSettings, { clinic_specialty: specialty }));
      applyClinicSettings(saved);
      markComplete("specialty");
      goToNext();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save specialty.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clinicSettings) {
      setError("Clinic settings are still loading.");
      return;
    }
    const appointmentsPerHour = Number(hours.perHour);
    if (!hours.start || !hours.end || hours.start >= hours.end) {
      setError("Set a valid opening and closing time.");
      return;
    }
    if (!Number.isInteger(appointmentsPerHour) || appointmentsPerHour < 1 || appointmentsPerHour > 12 || 60 % appointmentsPerHour !== 0) {
      setError("Appointments per hour must be a whole number that divides evenly into 60.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const saved = await api.updateClinicSettings(settingsPayload(clinicSettings, {
        timezone: hours.timezone,
        appointment_start_time: hours.start,
        appointment_end_time: hours.end,
        appointments_per_hour: appointmentsPerHour,
      }));
      applyClinicSettings(saved);
      markComplete("hours");
      goToNext();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save clinic hours.");
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadSignature(file: File) {
    setIsSaving(true);
    setError("");
    try {
      const updated = await api.uploadMySignature(file);
      applyCurrentUser(updated);
      markComplete("signature");
      goToNext();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to upload signature.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clinicSettings) {
      setError("Clinic settings are still loading.");
      return;
    }
    if (!email.sender_email.trim() || !email.sender_email.includes("@")) {
      setError("Enter a valid sender email, or skip this step.");
      return;
    }
    if (!clinicSettings.email_configured && !email.app_password.trim()) {
      setError("Enter a Gmail app password, or skip this step.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const saved = await api.updateClinicSettings(settingsPayload(clinicSettings, {
        sender_name: email.sender_name.trim(),
        sender_email: email.sender_email.trim(),
        sender_email_app_password: email.app_password.trim() || undefined,
        email_configured: true,
      }));
      applyClinicSettings(saved);
      markComplete("email");
      goToNext();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save sender email.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!staff.identifier.trim() || staff.password.length < 12) {
      setError("Enter a staff login and a password of at least 12 characters, or continue without adding another user.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const created = await api.createStaffUser({ identifier: staff.identifier.trim(), password: staff.password });
      setCreatedStaffUsers((current) => [...current, created]);
      setStaff({ identifier: "", password: "" });
      markComplete("staff");
      setStatus("Staff user added. Add another user or continue.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to create staff user.");
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadTemplate(file: File) {
    setIsSaving(true);
    setError("");
    try {
      const updated = await api.uploadClinicDocumentTemplate(file);
      setTemplateSettings(updated);
      applyClinicSettings(updated);
      markComplete("template");
      goToNext();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to upload letterhead.");
    } finally {
      setIsSaving(false);
    }
  }

  async function savePatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patient.name.trim() || !patient.phone.trim() || !patient.reason.trim()) {
      setError("Patient name, phone, and visit reason are required, or skip this step.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      await api.createPatient({
        name: patient.name.trim(),
        phone: patient.phone.trim(),
        reason: patient.reason.trim(),
        email: "",
        address: "",
        date_of_birth: null,
        age: null,
        weight: null,
        height: null,
        temperature: null,
      });
      markComplete("patient");
      goToNext();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to create first patient.");
    } finally {
      setIsSaving(false);
    }
  }

  async function finishOnboarding() {
    if (!requiredComplete) {
      setError("Complete specialty and clinic hours before entering the workspace.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const saved = await api.completeClinicOnboarding();
      applyClinicSettings(saved);
      router.replace(nextAppPath());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to complete onboarding.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!isAuthReady || isRedirectingToLogin) {
    return <main className="flex min-h-screen items-center justify-center px-4 text-sm text-slate-600">Loading setup...</main>;
  }

  if (!currentUser) {
    return <main className="flex min-h-screen items-center justify-center px-4 text-sm text-slate-600">Redirecting to login...</main>;
  }

  if (currentUser.role !== "admin") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7fbfd] px-4">
        <section className="w-full max-w-md rounded-[18px] border border-[#dbe7ef] bg-white p-6 text-center shadow-[0_14px_34px_rgba(64,131,181,0.10)]">
          <h1 className="text-xl font-semibold text-slate-900">Clinic setup is pending</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">Ask an admin to finish the required setup before staff can enter the workspace.</p>
        </section>
      </main>
    );
  }

  const Icon = iconByStep[activeStep.key];

  return (
    <main className="min-h-screen bg-[#f7fbfd] px-4 py-6 text-slate-800 sm:px-6 lg:px-8">
      <div className={`mx-auto ${isMobileSurface ? "max-w-md" : "max-w-6xl"}`}>
        <div className="relative mb-5 rounded-[22px] border border-[#dbe7ef] bg-white/95 px-4 py-4 shadow-[0_14px_34px_rgba(64,131,181,0.08)] sm:px-6">
          <button
            type="button"
            disabled={!canGoPreviousStep || isSaving}
            onClick={goToPrevious}
            className={`absolute left-4 top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-[#bfd7e8] bg-white text-slate-600 shadow-[0_10px_24px_rgba(64,131,181,0.12)] transition hover:bg-[#f3f8fb] disabled:cursor-not-allowed disabled:opacity-30 lg:grid ${isMobileSurface ? "hidden" : ""}`}
            aria-label="Previous setup step"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            disabled={!canGoNextStep || isSaving}
            onClick={navigateToNextStep}
            className={`absolute right-4 top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-[#bfd7e8] bg-white text-slate-600 shadow-[0_10px_24px_rgba(64,131,181,0.12)] transition hover:bg-[#f3f8fb] disabled:cursor-not-allowed disabled:opacity-30 lg:grid ${isMobileSurface ? "hidden" : ""}`}
            aria-label="Next setup step"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <nav className="overflow-x-auto pb-1">
            <div className={`mx-auto flex w-max items-center gap-3 ${isMobileSurface ? "" : "lg:px-16"}`}>
              {steps.map((step, index) => {
                const StepIcon = iconByStep[step.key];
                const isActive = index === activeIndex;
                const isComplete = step.key === "done" ? false : completedSteps.has(step.key);
                const canOpen = index <= activeIndex || isComplete || step.optional;
                return (
                  <button
                    key={step.key}
                    type="button"
                    disabled={!canOpen}
                    onClick={() => {
                      setError("");
                      setStatus("");
                      setActiveIndex(index);
                    }}
                    title={step.optional ? `${step.title} (optional)` : step.title}
                    className={`grid h-14 w-14 place-items-center rounded-2xl transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      isActive
                        ? "bg-[#2f8fd3] text-white shadow-[0_10px_24px_rgba(47,143,211,0.22)]"
                        : isComplete
                          ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                          : "bg-[#f3f8fb] text-slate-700 hover:bg-[#e6f1f8]"
                    }`}
                    aria-current={isActive ? "step" : undefined}
                    aria-label={step.optional ? `${step.title}, optional` : step.title}
                  >
                    {isComplete ? <Check className="h-5 w-5" /> : <StepIcon className="h-5 w-5" />}
                  </button>
                );
              })}
            </div>
          </nav>
        </div>

        <section className="relative rounded-[22px] border border-[#dbe7ef] bg-white p-5 shadow-[0_14px_34px_rgba(64,131,181,0.10)] sm:p-7">
          <div className="mb-6 flex items-start gap-3">
            <div className="rounded-xl bg-[#f3f8fb] p-3 text-[#2a6fa8]">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {activeStep.optional ? "Optional" : "Required"}
              </p>
              <h2 className="mt-1 text-2xl font-semibold text-slate-900">{activeStep.title}</h2>
            </div>
          </div>

          {activeStep.key === "specialty" ? (
            <form className="space-y-4" onSubmit={saveSpecialty}>
              <div className="grid gap-3">
                {CLINIC_SPECIALTY_OPTIONS.map((option) => (
                  <label key={option.value} className={`cursor-pointer rounded-xl border px-4 py-4 ${specialty === option.value ? "border-[#6daed8] bg-[#f3f8fb]" : "border-slate-200 bg-white"}`}>
                    <input type="radio" className="sr-only" name="specialty" checked={specialty === option.value} onChange={() => setSpecialty(option.value)} />
                    <p className="font-semibold text-slate-900">{option.label}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{option.description}</p>
                  </label>
                ))}
              </div>
              <WizardActions isSaving={isSaving} canGoBack={false} onBack={() => undefined} />
            </form>
          ) : null}

          {activeStep.key === "hours" ? (
            <form className="space-y-4" onSubmit={saveHours}>
              <div className={`grid gap-4 ${isMobileSurface ? "" : "sm:grid-cols-2"}`}>
                <label className={`block ${isMobileSurface ? "" : "sm:col-span-2"}`}>
                  <span className="mb-2 block text-sm font-medium text-slate-700">Timezone</span>
                  <select value={hours.timezone} onChange={(event) => setHours((current) => ({ ...current, timezone: event.target.value }))} className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 outline-none">
                    {timeZoneOptions.map((timeZone) => (
                      <option key={timeZone.value} value={timeZone.value}>{timeZone.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Opening time</span>
                  <input type="time" value={hours.start} onChange={(event) => setHours((current) => ({ ...current, start: event.target.value }))} className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 outline-none" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Closing time</span>
                  <input type="time" value={hours.end} onChange={(event) => setHours((current) => ({ ...current, end: event.target.value }))} className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 outline-none" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Appointments / hour</span>
                  <input type="number" min="1" max="12" value={hours.perHour} onChange={(event) => setHours((current) => ({ ...current, perHour: event.target.value }))} className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 outline-none" />
                </label>
              </div>
              <WizardActions isSaving={isSaving} canGoBack onBack={() => setActiveIndex((current) => Math.max(0, current - 1))} />
            </form>
          ) : null}

          {activeStep.key === "signature" ? (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-slate-600">Upload the doctor signature used on notes, letters, and PDFs.</p>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#2f8fd3] px-5 py-3 text-sm font-medium text-white">
                <Upload className="h-4 w-4" />
                {isSaving ? "Uploading..." : "Upload signature"}
                <input type="file" accept="image/png,image/jpeg" className="sr-only" disabled={isSaving} onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadSignature(file);
                  event.target.value = "";
                }} />
              </label>
              <OptionalActions isSaving={isSaving} onBack={() => setActiveIndex((current) => current - 1)} onSkip={skipOptional} showSubmit={false} />
            </div>
          ) : null}

          {activeStep.key === "email" ? (
            <form className="space-y-4" onSubmit={saveEmail}>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Sender name</span>
                <input value={email.sender_name} onChange={(event) => setEmail((current) => ({ ...current, sender_name: event.target.value }))} className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 outline-none" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Sender Gmail</span>
                <input type="email" value={email.sender_email} onChange={(event) => setEmail((current) => ({ ...current, sender_email: event.target.value }))} className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 outline-none" />
              </label>
              <PasswordInput label="Gmail app password" value={email.app_password} onChange={(event) => setEmail((current) => ({ ...current, app_password: event.target.value }))} placeholder={clinicSettings?.email_configured ? "Leave blank to keep current app password" : "16-character Gmail app password"} />
              <OptionalActions isSaving={isSaving} onBack={() => setActiveIndex((current) => current - 1)} onSkip={skipOptional} submitLabel="Save and continue" />
            </form>
          ) : null}

          {activeStep.key === "staff" ? (
            <form className="space-y-4" onSubmit={saveStaff}>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Staff email or phone</span>
                <input value={staff.identifier} onChange={(event) => setStaff((current) => ({ ...current, identifier: event.target.value }))} className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 outline-none" />
              </label>
              <PasswordInput label="Temporary password" value={staff.password} onChange={(event) => setStaff((current) => ({ ...current, password: event.target.value }))} placeholder="Minimum 12 characters" />
              {createdStaffUsers.length ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <p className="text-sm font-semibold text-emerald-900">Added in this setup</p>
                  <div className="mt-2 grid gap-2">
                    {createdStaffUsers.map((user) => (
                      <div key={user.id} className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-sm text-emerald-900">
                        <span>{user.identifier}</span>
                        <span className="text-xs uppercase tracking-[0.16em] text-emerald-700">{user.role}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                <button type="button" disabled={isSaving} onClick={() => setActiveIndex((current) => current - 1)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#bfd7e8] bg-white px-5 py-3 text-sm font-medium text-slate-700">
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </button>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button type="button" disabled={isSaving} onClick={skipOptional} className="rounded-xl border border-[#bfd7e8] bg-white px-5 py-3 text-sm font-medium text-slate-700">
                    {createdStaffUsers.length ? "Continue" : "Skip for now"}
                  </button>
                  <button type="submit" disabled={isSaving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2f8fd3] px-5 py-3 text-sm font-medium text-white disabled:opacity-60">
                    {isSaving ? "Creating..." : "Add staff user"}
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </form>
          ) : null}

          {activeStep.key === "template" ? (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-slate-600">{templateSettings?.document_template_name || "Upload a PDF, JPG, or PNG letterhead for generated documents."}</p>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#2f8fd3] px-5 py-3 text-sm font-medium text-white">
                <Upload className="h-4 w-4" />
                {isSaving ? "Uploading..." : "Upload letterhead"}
                <input type="file" accept=".pdf,image/png,image/jpeg" className="sr-only" disabled={isSaving} onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadTemplate(file);
                  event.target.value = "";
                }} />
              </label>
              <OptionalActions isSaving={isSaving} onBack={() => setActiveIndex((current) => current - 1)} onSkip={skipOptional} showSubmit={false} />
            </div>
          ) : null}

          {activeStep.key === "patient" ? (
            <form className="space-y-4" onSubmit={savePatient}>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Patient name</span>
                <input value={patient.name} onChange={(event) => setPatient((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 outline-none" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Phone</span>
                <input value={patient.phone} onChange={(event) => setPatient((current) => ({ ...current, phone: event.target.value }))} className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 outline-none" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Reason for visit</span>
                <input value={patient.reason} onChange={(event) => setPatient((current) => ({ ...current, reason: event.target.value }))} className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 outline-none" />
              </label>
              <OptionalActions isSaving={isSaving} onBack={() => setActiveIndex((current) => current - 1)} onSkip={skipOptional} submitLabel="Create and continue" />
            </form>
          ) : null}

          {activeStep.key === "done" ? (
            <div className="space-y-5">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                Specialty and clinic hours are ready. Optional setup can be completed later from the app.
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                <button type="button" onClick={() => setActiveIndex((current) => current - 1)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#bfd7e8] bg-white px-5 py-3 text-sm font-medium text-slate-700">
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </button>
                <button type="button" disabled={isSaving || !requiredComplete} onClick={() => void finishOnboarding()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2f8fd3] px-5 py-3 text-sm font-medium text-white disabled:opacity-60">
                  {isSaving ? "Finishing..." : "Enter workspace"}
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}

          {error ? <p className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
          {status ? <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{status}</p> : null}
          {!canGoNext && activeStep.key !== "done" ? <p className="mt-4 text-sm text-slate-500">Save this required step before continuing.</p> : null}
        </section>
      </div>
    </main>
  );
}

function WizardActions({
  isSaving,
  canGoBack,
  onBack,
}: {
  isSaving: boolean;
  canGoBack: boolean;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
      <button type="button" disabled={!canGoBack || isSaving} onClick={onBack} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#bfd7e8] bg-white px-5 py-3 text-sm font-medium text-slate-700 disabled:opacity-50">
        <ChevronLeft className="h-4 w-4" />
        Back
      </button>
      <button type="submit" disabled={isSaving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2f8fd3] px-5 py-3 text-sm font-medium text-white disabled:opacity-60">
        {isSaving ? "Saving..." : "Save and continue"}
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function OptionalActions({
  isSaving,
  onBack,
  onSkip,
  submitLabel = "Save and continue",
  showSubmit = true,
}: {
  isSaving: boolean;
  onBack: () => void;
  onSkip: () => void;
  submitLabel?: string;
  showSubmit?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
      <button type="button" disabled={isSaving} onClick={onBack} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#bfd7e8] bg-white px-5 py-3 text-sm font-medium text-slate-700">
        <ChevronLeft className="h-4 w-4" />
        Back
      </button>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="button" disabled={isSaving} onClick={onSkip} className="rounded-xl border border-[#bfd7e8] bg-white px-5 py-3 text-sm font-medium text-slate-700">
          Skip for now
        </button>
        {showSubmit ? (
          <button type="submit" disabled={isSaving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2f8fd3] px-5 py-3 text-sm font-medium text-white disabled:opacity-60">
            {isSaving ? "Saving..." : submitLabel}
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
