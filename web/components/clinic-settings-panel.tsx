"use client";

import { FormEvent, useEffect, useState } from "react";
import { ExternalLink, FileText, Trash2, Upload } from "lucide-react";

import { api } from "@/lib/api";
import { CLINIC_SPECIALTY_OPTIONS } from "@/lib/clinic-specialty";
import { DEFAULT_CLINIC_TIMEZONE, listSupportedTimeZones, normalizeTimeZoneValue } from "@/lib/timezone";
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
  timezone: string;
  appointment_start_time: string;
  appointment_end_time: string;
  appointments_per_hour: string;
  document_template_notes_enabled: boolean;
  document_template_letters_enabled: boolean;
  document_template_invoices_enabled: boolean;
  document_template_margin_top: string;
  document_template_margin_right: string;
  document_template_margin_bottom: string;
  document_template_margin_left: string;
};

function createForm(settings: ClinicSettings | null): ClinicSettingsForm {
  return {
    clinic_name: settings?.clinic_name ?? "",
    clinic_address: settings?.clinic_address ?? "",
    clinic_phone: settings?.clinic_phone ?? "",
    timezone: normalizeTimeZoneValue(settings?.timezone ?? DEFAULT_CLINIC_TIMEZONE),
    appointment_start_time: settings?.appointment_start_time ?? "09:00",
    appointment_end_time: settings?.appointment_end_time ?? "18:00",
    appointments_per_hour: String(settings?.appointments_per_hour ?? 4),
    document_template_notes_enabled: settings?.document_template_notes_enabled ?? false,
    document_template_letters_enabled: settings?.document_template_letters_enabled ?? false,
    document_template_invoices_enabled: settings?.document_template_invoices_enabled ?? false,
    document_template_margin_top: String(settings?.document_template_margin_top ?? 54),
    document_template_margin_right: String(settings?.document_template_margin_right ?? 54),
    document_template_margin_bottom: String(settings?.document_template_margin_bottom ?? 54),
    document_template_margin_left: String(settings?.document_template_margin_left ?? 54),
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
  const [isUploadingTemplate, setIsUploadingTemplate] = useState(false);
  const [isRemovingTemplate, setIsRemovingTemplate] = useState(false);
  const [isOpeningTemplate, setIsOpeningTemplate] = useState(false);
  const timeZoneOptions = listSupportedTimeZones(form.timezone);
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

    const templateMargins = {
      top: Number(form.document_template_margin_top),
      right: Number(form.document_template_margin_right),
      bottom: Number(form.document_template_margin_bottom),
      left: Number(form.document_template_margin_left),
    };
    if (Object.values(templateMargins).some((margin) => !Number.isFinite(margin) || margin < 0 || margin > 288)) {
      setError("Document template margins must be between 0 and 288 points.");
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
        timezone: form.timezone,
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
        document_template_notes_enabled: form.document_template_notes_enabled,
        document_template_letters_enabled: form.document_template_letters_enabled,
        document_template_invoices_enabled: form.document_template_invoices_enabled,
        document_template_margin_top: templateMargins.top,
        document_template_margin_right: templateMargins.right,
        document_template_margin_bottom: templateMargins.bottom,
        document_template_margin_left: templateMargins.left,
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

  async function handleTemplateUpload(file: File) {
    if (!canEdit) return;
    setIsUploadingTemplate(true);
    setError("");
    setStatus("");
    try {
      const saved = await api.uploadClinicDocumentTemplate(file);
      setForm(createForm(saved));
      onSaved?.(saved);
      setStatus("Document template uploaded and enabled for notes, letters, and invoices.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to upload document template.");
    } finally {
      setIsUploadingTemplate(false);
    }
  }

  async function handleTemplateOpen() {
    setIsOpeningTemplate(true);
    setError("");
    try {
      const blob = await api.downloadClinicDocumentTemplate();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Failed to open document template.");
    } finally {
      setIsOpeningTemplate(false);
    }
  }

  async function handleTemplateRemove() {
    if (!canEdit) return;
    setIsRemovingTemplate(true);
    setError("");
    setStatus("");
    try {
      const saved = await api.removeClinicDocumentTemplate();
      setForm(createForm(saved));
      onSaved?.(saved);
      setStatus("Document template removed. PDFs will use the clinic header and footer.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Failed to remove document template.");
    } finally {
      setIsRemovingTemplate(false);
    }
  }

  if (!settings) {
    return (
      <section className="rounded-[18px] border border-[#dbe7ef] bg-white p-6 text-sm text-slate-600">
        Loading clinic settings...
      </section>
    );
  }

  const hasDocumentTemplate = Boolean(settings.document_template_name || settings.document_template_url);

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
          <span className="text-sm font-medium text-slate-700">Timezone</span>
          <select
            value={form.timezone}
            disabled={!canEdit}
            onChange={(event) => setForm((current) => ({ ...current, timezone: event.target.value }))}
            className="h-11 rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition focus:border-[#6daed8] disabled:text-slate-500"
          >
            {timeZoneOptions.map((timeZone) => (
              <option key={timeZone.value} value={timeZone.value}>{timeZone.label}</option>
            ))}
          </select>
        </label>

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

        <section className="mt-3 border-t border-[#dbe7ef] pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Document template</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">Clinic letterhead and PDF background</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                Upload one PDF, JPG, or PNG page. Generated content is placed over it using the margins below.
              </p>
            </div>
            <span className="rounded-xl border border-[#bfd7e8] bg-[#edf5fa] px-3 py-2 text-xs font-semibold text-[#2a6fa8]">
              {hasDocumentTemplate ? "Template active" : "Default layout"}
            </span>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#dbe7ef] bg-[#f3f8fb]/50 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#dbe7ef] bg-white text-[#2a6fa8]">
                <FileText className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {settings.document_template_name || "No template uploaded"}
                </p>
                <p className="mt-1 text-xs text-slate-500">PDF, JPG, or PNG · maximum 10 MB</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {hasDocumentTemplate ? (
                <button
                  type="button"
                  disabled={isOpeningTemplate}
                  onClick={() => void handleTemplateOpen()}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#9fc7e1] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#edf5fa] disabled:opacity-60"
                >
                  <ExternalLink className="h-4 w-4" />
                  {isOpeningTemplate ? "Opening..." : "View"}
                </button>
              ) : null}
              <label className={`inline-flex items-center gap-2 rounded-xl bg-[#2f8fd3] px-4 py-2 text-sm font-medium text-white transition ${canEdit && !isUploadingTemplate && !isRemovingTemplate ? "cursor-pointer hover:bg-[#287fc0]" : "cursor-not-allowed opacity-60"}`}>
                <Upload className="h-4 w-4" />
                {isUploadingTemplate ? "Uploading..." : hasDocumentTemplate ? "Replace" : "Upload template"}
                <input
                  type="file"
                  accept=".pdf,image/png,image/jpeg"
                  disabled={!canEdit || isUploadingTemplate || isRemovingTemplate}
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleTemplateUpload(file);
                    event.target.value = "";
                  }}
                />
              </label>
              {hasDocumentTemplate ? (
                <button
                  type="button"
                  disabled={!canEdit || isRemovingTemplate || isUploadingTemplate}
                  onClick={() => void handleTemplateRemove()}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                  {isRemovingTemplate ? "Removing..." : "Remove"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <p className="text-sm font-semibold text-slate-900">Use template for</p>
              <div className="mt-3 flex flex-wrap gap-4">
                {[
                  ["document_template_notes_enabled", "Notes"],
                  ["document_template_letters_enabled", "Letters"],
                  ["document_template_invoices_enabled", "Invoices"],
                ].map(([key, label]) => (
                  <label key={key} className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={form[key as keyof Pick<ClinicSettingsForm, "document_template_notes_enabled" | "document_template_letters_enabled" | "document_template_invoices_enabled">]}
                      disabled={!canEdit || !hasDocumentTemplate}
                      onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.checked }))}
                      className="h-4 w-4 rounded border-[#9fc7e1] text-[#2f8fd3] focus:ring-[#6daed8]"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-900">Content margins</p>
              <p className="mt-1 text-xs text-slate-500">Points from each page edge; 72 points equals one inch.</p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["document_template_margin_top", "Top"],
                  ["document_template_margin_right", "Right"],
                  ["document_template_margin_bottom", "Bottom"],
                  ["document_template_margin_left", "Left"],
                ].map(([key, label]) => (
                  <label key={key} className="grid gap-1.5">
                    <span className="text-xs font-medium text-slate-600">{label}</span>
                    <input
                      type="number"
                      min="0"
                      max="288"
                      step="1"
                      value={form[key as keyof Pick<ClinicSettingsForm, "document_template_margin_top" | "document_template_margin_right" | "document_template_margin_bottom" | "document_template_margin_left">]}
                      disabled={!canEdit || !hasDocumentTemplate}
                      onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                      className="h-10 min-w-0 rounded-xl border border-[#bfd7e8] bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-[#6daed8] disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      {error ? <p className="mt-4 text-sm font-medium text-rose-600">{error}</p> : null}
      {status ? <p className="mt-4 text-sm font-medium text-emerald-700">{status}</p> : null}

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={!canEdit || isSaving || isUploadingTemplate || isRemovingTemplate}
          className="rounded-xl bg-[#2f8fd3] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
