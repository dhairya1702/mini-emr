"use client";

import { useEffect, useState } from "react";

import type { BinocularVisionPayload } from "@/lib/types";

import { OptometryModalShell } from "@/components/optometry/optometry-modal-shell";

type BinocularVisionModalProps = {
  open: boolean;
  value: BinocularVisionPayload;
  onClose: () => void;
  onSave: (next: BinocularVisionPayload) => void;
  inline?: boolean;
};

export function BinocularVisionModal({
  open,
  value,
  onClose,
  onSave,
  inline = false,
}: BinocularVisionModalProps) {
  const [draft, setDraft] = useState<BinocularVisionPayload>(value);

  useEffect(() => {
    if (open) {
      setDraft(value);
    }
  }, [open, value]);

  function updateBinocularVisionDraft<K extends keyof BinocularVisionPayload>(key: K, nextValue: BinocularVisionPayload[K]) {
    setDraft((current) => ({ ...current, [key]: nextValue }));
  }

  return (
    <OptometryModalShell
      open={open}
      title="Binocular Vision"
      description="Capture symptoms, alignment, convergence, vergence, stereopsis, accommodation, and the management plan."
      saveLabel="Save Binocular Vision"
      onClose={onClose}
      onSave={() => {
        onSave(draft);
        onClose();
      }}
      inline={inline}
    >
      <section className="rounded-[18px] border border-[#bfd7e8] bg-[#f3f8fb]/30 p-4">
        <p className="text-sm font-medium text-slate-900">Symptoms</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["asthenopia", "Asthenopia"],
            ["headache", "Headache"],
            ["diplopia", "Diplopia"],
            ["blur_near", "Blur Near"],
            ["blur_distance", "Blur Distance"],
            ["reading_difficulty", "Reading Difficulty"],
            ["poor_concentration", "Poor Concentration"],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 rounded-xl border border-[#dbe7ef] bg-white px-4 py-3 text-sm text-slate-700">
              <input type="checkbox" checked={!!draft[key as keyof BinocularVisionPayload]} onChange={(event) => updateBinocularVisionDraft(key as keyof BinocularVisionPayload, event.target.checked as never)} className="h-4 w-4 rounded border-[#9fc7e1] text-[#2f8fd3] focus:ring-[#6daed8]" />
              {label}
            </label>
          ))}
        </div>
        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Symptom Notes</span>
          <textarea rows={3} value={draft.symptom_notes} onChange={(event) => updateBinocularVisionDraft("symptom_notes", event.target.value)} className="w-full rounded-xl border border-[#dbe7ef] bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
        </label>
      </section>

      <section className="rounded-[18px] border border-[#bfd7e8] bg-white p-4">
        <p className="text-sm font-medium text-slate-900">Alignment & Motility</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[
            ["distance_cover_test", "Distance Cover Test"],
            ["near_cover_test", "Near Cover Test"],
            ["distance_deviation_pd", "Distance Deviation (pd)"],
            ["near_deviation_pd", "Near Deviation (pd)"],
            ["binocular_visual_acuity_distance", "Binocular VA Distance"],
            ["binocular_visual_acuity_near", "Binocular VA Near"],
            ["motility", "Motility"],
            ["pursuits", "Pursuits"],
            ["saccades", "Saccades"],
          ].map(([key, label]) => (
            <label key={key} className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
              <input value={draft[key as keyof BinocularVisionPayload] as string} onChange={(event) => updateBinocularVisionDraft(key as keyof BinocularVisionPayload, event.target.value as never)} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-[18px] border border-[#bfd7e8] bg-white p-4">
        <p className="text-sm font-medium text-slate-900">Convergence & Vergence</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[
            ["npc_break_cm", "NPC Break (cm)"],
            ["npc_recovery_cm", "NPC Recovery (cm)"],
            ["bo_distance", "BO Distance"],
            ["bo_near", "BO Near"],
            ["bi_distance", "BI Distance"],
            ["bi_near", "BI Near"],
          ].map(([key, label]) => (
            <label key={key} className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
              <input value={draft[key as keyof BinocularVisionPayload] as string} onChange={(event) => updateBinocularVisionDraft(key as keyof BinocularVisionPayload, event.target.value as never)} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
            </label>
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Convergence Notes</span>
            <textarea rows={3} value={draft.convergence_notes} onChange={(event) => updateBinocularVisionDraft("convergence_notes", event.target.value)} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Vergence Notes</span>
            <textarea rows={3} value={draft.vergence_notes} onChange={(event) => updateBinocularVisionDraft("vergence_notes", event.target.value)} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
          </label>
        </div>
      </section>

      <section className="rounded-[18px] border border-[#bfd7e8] bg-white p-4">
        <p className="text-sm font-medium text-slate-900">Sensory & Accommodation</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            ["stereo_test_name", "Stereo Test"],
            ["stereo_result_arcsec", "Stereo Result (arc sec)"],
            ["worth_four_dot_distance", "Worth 4 Dot Distance"],
            ["worth_four_dot_near", "Worth 4 Dot Near"],
            ["amplitude_right", "Amplitude Right"],
            ["amplitude_left", "Amplitude Left"],
            ["facility_cpm", "Facility (cpm)"],
            ["facility_lens", "Facility Lens"],
          ].map(([key, label]) => (
            <label key={key} className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
              <input value={draft[key as keyof BinocularVisionPayload] as string} onChange={(event) => updateBinocularVisionDraft(key as keyof BinocularVisionPayload, event.target.value as never)} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
            </label>
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Sensory Notes</span>
            <textarea rows={3} value={draft.sensory_notes} onChange={(event) => updateBinocularVisionDraft("sensory_notes", event.target.value)} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Accommodation Notes</span>
            <textarea rows={3} value={draft.accommodation_notes} onChange={(event) => updateBinocularVisionDraft("accommodation_notes", event.target.value)} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
          </label>
        </div>
      </section>

      <section className="rounded-[18px] border border-[#bfd7e8] bg-white p-4">
        <p className="text-sm font-medium text-slate-900">Impression & Plan</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Working Diagnosis</span>
            <input value={draft.working_diagnosis} onChange={(event) => updateBinocularVisionDraft("working_diagnosis", event.target.value)} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Follow-up Interval</span>
            <input value={draft.follow_up_interval} onChange={(event) => updateBinocularVisionDraft("follow_up_interval", event.target.value)} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
          </label>
        </div>
        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Management Plan</span>
          <textarea rows={4} value={draft.management_plan} onChange={(event) => updateBinocularVisionDraft("management_plan", event.target.value)} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
        </label>
      </section>
    </OptometryModalShell>
  );
}
