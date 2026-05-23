"use client";

import { useEffect, useState } from "react";

import type { LowVisionPayload } from "@/lib/types";

import { OptometryModalShell } from "@/components/optometry/optometry-modal-shell";

type LowVisionModalProps = {
  open: boolean;
  value: LowVisionPayload;
  onClose: () => void;
  onSave: (next: LowVisionPayload) => void;
  inline?: boolean;
};

export function LowVisionModal({
  open,
  value,
  onClose,
  onSave,
  inline = false,
}: LowVisionModalProps) {
  const [draft, setDraft] = useState<LowVisionPayload>(value);

  useEffect(() => {
    if (open) {
      setDraft(value);
    }
  }, [open, value]);

  function updateLowVisionDraft<K extends keyof LowVisionPayload>(key: K, nextValue: LowVisionPayload[K]) {
    setDraft((current) => ({ ...current, [key]: nextValue }));
  }

  return (
    <OptometryModalShell
      open={open}
      title="Low Vision"
      description="Capture needs, core measures, functional vision, aids trial, and support planning for low vision assessment."
      saveLabel="Save Low Vision"
      onClose={onClose}
      onSave={() => {
        onSave(draft);
        onClose();
      }}
      inline={inline}
    >
      <section className="rounded-[28px] border border-sky-200 bg-sky-50/30 p-4">
        <p className="text-sm font-medium text-slate-900">Patient Needs</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["reading_difficulty", "Reading Difficulty"],
            ["distance_difficulty", "Distance Difficulty"],
            ["mobility_difficulty", "Mobility Difficulty"],
            ["face_recognition_difficulty", "Face Recognition Difficulty"],
            ["glare_complaints", "Glare Complaints"],
            ["lighting_difficulty", "Lighting Difficulty"],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white px-4 py-3 text-sm text-slate-700">
              <input type="checkbox" checked={!!draft[key as keyof LowVisionPayload]} onChange={(event) => updateLowVisionDraft(key as keyof LowVisionPayload, event.target.checked as never)} className="h-4 w-4 rounded border-sky-300 text-sky-600 focus:ring-sky-500" />
              {label}
            </label>
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Primary Complaint</span>
            <input value={draft.primary_complaint} onChange={(event) => updateLowVisionDraft("primary_complaint", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Goals</span>
            <input value={draft.goals} onChange={(event) => updateLowVisionDraft("goals", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
          </label>
        </div>
      </section>

      <section className="rounded-[28px] border border-sky-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-900">Core Measures</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            ["distance_visual_acuity", "Distance VA"],
            ["near_visual_acuity", "Near VA"],
            ["habitual_correction", "Habitual Correction"],
            ["best_correction", "Best Correction"],
            ["contrast_sensitivity", "Contrast Sensitivity"],
            ["glare_function", "Glare Function"],
            ["central_vision", "Central Vision"],
            ["visual_field", "Visual Field"],
          ].map(([key, label]) => (
            <label key={key} className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
              <input value={draft[key as keyof LowVisionPayload] as string} onChange={(event) => updateLowVisionDraft(key as keyof LowVisionPayload, event.target.value as never)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-[28px] border border-sky-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-900">Functional Vision</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {[
            ["functional_reading", "Functional Reading"],
            ["sustained_near_task", "Sustained Near Task"],
            ["illumination_response", "Illumination Response"],
            ["posture_working_distance", "Posture / Working Distance"],
          ].map(([key, label]) => (
            <label key={key} className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
              <input value={draft[key as keyof LowVisionPayload] as string} onChange={(event) => updateLowVisionDraft(key as keyof LowVisionPayload, event.target.value as never)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
            </label>
          ))}
          <label className="md:col-span-2 block">
            <span className="mb-2 block text-sm font-medium text-slate-700">TV / Phone / Mobility Notes</span>
            <textarea rows={3} value={draft.tv_phone_mobility_notes} onChange={(event) => updateLowVisionDraft("tv_phone_mobility_notes", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
          </label>
        </div>
      </section>

      <section className="rounded-[28px] border border-sky-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-900">Aids Trial</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[
            ["magnifier_type", "Magnifier Type"],
            ["magnification", "Magnification"],
            ["near_add", "Near Add"],
            ["electronic_aid", "Electronic Aid"],
            ["tint_filter", "Tint / Filter"],
            ["device_recommended", "Device Recommended"],
          ].map(([key, label]) => (
            <label key={key} className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
              <input value={draft[key as keyof LowVisionPayload] as string} onChange={(event) => updateLowVisionDraft(key as keyof LowVisionPayload, event.target.value as never)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
            </label>
          ))}
        </div>
        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Task Performance With Device</span>
          <textarea rows={3} value={draft.task_performance_with_device} onChange={(event) => updateLowVisionDraft("task_performance_with_device", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
        </label>
      </section>

      <section className="rounded-[28px] border border-sky-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-900">Plan & Support</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[
            ["lighting_advice", "Lighting Advice"],
            ["non_optical_aids", "Non-optical Aids"],
            ["rehab_referral", "Rehab Referral"],
            ["support_referral", "Support Referral"],
            ["training_required", "Training Required"],
            ["follow_up_plan", "Follow-up Plan"],
            ["cause_of_low_vision", "Cause of Low Vision"],
            ["prognosis", "Prognosis"],
            ["charles_bonnet_screening", "Charles Bonnet Screening"],
          ].map(([key, label]) => (
            <label key={key} className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
              <input value={draft[key as keyof LowVisionPayload] as string} onChange={(event) => updateLowVisionDraft(key as keyof LowVisionPayload, event.target.value as never)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
            </label>
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Emotional Support Notes</span>
            <textarea rows={3} value={draft.emotional_support_notes} onChange={(event) => updateLowVisionDraft("emotional_support_notes", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Final Plan</span>
            <textarea rows={3} value={draft.final_plan} onChange={(event) => updateLowVisionDraft("final_plan", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
          </label>
        </div>
      </section>
    </OptometryModalShell>
  );
}
