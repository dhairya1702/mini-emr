"use client";

import { useEffect, useState } from "react";

import type { MyopiaMeasurementDraft } from "@/lib/optometry/consultation";

import { formatLocalDateTimeInput } from "@/lib/optometry/consultation";
import { OptometryModalShell } from "@/components/optometry/optometry-modal-shell";

type MyopiaManagementModalProps = {
  open: boolean;
  value: MyopiaMeasurementDraft;
  patientAge: number | null;
  onClose: () => void;
  onSave: (next: MyopiaMeasurementDraft) => Promise<void>;
  inline?: boolean;
};

export function MyopiaManagementModal({
  open,
  value,
  patientAge,
  onClose,
  onSave,
  inline = false,
}: MyopiaManagementModalProps) {
  const [draft, setDraft] = useState<MyopiaMeasurementDraft>(value);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft({
        ...value,
        age_years: value.age_years > 0 ? value.age_years : Number(patientAge || 0),
        measured_at: value.measured_at || formatLocalDateTimeInput(),
      });
      setStatus("");
      setIsSaving(false);
    }
  }, [open, patientAge, value]);

  function updateMyopiaMeasurementDraft<K extends keyof MyopiaMeasurementDraft>(key: K, nextValue: MyopiaMeasurementDraft[K]) {
    setDraft((current) => ({ ...current, [key]: nextValue }));
  }

  async function handleSave() {
    if (draft.age_years <= 0) {
      setStatus("Enter the patient age at measurement.");
      return;
    }
    if (draft.axial_length_right_mm <= 0 || draft.axial_length_left_mm <= 0) {
      setStatus("Enter axial length for both eyes.");
      return;
    }
    if (!draft.measured_at.trim()) {
      setStatus("Enter the measurement date and time.");
      return;
    }
    setIsSaving(true);
    setStatus("");
    try {
      await onSave(draft);
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save myopia measurement.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <OptometryModalShell
      open={open}
      title="Myopia Management"
      description="Record axial length, treatment, and refraction for longitudinal myopia progression tracking."
      saveLabel="Save Myopia Measurement"
      onClose={onClose}
      onSave={() => {
        void handleSave();
      }}
      isSaving={isSaving}
      inline={inline}
    >
      <section className="rounded-[18px] border border-[#bfd7e8] bg-[#f3f8fb]/30 p-4">
        <p className="text-sm font-medium text-slate-900">Measurement</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <label className="block lg:col-span-2">
            <span className="mb-2 block text-sm font-medium text-slate-700">Measured At</span>
            <input type="datetime-local" value={draft.measured_at} onChange={(event) => updateMyopiaMeasurementDraft("measured_at", event.target.value)} className="w-full rounded-xl border border-[#dbe7ef] bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Age (years)</span>
            <input type="number" step="0.1" value={draft.age_years || ""} onChange={(event) => updateMyopiaMeasurementDraft("age_years", Number(event.target.value || 0))} className="w-full rounded-xl border border-[#dbe7ef] bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Treatment Type</span>
            <input value={draft.treatment_type} onChange={(event) => updateMyopiaMeasurementDraft("treatment_type", event.target.value)} placeholder="Atropine, ortho-k, DIMS, observation" className="w-full rounded-xl border border-[#dbe7ef] bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
          </label>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Axial Length OD (mm)</span>
            <input type="number" step="0.01" value={draft.axial_length_right_mm || ""} onChange={(event) => updateMyopiaMeasurementDraft("axial_length_right_mm", Number(event.target.value || 0))} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Axial Length OS (mm)</span>
            <input type="number" step="0.01" value={draft.axial_length_left_mm || ""} onChange={(event) => updateMyopiaMeasurementDraft("axial_length_left_mm", Number(event.target.value || 0))} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
          </label>
        </div>
      </section>

      <section className="rounded-[18px] border border-[#bfd7e8] bg-white p-4">
        <p className="text-sm font-medium text-slate-900">Refraction</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Refraction Right</span>
            <input value={draft.refraction_right} onChange={(event) => updateMyopiaMeasurementDraft("refraction_right", event.target.value)} placeholder="-2.25 / -0.50 x 180" className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Refraction Left</span>
            <input value={draft.refraction_left} onChange={(event) => updateMyopiaMeasurementDraft("refraction_left", event.target.value)} placeholder="-2.00 / -0.75 x 170" className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
          </label>
        </div>
      </section>

      <section className="rounded-[18px] border border-[#bfd7e8] bg-white p-4">
        <p className="text-sm font-medium text-slate-900">Plan & Visit Notes</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Treatment Notes</span>
            <textarea rows={4} value={draft.treatment_notes} onChange={(event) => updateMyopiaMeasurementDraft("treatment_notes", event.target.value)} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Visit Notes</span>
            <textarea rows={4} value={draft.visit_notes} onChange={(event) => updateMyopiaMeasurementDraft("visit_notes", event.target.value)} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
          </label>
        </div>
      </section>

      {status ? <p className="text-sm text-rose-600">{status}</p> : null}
    </OptometryModalShell>
  );
}
