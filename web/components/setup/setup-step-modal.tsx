"use client";

import { FormEvent, useEffect, useState } from "react";
import { Clock, FileText, Mail, PenLine, Settings2, Stethoscope, Trash2, Upload, UserPlus, X } from "lucide-react";

import { PasswordInput } from "@/components/password-input";
import { api } from "@/lib/api";
import { CLINIC_SPECIALTY_OPTIONS, type ClinicSpecialty } from "@/lib/clinic-specialty";
import type { ClinicSetupStepKey } from "@/lib/setup-checklist";
import type { AuthUser, ClinicSettings, ClinicSettingsUpdatePayload } from "@/lib/types";

type SetupStepModalProps = {
  stepKey: ClinicSetupStepKey | null;
  settings: ClinicSettings | null;
  currentUser: AuthUser | null;
  onClose: () => void;
  onComplete: (stepKey: ClinicSetupStepKey) => void;
  onSaveClinic: (payload: ClinicSettingsUpdatePayload) => Promise<ClinicSettings | void>;
  onClinicSettingsChange: (settings: ClinicSettings) => void;
  onCurrentUserChange: (user: AuthUser | null) => void;
  onAddUser: (payload: { identifier: string; password: string }) => Promise<void>;
  onLoadUsers: () => Promise<AuthUser[]>;
};

function buildSettingsPayload(
  settings: ClinicSettings,
  patch: Partial<ClinicSettingsUpdatePayload>,
): ClinicSettingsUpdatePayload {
  return {
    clinic_name: settings.clinic_name,
    clinic_address: settings.clinic_address,
    clinic_phone: settings.clinic_phone,
    clinic_specialty: settings.clinic_specialty,
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
    ...patch,
  };
}

function stepTitle(stepKey: ClinicSetupStepKey) {
  switch (stepKey) {
    case "specialty":
      return "Select specialty";
    case "hours":
      return "Set clinic hours";
    case "signature":
      return "Upload your signature";
    case "sender_email":
      return "Configure sender email";
    case "first_staff_user":
      return "Add first staff user";
    case "document_template":
      return "Upload document template";
    default:
      return "Create first patient";
  }
}

function stepIcon(stepKey: ClinicSetupStepKey) {
  switch (stepKey) {
    case "specialty":
      return Stethoscope;
    case "hours":
      return Clock;
    case "signature":
      return PenLine;
    case "sender_email":
      return Mail;
    case "first_staff_user":
      return UserPlus;
    case "document_template":
      return FileText;
    default:
      return Settings2;
  }
}

function LoadingSettingsState() {
  return (
    <div className="rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-3 text-sm text-slate-600">
      Clinic settings are still loading. Try again in a moment.
    </div>
  );
}

