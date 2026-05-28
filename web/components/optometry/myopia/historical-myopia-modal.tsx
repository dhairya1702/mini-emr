"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { MyopiaMeasurementPayload } from "@/lib/types";
import { formatLocalDateTimeInput } from "@/lib/optometry/myopia/shared";

function createEmptyHistoricalMyopia(patientAge: number | null) {
  return {
    measured_at: formatLocalDateTimeInput(),
    age_years: Number(patientAge || 0),
    axial_length_right_mm: 0,
    axial_length_left_mm: 0,
    treatment_type: "",
    treatment_notes: "",
    visit_notes: "",
    refraction_right: "",
    refraction_left: "",
  };
}

export function HistoricalMyopiaModal({
  open,
  patientAge,
  onClose,
  onSave,
}: {
  open: boolean;
  patientAge: number | null;
  onClose: () => void;
  onSave: (payload: MyopiaMeasurementPayload) => Promise<void>;
}) {
  const [form, setForm] = useState(() => createEmptyHistoricalMyopia(patientAge));
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(createEmptyHistoricalMyopia(patientAge));
      setError("");
      setIsSaving(false);
    }
  }, [open, patientAge]);

  if (!open) {
    return null;
  }

  async function handleSave() {
    if (!form.measured_at.trim()) {
      setError("Enter the measurement date and time.");
      return;
    }
    if (form.age_years <= 0) {
      setError("Enter the patient age at that visit.");
      return;
    }
    if (form.axial_length_right_mm <= 0 || form.axial_length_left_mm <= 0) {
      setError("Enter axial length for both eyes.");
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      await onSave({
        ...form,
        measured_at: new Date(form.measured_at).toISOString(),
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save historical myopia data.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[20px] border border-[#bfd7e8] bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.35)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Myopia Backfill</p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">Add Historical Measurement</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Enter a past axial-length reading to backfill the patient&apos;s progression chart.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-[#bfd7e8] p-2 text-slate-600 transition hover:bg-[#f3f8fb]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 space-y-5">
          <section className="rounded-[18px] border border-[#bfd7e8] bg-[#f3f8fb]/30 p-4">
            <p className="text-sm font-medium text-slate-900">Measurement</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <label className="block lg:col-span-2">
                <span className="mb-2 block text-sm font-medium text-slate-700">Measured At</span>
                <input type="datetime-local" value={form.measured_at} onChange={(event) => setForm((current) => ({ ...current, measured_at: event.target.value }))} className="w-full rounded-xl border border-[#dbe7ef] bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Age (years)</span>
                <input type="number" step="0.1" value={form.age_years || ""} onChange={(event) => setForm((current) => ({ ...current, age_years: Number(event.target.value || 0) }))} className="w-full rounded-xl border border-[#dbe7ef] bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Treatment Type</span>
                <input value={form.treatment_type} onChange={(event) => setForm((current) => ({ ...current, treatment_type: event.target.value }))} placeholder="Atropine, ortho-k, DIMS" className="w-full rounded-xl border border-[#dbe7ef] bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
              </label>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Axial Length OD (mm)</span>
                <input type="number" step="0.01" value={form.axial_length_right_mm || ""} onChange={(event) => setForm((current) => ({ ...current, axial_length_right_mm: Number(event.target.value || 0) }))} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Axial Length OS (mm)</span>
                <input type="number" step="0.01" value={form.axial_length_left_mm || ""} onChange={(event) => setForm((current) => ({ ...current, axial_length_left_mm: Number(event.target.value || 0) }))} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
              </label>
            </div>
          </section>

          <section className="rounded-[18px] border border-[#bfd7e8] bg-white p-4">
            <p className="text-sm font-medium text-slate-900">Refraction & Notes</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Refraction Right</span>
                <input value={form.refraction_right} onChange={(event) => setForm((current) => ({ ...current, refraction_right: event.target.value }))} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Refraction Left</span>
                <input value={form.refraction_left} onChange={(event) => setForm((current) => ({ ...current, refraction_left: event.target.value }))} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
              </label>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Treatment Notes</span>
                <textarea rows={4} value={form.treatment_notes} onChange={(event) => setForm((current) => ({ ...current, treatment_notes: event.target.value }))} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Visit Notes</span>
                <textarea rows={4} value={form.visit_notes} onChange={(event) => setForm((current) => ({ ...current, visit_notes: event.target.value }))} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
              </label>
            </div>
          </section>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-[#bfd7e8] bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb]">
            Cancel
          </button>
          <button type="button" disabled={isSaving} onClick={handleSave} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
            {isSaving ? "Saving..." : "Save Historical Reading"}
          </button>
        </div>
      </div>
    </div>
  );
}
