"use client";

import type { ReactNode } from "react";
import { Activity, CalendarDays, FileText } from "lucide-react";

import type { MyopiaMeasurementPayload } from "@/lib/types";

type MyopiaMeasurementFormProps<T extends MyopiaMeasurementPayload> = {
  value: T;
  onChange: (next: T) => void;
};

const inputClassName = "h-12 w-full rounded-xl border border-[#dbe7ef] bg-white px-4 text-sm text-slate-950 outline-none transition placeholder:text-slate-950/45 focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const textareaClassName = "min-h-24 w-full resize-y rounded-xl border border-[#dbe7ef] bg-white px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-950/45 focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

function SectionHeading({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-800">{icon}</span>
      <h4 className="text-sm font-semibold text-slate-950">{children}</h4>
    </div>
  );
}

function EyeLabel({ eye, children }: { eye: "OD" | "OS"; children: ReactNode }) {
  return (
    <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-950">
      <span className={`h-2.5 w-2.5 rounded-full ${eye === "OD" ? "bg-teal-700" : "bg-violet-700"}`} />
      {children}
    </span>
  );
}

export function MyopiaMeasurementForm<T extends MyopiaMeasurementPayload>({
  value,
  onChange,
}: MyopiaMeasurementFormProps<T>) {
  function update<K extends keyof MyopiaMeasurementPayload>(key: K, nextValue: MyopiaMeasurementPayload[K]) {
    onChange({ ...value, [key]: nextValue });
  }

  return (
    <section className="overflow-hidden rounded-xl border border-[#dbe7ef] bg-white text-slate-950">
      <div className="p-4 sm:p-5">
        <SectionHeading icon={<CalendarDays className="h-5 w-5" />}>Visit details</SectionHeading>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_0.65fr_1fr]">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-950">Measured at</span>
            <input
              type="datetime-local"
              value={value.measured_at}
              onChange={(event) => update("measured_at", event.target.value)}
              className={inputClassName}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-950">Age (years)</span>
            <input
              type="number"
              step="0.1"
              value={value.age_years || ""}
              onChange={(event) => update("age_years", Number(event.target.value || 0))}
              className={inputClassName}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-950">Treatment type</span>
            <input
              value={value.treatment_type}
              onChange={(event) => update("treatment_type", event.target.value)}
              placeholder="Atropine, ortho-k, DIMS"
              className={inputClassName}
            />
          </label>
        </div>
      </div>

      <div className="border-t border-[#dbe7ef] p-4 sm:p-5">
        <SectionHeading icon={<Activity className="h-5 w-5" />}>Clinical measurements</SectionHeading>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <EyeLabel eye="OD">Axial length OD (mm)</EyeLabel>
            <input
              type="number"
              step="0.01"
              value={value.axial_length_right_mm || ""}
              onChange={(event) => update("axial_length_right_mm", Number(event.target.value || 0))}
              className={inputClassName}
            />
          </label>
          <label className="block">
            <EyeLabel eye="OS">Axial length OS (mm)</EyeLabel>
            <input
              type="number"
              step="0.01"
              value={value.axial_length_left_mm || ""}
              onChange={(event) => update("axial_length_left_mm", Number(event.target.value || 0))}
              className={inputClassName}
            />
          </label>
          <label className="block">
            <EyeLabel eye="OD">Refraction OD</EyeLabel>
            <input
              value={value.refraction_right}
              onChange={(event) => update("refraction_right", event.target.value)}
              placeholder="-2.25 / -0.50 x 180"
              className={inputClassName}
            />
          </label>
          <label className="block">
            <EyeLabel eye="OS">Refraction OS</EyeLabel>
            <input
              value={value.refraction_left}
              onChange={(event) => update("refraction_left", event.target.value)}
              placeholder="-2.00 / -0.75 x 170"
              className={inputClassName}
            />
          </label>
        </div>
      </div>

      <div className="border-t border-[#dbe7ef] p-4 sm:p-5">
        <SectionHeading icon={<FileText className="h-5 w-5" />}>Clinical notes</SectionHeading>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="block text-sm font-semibold text-slate-950">Treatment notes</span>
            <span className="mb-2 mt-0.5 block text-xs text-slate-950">Therapy, adherence, or changes</span>
            <textarea
              rows={3}
              value={value.treatment_notes}
              onChange={(event) => update("treatment_notes", event.target.value)}
              className={textareaClassName}
            />
          </label>
          <label className="block">
            <span className="block text-sm font-semibold text-slate-950">Visit notes</span>
            <span className="mb-2 mt-0.5 block text-xs text-slate-950">Findings from this visit</span>
            <textarea
              rows={3}
              value={value.visit_notes}
              onChange={(event) => update("visit_notes", event.target.value)}
              className={textareaClassName}
            />
          </label>
        </div>
      </div>
    </section>
  );
}
