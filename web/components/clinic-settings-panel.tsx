"use client";

import { FormEvent, useEffect, useState } from "react";

import { CLINIC_SPECIALTY_OPTIONS } from "@/lib/clinic-specialty";
import type { AuthUser, ClinicSettings, ClinicSettingsUpdatePayload } from "@/lib/types";

type ClinicSettingsPanelProps = {
  settings: ClinicSettings | null;
  currentUser: AuthUser | null;
  onSave: (payload: ClinicSettingsUpdatePayload) => Promise<ClinicSettings | void>;
  onSaved?: (settings: ClinicSettings) => void;
};

type ClinicSettingsForm = {
  clinic_name: string;
  clinic_address: string;
  clinic_phone: string;
  appointment_start_time: string;
  appointment_end_time: string;
  appointments_per_hour: string;
};

function createForm(settings: ClinicSettings | null): ClinicSettingsForm {
  return {
    clinic_name: settings?.clinic_name ?? "",
    clinic_address: settings?.clinic_address ?? "",
    clinic_phone: settings?.clinic_phone ?? "",
    appointment_start_time: settings?.appointment_start_time ?? "09:00",
    appointment_end_time: settings?.appointment_end_time ?? "18:00",
    appointments_per_hour: String(settings?.appointments_per_hour ?? 4),
  };
}

export function ClinicSettingsPanel({
  settings,
  currentUser,
  onSave,
  onSaved,
}: ClinicSettingsPanelProps) {
  const [form, setForm] = useState(() => createForm(settings));
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const canEdit = currentUser?.role === "admin";
  const specialtyLabel =
    CLINIC_SPECIALTY_OPTIONS.find((option) => option.value === settings?.clinic_specialty)?.label ??
    "Not set";

  useEffect(() => {
    setForm(createForm(settings));
    setError("");
    setStatus("");
  }, [settings]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || !canEdit) {
      return;
    }

    const appointmentsPerHour = Number(form.appointments_per_hour);
    if (!Number.isFinite(appointmentsPerHour) || appointmentsPerHour < 1) {
      setError("Appointments / hour must be at least 1.");
      return;
    }

    setIsSaving(true);
    setError("");
    setStatus("");
    try {
      const saved = await onSave({
        clinic_name: form.clinic_name.trim(),
        clinic_address: form.clinic_address.trim(),
        clinic_phone: form.clinic_phone.trim(),
        clinic_specialty: settings.clinic_specialty,
        appointment_start_time: form.appointment_start_time,
        appointment_end_time: form.appointment_end_time,
        appointments_per_hour: appointmentsPerHour,
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
      });
      if (saved) {
        onSaved?.(saved);
      }
      setStatus("Clinic settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save clinic settings.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!settings) {
    return (
      <section className="rounded-[18px] border border-[#dbe7ef] bg-white p-6 text-sm text-slate-600">
        Loading clinic settings...
      </section>
    );
  }

  return (
    <form
      className="rounded-[18px] border border-[#dbe7ef] bg-white p-5 shadow-[0_14px_38px_rgba(64,131,181,0.09)]"
      onSubmit={handleSubmit}
    >
      <div className="grid gap-4">
        <label className="grid gap-2 md:grid-cols-[180px_1fr] md:items-center">
          <span className="text-sm font-medium text-slate-700">Clinic Name</span>
          <input
            value={form.clinic_name}
            disabled={!canEdit}
            onChange={(event) => setForm((current) => ({ ...current, clinic_name: event.target.value }))}
            className="h-11 rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition focus:border-[#6daed8] disabled:text-slate-500"
          />
        </label>

        <label className="grid gap-2 md:grid-cols-[180px_1fr] md:items-center">
          <span className="text-sm font-medium text-slate-700">Clinic Phone</span>
          <input
            value={form.clinic_phone}
            disabled={!canEdit}
            onChange={(event) => setForm((current) => ({ ...current, clinic_phone: event.target.value }))}
            className="h-11 rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition focus:border-[#6daed8] disabled:text-slate-500"
          />
        </label>

        <div className="grid gap-2 md:grid-cols-[180px_1fr] md:items-center">
          <span className="text-sm font-medium text-slate-700">Specialty</span>
          <div className="flex h-11 items-center rounded-xl border border-[#dbe7ef] bg-[#edf5fa] px-4 text-slate-700">
            {specialtyLabel}
          </div>
        </div>

        <label className="grid gap-2 md:grid-cols-[180px_1fr] md:items-center">
          <span className="text-sm font-medium text-slate-700">Address</span>
          <input
            value={form.clinic_address}
            disabled={!canEdit}
            onChange={(event) => setForm((current) => ({ ...current, clinic_address: event.target.value }))}
            className="h-11 rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition focus:border-[#6daed8] disabled:text-slate-500"
          />
        </label>

        <div className="grid gap-4 md:grid-cols-[180px_1fr_1fr_1fr] md:items-end">
          <div className="hidden text-sm font-semibold text-slate-900 md:block">Working hours</div>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-slate-700">Opening Time</span>
            <input
              type="time"
              value={form.appointment_start_time}
              disabled={!canEdit}
              onChange={(event) => setForm((current) => ({ ...current, appointment_start_time: event.target.value }))}
              className="h-11 rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition focus:border-[#6daed8] disabled:text-slate-500"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-slate-700">Closing Time</span>
            <input
              type="time"
              value={form.appointment_end_time}
              disabled={!canEdit}
              onChange={(event) => setForm((current) => ({ ...current, appointment_end_time: event.target.value }))}
              className="h-11 rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition focus:border-[#6daed8] disabled:text-slate-500"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-slate-700">Appointments / Hour</span>
            <input
              type="number"
              min="1"
              max="12"
              step="1"
              value={form.appointments_per_hour}
              disabled={!canEdit}
              onChange={(event) => setForm((current) => ({ ...current, appointments_per_hour: event.target.value }))}
              className="h-11 rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition focus:border-[#6daed8] disabled:text-slate-500"
            />
          </label>
        </div>
      </div>

      {error ? <p className="mt-4 text-sm font-medium text-rose-600">{error}</p> : null}
      {status ? <p className="mt-4 text-sm font-medium text-emerald-700">{status}</p> : null}

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={!canEdit || isSaving}
          className="rounded-xl bg-[#2f8fd3] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