function SpecialtySetup({
  settings,
  onSaveClinic,
  onClinicSettingsChange,
  onComplete,
}: Pick<SetupStepModalProps, "settings" | "onSaveClinic" | "onClinicSettingsChange"> & {
  onComplete: () => void;
}) {
  const [selectedSpecialty, setSelectedSpecialty] = useState<ClinicSpecialty | null>(
    settings?.clinic_specialty ?? null,
  );
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setSelectedSpecialty(settings?.clinic_specialty ?? null);
    setError("");
  }, [settings]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) {
      setError("Clinic settings are still loading.");
      return;
    }
    if (!selectedSpecialty) {
      setError("Choose a clinic specialty.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      const saved = await onSaveClinic(buildSettingsPayload(settings, { clinic_specialty: selectedSpecialty }));
      if (saved) {
        onClinicSettingsChange(saved);
      }
      onComplete();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save specialty.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!settings) {
    return <LoadingSettingsState />;
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid gap-3">
        {CLINIC_SPECIALTY_OPTIONS.map((option) => {
          const isSelected = selectedSpecialty === option.value;
          return (
            <label
              key={option.value}
              className={`block cursor-pointer rounded-2xl border px-4 py-4 transition ${
                isSelected ? "border-sky-400 bg-sky-50" : "border-slate-200 bg-white hover:border-sky-200"
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
                  <p className="text-sm font-semibold text-slate-900">{option.label}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{option.description}</p>
                </div>
                <div className={`mt-1 h-5 w-5 rounded-full border-2 ${isSelected ? "border-sky-500 bg-sky-500" : "border-slate-300"}`} />
              </div>
            </label>
          );
        })}
      </div>
      {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
      <div className="flex justify-end">
        <button type="submit" disabled={isSaving} className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60">
          {isSaving ? "Saving..." : "Save specialty"}
        </button>
      </div>
    </form>
  );
}

function HoursSetup({
  settings,
  onSaveClinic,
  onClinicSettingsChange,
  onComplete,
}: Pick<SetupStepModalProps, "settings" | "onSaveClinic" | "onClinicSettingsChange"> & {
  onComplete: () => void;
}) {
  const [form, setForm] = useState({
    appointment_start_time: settings?.appointment_start_time ?? "",
    appointment_end_time: settings?.appointment_end_time ?? "",
    appointments_per_hour: String(settings?.appointments_per_hour ?? 4),
  });
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setForm({
      appointment_start_time: settings?.appointment_start_time ?? "",
      appointment_end_time: settings?.appointment_end_time ?? "",
      appointments_per_hour: String(settings?.appointments_per_hour ?? 4),
    });
    setError("");
  }, [settings]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) {
      setError("Clinic settings are still loading.");
      return;
    }
    if (!form.appointment_start_time || !form.appointment_end_time) {
      setError("Set both clinic opening and closing times.");
      return;
    }
    if (form.appointment_start_time >= form.appointment_end_time) {
      setError("Clinic closing time must be after opening time.");
      return;
    }
    const appointmentsPerHour = Number(form.appointments_per_hour);
    if (!Number.isInteger(appointmentsPerHour) || appointmentsPerHour < 1 || appointmentsPerHour > 12) {
      setError("Appointments per hour must be a whole number between 1 and 12.");
      return;
    }
    if (60 % appointmentsPerHour !== 0) {
      setError("Appointments per hour must divide evenly into 60 minutes.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      const saved = await onSaveClinic(
        buildSettingsPayload(settings, {
          appointment_start_time: form.appointment_start_time,
          appointment_end_time: form.appointment_end_time,
          appointments_per_hour: appointmentsPerHour,
        }),
      );
      if (saved) {
        onClinicSettingsChange(saved);
      }
      onComplete();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save clinic hours.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!settings) {
    return <LoadingSettingsState />;
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Opening time</span>
          <input
            type="time"
            value={form.appointment_start_time}
            onChange={(event) => setForm((current) => ({ ...current, appointment_start_time: event.target.value }))}
            className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none focus:border-sky-400"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Closing time</span>
          <input
            type="time"
            value={form.appointment_end_time}
            onChange={(event) => setForm((current) => ({ ...current, appointment_end_time: event.target.value }))}
            className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none focus:border-sky-400"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Appointments / hour</span>
          <input
            type="number"
            min="1"
            max="12"
            step="1"
            value={form.appointments_per_hour}
            onChange={(event) => setForm((current) => ({ ...current, appointments_per_hour: event.target.value }))}
            className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none focus:border-sky-400"
          />
        </label>
      </div>
      {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
      <div className="flex justify-end">
        <button type="submit" disabled={isSaving} className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60">
          {isSaving ? "Saving..." : "Save hours"}
        </button>
      </div>
    </form>
  );
}

function SignatureSetup({
  currentUser,
  onCurrentUserChange,
  onComplete,
}: Pick<SetupStepModalProps, "currentUser" | "onCurrentUserChange"> & { onComplete: () => void }) {
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleUpload(file: File) {
    setIsSaving(true);
    setError("");
    try {
      const updated = await api.uploadMySignature(file);
      onCurrentUserChange(updated);
      onComplete();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to upload signature.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemove() {
    setIsSaving(true);
    setError("");
    try {
      const updated = await api.removeMySignature();
      onCurrentUserChange(updated);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to remove signature.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-4">
        {currentUser?.doctor_signature_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8001"}${currentUser.doctor_signature_url}`}
            alt="User signature"
            className="max-h-28 w-auto max-w-full object-contain"
          />
        ) : (
          <p className="text-sm text-slate-500">No signature uploaded yet.</p>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600">
          <Upload className="h-4 w-4" />
          {isSaving ? "Uploading..." : "Upload signature"}
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            disabled={isSaving}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleUpload(file);
              }
              event.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          disabled={!currentUser?.doctor_signature_name || isSaving}
          onClick={() => void handleRemove()}
          className="rounded-full border border-rose-200 bg-white px-5 py-2.5 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
        >
          Remove
        </button>
      </div>
      {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
    </div>
  );
}

function EmailSetup({
  settings,
  onSaveClinic,
  onClinicSettingsChange,
  onComplete,
}: Pick<SetupStepModalProps, "settings" | "onSaveClinic" | "onClinicSettingsChange"> & {
  onComplete: () => void;
}) {
  const [form, setForm] = useState({
    sender_name: settings?.sender_name ?? "",
    sender_email: settings?.sender_email ?? "",
    sender_email_app_password: "",
  });
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setForm({
      sender_name: settings?.sender_name ?? "",
      sender_email: settings?.sender_email ?? "",
      sender_email_app_password: "",
    });
    setError("");
  }, [settings]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) {
      setError("Clinic settings are still loading.");
      return;
    }
    if (!form.sender_email.trim() || !form.sender_email.includes("@")) {
      setError("Sender email must be a valid email address.");
      return;
    }
    if (!settings.email_configured && !form.sender_email_app_password.trim()) {
      setError("Enter the Gmail app password.");
      return;
    }

    const patch: Partial<ClinicSettingsUpdatePayload> = {
      sender_name: form.sender_name.trim(),
      sender_email: form.sender_email.trim(),
      email_configured: Boolean(form.sender_email.trim() && (settings.email_configured || form.sender_email_app_password.trim())),
    };
    if (form.sender_email_app_password.trim()) {
      patch.sender_email_app_password = form.sender_email_app_password.trim();
    }

    setIsSaving(true);
    setError("");
    try {
      const saved = await onSaveClinic(buildSettingsPayload(settings, patch));
      if (saved) {
        onClinicSettingsChange(saved);
        if (!saved.email_configured) {
          setError("Email settings saved, but sender email is not fully configured yet.");
          return;
        }
      }
      onComplete();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save sender email.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!settings) {
    return <LoadingSettingsState />;
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-slate-700">Sender name</span>
        <input
          value={form.sender_name}
          onChange={(event) => setForm((current) => ({ ...current, sender_name: event.target.value }))}
          className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none focus:border-sky-400"
        />
      </label>
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-slate-700">Sender Gmail</span>
        <input
          type="email"
          value={form.sender_email}
          onChange={(event) => setForm((current) => ({ ...current, sender_email: event.target.value }))}
          className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none focus:border-sky-400"
        />
      </label>
      <PasswordInput
        label="Gmail app password"
        value={form.sender_email_app_password}
        onChange={(event) => setForm((current) => ({ ...current, sender_email_app_password: event.target.value }))}
        placeholder={settings.email_configured ? "Leave blank to keep current app password" : "16-character Gmail app password"}
      />
      {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
      <div className="flex justify-end">
        <button type="submit" disabled={isSaving} className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60">
          {isSaving ? "Saving..." : "Save email"}
        </button>
      </div>
    </form>
  );
}

function StaffUserSetup({
  onAddUser,
  onLoadUsers,
  onComplete,
}: Pick<SetupStepModalProps, "onAddUser" | "onLoadUsers"> & { onComplete: () => void }) {
  const [form, setForm] = useState({ identifier: "", password: "" });
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.identifier.trim()) {
      setError("Email or phone number is required.");
      return;
    }
    if (form.password.length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await onAddUser({ identifier: form.identifier.trim(), password: form.password });
      await onLoadUsers();
      onComplete();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to create staff user.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-slate-700">Email or phone number</span>
        <input
          value={form.identifier}
          onChange={(event) => setForm((current) => ({ ...current, identifier: event.target.value }))}
          className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none focus:border-sky-400"
        />
      </label>
      <PasswordInput
        label="Password"
        value={form.password}
        onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
        placeholder="Minimum 4 characters"
      />
      {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
      <div className="flex justify-end">
        <button type="submit" disabled={isSaving} className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60">
          {isSaving ? "Creating..." : "Create staff user"}
        </button>
      </div>
    </form>
  );
}

function DocumentTemplateSetup({
  settings,
  onSaveClinic,
  onClinicSettingsChange,
  onComplete,
}: Pick<SetupStepModalProps, "settings" | "onSaveClinic" | "onClinicSettingsChange"> & {
  onComplete: () => void;
}) {
  const [form, setForm] = useState({
    notes: settings?.document_template_notes_enabled ?? false,
    letters: settings?.document_template_letters_enabled ?? false,
    invoices: settings?.document_template_invoices_enabled ?? false,
    top: String(settings?.document_template_margin_top ?? 54),
    right: String(settings?.document_template_margin_right ?? 54),
    bottom: String(settings?.document_template_margin_bottom ?? 54),
    left: String(settings?.document_template_margin_left ?? 54),
  });
  const [currentSettings, setCurrentSettings] = useState<ClinicSettings | null>(settings);
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setCurrentSettings(settings);
    setForm({
      notes: settings?.document_template_notes_enabled ?? false,
      letters: settings?.document_template_letters_enabled ?? false,
      invoices: settings?.document_template_invoices_enabled ?? false,
      top: String(settings?.document_template_margin_top ?? 54),
      right: String(settings?.document_template_margin_right ?? 54),
      bottom: String(settings?.document_template_margin_bottom ?? 54),
      left: String(settings?.document_template_margin_left ?? 54),
    });
    setError("");
  }, [settings]);

  const activeSettings = currentSettings ?? settings;
  const hasTemplate = Boolean(activeSettings?.document_template_name || activeSettings?.document_template_url);

  async function handleUpload(file: File) {
    setIsUploading(true);
    setError("");
    try {
      const updated = await api.uploadClinicDocumentTemplate(file);
      setCurrentSettings(updated);
      onClinicSettingsChange(updated);
      setForm((current) => ({
        ...current,
        notes: updated.document_template_notes_enabled || true,
        letters: updated.document_template_letters_enabled || true,
        invoices: updated.document_template_invoices_enabled || true,
      }));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to upload document template.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleRemove() {
    setIsUploading(true);
    setError("");
    try {
      const updated = await api.removeClinicDocumentTemplate();
      setCurrentSettings(updated);
      onClinicSettingsChange(updated);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Failed to remove document template.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeSettings) {
      setError("Clinic settings are still loading.");
      return;
    }
    if (!hasTemplate) {
      setError("Upload a document template first.");
      return;
    }

    const margins = {
      top: Number(form.top),
      right: Number(form.right),
      bottom: Number(form.bottom),
      left: Number(form.left),
    };
    if (Object.values(margins).some((value) => !Number.isFinite(value) || value < 0)) {
      setError("Template margins must be valid positive numbers or zero.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      const saved = await onSaveClinic(
        buildSettingsPayload(activeSettings, {
          document_template_notes_enabled: form.notes,
          document_template_letters_enabled: form.letters,
          document_template_invoices_enabled: form.invoices,
          document_template_margin_top: margins.top,
          document_template_margin_right: margins.right,
          document_template_margin_bottom: margins.bottom,
          document_template_margin_left: margins.left,
        }),
      );
      if (saved) {
        onClinicSettingsChange(saved);
      }
      onComplete();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save document template.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!activeSettings) {
    return <LoadingSettingsState />;
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {activeSettings.document_template_name || "No document template uploaded"}
            </p>
            <p className="mt-1 text-xs text-slate-500">PDF, JPG, or PNG template for generated documents.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-sky-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-sky-50">
              <Upload className="h-4 w-4" />
              {isUploading ? "Uploading..." : "Upload"}
              <input
                type="file"
                accept=".pdf,image/png,image/jpeg"
                className="sr-only"
                disabled={isUploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void handleUpload(file);
                  }
                  event.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              disabled={!hasTemplate || isUploading}
              onClick={() => void handleRemove()}
              className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              Remove
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-5">
        {[
          { key: "notes" as const, label: "Notes" },
          { key: "letters" as const, label: "Letters" },
          { key: "invoices" as const, label: "Invoices" },
        ].map((item) => (
          <label key={item.key} className="inline-flex items-center gap-3 text-sm font-medium text-slate-800">
            <input
              type="checkbox"
              checked={form[item.key]}
              disabled={!hasTemplate}
              onChange={(event) => setForm((current) => ({ ...current, [item.key]: event.target.checked }))}
              className="h-4 w-4 rounded border-sky-300 text-sky-500 focus:ring-sky-400"
            />
            <span>{item.label}</span>
          </label>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { key: "top" as const, label: "Top" },
          { key: "right" as const, label: "Right" },
          { key: "bottom" as const, label: "Bottom" },
          { key: "left" as const, label: "Left" },
        ].map((item) => (
          <label key={item.key} className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">{item.label}</span>
            <input
              type="number"
              min="0"
              max="288"
              step="0.1"
              value={form[item.key]}
              disabled={!hasTemplate}
              onChange={(event) => setForm((current) => ({ ...current, [item.key]: event.target.value }))}
              className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none focus:border-sky-400 disabled:opacity-60"
            />
          </label>
        ))}
      </div>
      {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
      <div className="flex justify-end">
        <button type="submit" disabled={isSaving || isUploading} className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60">
          {isSaving ? "Saving..." : "Save template setup"}
        </button>
      </div>
    </form>
  );
}

export function SetupStepModal({
  stepKey,
  settings,
  currentUser,
  onClose,
  onComplete,
  onSaveClinic,
  onClinicSettingsChange,
  onCurrentUserChange,
  onAddUser,
  onLoadUsers,
}: SetupStepModalProps) {
  if (!stepKey || stepKey === "first_patient") {
    return null;
  }

  const Icon = stepIcon(stepKey);
  const complete = () => onComplete(stepKey);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <button type="button" aria-label="Close setup step" className="absolute inset-0" onClick={onClose} />
      <section className="relative z-10 flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[32px] border border-sky-200 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.24)]">
        <div className="flex items-start justify-between gap-4 border-b border-sky-100 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-sky-50 p-3 text-sky-700">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Clinic Setup</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">{stepTitle(stepKey)}</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-sky-200 p-2 text-slate-600 hover:bg-sky-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {stepKey === "specialty" ? (
            <SpecialtySetup settings={settings} onSaveClinic={onSaveClinic} onClinicSettingsChange={onClinicSettingsChange} onComplete={complete} />
          ) : null}
          {stepKey === "hours" ? (
            <HoursSetup settings={settings} onSaveClinic={onSaveClinic} onClinicSettingsChange={onClinicSettingsChange} onComplete={complete} />
          ) : null}
          {stepKey === "signature" ? (
            <SignatureSetup currentUser={currentUser} onCurrentUserChange={onCurrentUserChange} onComplete={complete} />
          ) : null}
          {stepKey === "sender_email" ? (
            <EmailSetup settings={settings} onSaveClinic={onSaveClinic} onClinicSettingsChange={onClinicSettingsChange} onComplete={complete} />
          ) : null}
          {stepKey === "first_staff_user" ? (
            <StaffUserSetup onAddUser={onAddUser} onLoadUsers={onLoadUsers} onComplete={complete} />
          ) : null}
          {stepKey === "document_template" ? (
            <DocumentTemplateSetup settings={settings} onSaveClinic={onSaveClinic} onClinicSettingsChange={onClinicSettingsChange} onComplete={complete} />
          ) : null}
        </div>
      </section>
    </div>
  );
}
