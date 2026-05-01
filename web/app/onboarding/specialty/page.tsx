"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Stethoscope } from "lucide-react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { api } from "@/lib/api";
import { CLINIC_SPECIALTY_OPTIONS, type ClinicSpecialty } from "@/lib/clinic-specialty";
import { authStorage } from "@/lib/auth";

export default function SpecialtyOnboardingPage() {
  const router = useRouter();
  const { clinicSettings, currentUser, isAuthReady, isRedirectingToLogin, applyClinicSettings } = useClinicShell();
  const [selectedSpecialty, setSelectedSpecialty] = useState<ClinicSpecialty>("optometry");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin) {
      return;
    }
    if (!currentUser) {
      router.replace("/login");
      return;
    }
    if (clinicSettings?.clinic_specialty) {
      authStorage.setSpecialtyOnboardingPending(false);
      router.replace("/");
      return;
    }
  }, [clinicSettings, currentUser, isAuthReady, isRedirectingToLogin, router]);

  useEffect(() => {
    if (clinicSettings?.clinic_specialty) {
      setSelectedSpecialty(clinicSettings.clinic_specialty);
    }
  }, [clinicSettings]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clinicSettings) {
      setError("Clinic settings are still loading. Please try again.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      const saved = await api.updateClinicSettings({
        clinic_name: clinicSettings.clinic_name,
        clinic_address: clinicSettings.clinic_address,
        clinic_phone: clinicSettings.clinic_phone,
        clinic_specialty: selectedSpecialty,
        appointment_start_time: clinicSettings.appointment_start_time,
        appointment_end_time: clinicSettings.appointment_end_time,
        appointments_per_hour: clinicSettings.appointments_per_hour,
        doctor_name: clinicSettings.doctor_name,
        sender_name: clinicSettings.sender_name,
        sender_email: clinicSettings.sender_email,
        email_configured: clinicSettings.email_configured,
        custom_header: clinicSettings.custom_header,
        custom_footer: clinicSettings.custom_footer,
        document_template_name: clinicSettings.document_template_name,
        document_template_url: clinicSettings.document_template_url,
        document_template_notes_enabled: clinicSettings.document_template_notes_enabled,
        document_template_letters_enabled: clinicSettings.document_template_letters_enabled,
        document_template_invoices_enabled: clinicSettings.document_template_invoices_enabled,
        document_template_margin_top: clinicSettings.document_template_margin_top,
        document_template_margin_right: clinicSettings.document_template_margin_right,
        document_template_margin_bottom: clinicSettings.document_template_margin_bottom,
        document_template_margin_left: clinicSettings.document_template_margin_left,
      });
      authStorage.setSpecialtyOnboardingPending(false);
      applyClinicSettings(saved);
      router.replace("/");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save specialty.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e0f2fe_0%,#f8fafc_42%,#f8fafc_100%)] px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl items-center">
        <section className="w-full rounded-[36px] border border-sky-100 bg-white/95 p-8 shadow-[0_25px_80px_rgba(125,211,252,0.18)] sm:p-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs tracking-[0.22em] text-sky-700">
            <Stethoscope className="h-3.5 w-3.5" />
            Clinic Setup
          </div>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-900">
            Select your clinic specialty
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600">
            This only controls specialty-specific modules. Your shared workflow stays the same, and you can update this later from Clinic Settings.
          </p>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <div className="grid gap-4">
              {CLINIC_SPECIALTY_OPTIONS.map((option) => {
                const isSelected = selectedSpecialty === option.value;
                return (
                  <label
                    key={option.value}
                    className={`block cursor-pointer rounded-[28px] border px-5 py-5 transition ${
                      isSelected
                        ? "border-sky-400 bg-sky-50 shadow-[0_18px_50px_rgba(14,165,233,0.12)]"
                        : "border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="clinic-specialty"
                      value={option.value}
                      checked={isSelected}
                      onChange={() => setSelectedSpecialty(option.value)}
                      className="sr-only"
                    />
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-lg font-semibold text-slate-900">{option.label}</p>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{option.description}</p>
                      </div>
                      <div className={`mt-1 h-5 w-5 rounded-full border-2 ${isSelected ? "border-sky-500 bg-sky-500" : "border-slate-300 bg-white"}`} />
                    </div>
                  </label>
                );
              })}
            </div>

            {error ? (
              <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isSaving || !isAuthReady}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Continue"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
