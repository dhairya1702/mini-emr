"use client";

import { Fragment } from "react";

import type { ContactLensEyeEntry, ContactLensPayload } from "@/lib/types";

import { OptometryModalShell } from "@/components/optometry/optometry-modal-shell";

type ContactLensModalProps = {
  open: boolean;
  value: ContactLensPayload;
  onClose: () => void;
  onSave: () => void;
  onChange: (patch: Partial<ContactLensPayload>) => void;
  onEyeChange: (eye: "right" | "left", patch: Partial<ContactLensEyeEntry>) => void;
  inline?: boolean;
};

export function ContactLensModal({
  open,
  value,
  onClose,
  onSave,
  onChange,
  onEyeChange,
  inline = false,
}: ContactLensModalProps) {
  return (
    <OptometryModalShell
      open={open}
      title="Contact Lens"
      description="Assessment, trial fit, and vendor-facing order details for optometry consultations."
      saveLabel="Save Contact Lens"
      onClose={onClose}
      onSave={onSave}
      inline={inline}
    >
      <div>
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Assessment</p>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Wearing Goal</span><input value={value.wearing_goal} onChange={(event) => onChange({ wearing_goal: event.target.value })} placeholder="Daily wear, events, sports, cosmetic use" className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" /></label>
          <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Current Lens Brand</span><input value={value.current_lens_brand} onChange={(event) => onChange({ current_lens_brand: event.target.value })} placeholder="If already a wearer" className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" /></label>
          <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Wear Schedule</span><input value={value.current_wear_schedule} onChange={(event) => onChange({ current_wear_schedule: event.target.value })} placeholder="8-10 hours/day, occasional wear" className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" /></label>
          <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Replacement Frequency</span><input value={value.replacement_frequency} onChange={(event) => onChange({ replacement_frequency: event.target.value })} placeholder="Daily, biweekly, monthly" className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" /></label>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Comfort Issues</span><textarea rows={3} value={value.comfort_issues} onChange={(event) => onChange({ comfort_issues: event.target.value })} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" /></label>
          <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Dryness Symptoms</span><textarea rows={3} value={value.dryness_symptoms} onChange={(event) => onChange({ dryness_symptoms: event.target.value })} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" /></label>
          <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Handling Issues</span><textarea rows={3} value={value.handling_issues} onChange={(event) => onChange({ handling_issues: event.target.value })} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" /></label>
          <div className="grid gap-4">
            <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Care Solution</span><input value={value.care_solution} onChange={(event) => onChange({ care_solution: event.target.value })} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" /></label>
            <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Allergy History</span><input value={value.allergy_history} onChange={(event) => onChange({ allergy_history: event.target.value })} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" /></label>
          </div>
        </div>
        <label className="mt-4 block"><span className="mb-2 block text-sm font-medium text-slate-700">Assessment Notes</span><textarea rows={3} value={value.assessment_notes} onChange={(event) => onChange({ assessment_notes: event.target.value })} placeholder="Suitability, slit lamp findings, patient preferences" className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" /></label>
      </div>
      <div>
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Order Details</p>
        <div className="grid gap-4 md:grid-cols-2">
          {[
            ["Lens Type", "lens_type", "Soft toric, multifocal, RGP"],
            ["Manufacturer", "manufacturer", "Acuvue, Bausch + Lomb"],
            ["Brand", "brand", "Oasys, Biofinity"],
            ["Wear Modality", "wear_modality", "Daily, monthly"],
            ["Trial Lens Used", "trial_lens_used", "Trial parameters used in chair"],
            ["Vendor Name", "vendor_name", "Manufacturer or distributor contact"],
            ["Quantity", "quantity", "Boxes, pairs, trial set"],
          ].map(([label, key, placeholder]) => (
            <label key={String(key)} className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
              <input value={value[key as keyof ContactLensPayload] as string} onChange={(event) => onChange({ [key]: event.target.value } as Partial<ContactLensPayload>)} placeholder={String(placeholder)} className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
            </label>
          ))}
        </div>
        <label className="mt-4 block"><span className="mb-2 block text-sm font-medium text-slate-700">Special Instructions</span><textarea rows={3} value={value.special_instructions} onChange={(event) => onChange({ special_instructions: event.target.value })} placeholder="Vendor notes, follow-up, handling instructions" className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" /></label>
      </div>
      <div>
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Right / Left Eye Parameters</p>
        <div className="grid gap-3 md:grid-cols-[110px_repeat(9,minmax(0,1fr))]">
          {["Eye", "Sphere", "Cylinder", "Axis", "BC", "Dia", "Add", "VA", "Over Ref", "Fit Notes"].map((label) => (
            <div key={label} className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">{label}</div>
          ))}
          {value.eyes.map((entry) => (
            <Fragment key={entry.eye}>
              <div className="rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-sm font-medium capitalize text-slate-700">{entry.eye}</div>
              <input value={entry.sphere} onChange={(event) => onEyeChange(entry.eye, { sphere: event.target.value })} className="rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" placeholder="-1.25" />
              <input value={entry.cylinder} onChange={(event) => onEyeChange(entry.eye, { cylinder: event.target.value })} className="rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" placeholder="-0.75" />
              <input value={entry.axis} onChange={(event) => onEyeChange(entry.eye, { axis: event.target.value })} className="rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" placeholder="90" />
              <input value={entry.base_curve} onChange={(event) => onEyeChange(entry.eye, { base_curve: event.target.value })} className="rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" placeholder="8.6" />
              <input value={entry.diameter} onChange={(event) => onEyeChange(entry.eye, { diameter: event.target.value })} className="rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" placeholder="14.2" />
              <input value={entry.add_power} onChange={(event) => onEyeChange(entry.eye, { add_power: event.target.value })} className="rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" placeholder="+1.50" />
              <input value={entry.visual_acuity} onChange={(event) => onEyeChange(entry.eye, { visual_acuity: event.target.value })} className="rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" placeholder="6/6" />
              <input value={entry.over_refraction} onChange={(event) => onEyeChange(entry.eye, { over_refraction: event.target.value })} className="rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" placeholder="-0.25 DS" />
              <input value={entry.fit_notes} onChange={(event) => onEyeChange(entry.eye, { fit_notes: event.target.value })} className="rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" placeholder="Good centration" />
            </Fragment>
          ))}
        </div>
      </div>
    </OptometryModalShell>
  );
}
