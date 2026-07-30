"use client";

import type { EyeExamEntry, EyeExamPayload, EyeExamRow, EyeExamSection } from "@/lib/types";
import { EYE_EXAM_SECTIONS } from "@/lib/structured-modules";

const ROW_LABELS: Record<EyeExamRow, string> = {
  right: "Right",
  left: "Left",
  distance: "Distance",
  near: "Near",
};

export function EyeExamFields({
  value,
  onChange,
  compact = false,
}: {
  value: EyeExamPayload;
  onChange: (section: EyeExamSection, row: EyeExamRow, patch: Partial<EyeExamEntry>) => void;
  compact?: boolean;
}) {
  const labelClass = compact
    ? "text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500"
    : "text-xs font-medium uppercase tracking-[0.16em] text-slate-500";
  const rowClass = compact
    ? "rounded-lg border border-[#dbe7ef] bg-[#f3f8fb]/40 px-3 py-2 text-xs font-medium text-slate-700"
    : "rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-sm font-medium text-slate-700";
  const inputClass = compact
    ? "rounded-lg border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#6daed8]"
    : "rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]";

  return (
    <div className="grid gap-6">
      {EYE_EXAM_SECTIONS.map(({ key, label }) => (
        <section key={key}>
          <h4 className={compact ? "mb-3 text-base font-semibold text-slate-900" : "mb-4 text-xl font-semibold text-slate-900"}>
            {label}
          </h4>
          <div className="overflow-x-auto">
            <div className={`grid gap-2 md:gap-3 ${compact ? "min-w-[640px] grid-cols-[82px_repeat(4,minmax(0,1fr))]" : "min-w-[760px] grid-cols-[110px_repeat(4,minmax(0,1fr))]"}`}>
              <div className={labelClass}>Row</div>
              <div className={labelClass}>Sphere</div>
              <div className={labelClass}>Cylinder</div>
              <div className={labelClass}>Axis</div>
              <div className={labelClass}>Vision</div>
              {value[key].map((entry) => (
                <div key={entry.eye} className="contents">
                  <div className={rowClass}>{ROW_LABELS[entry.eye]}</div>
                  <input value={entry.sphere} onChange={(event) => onChange(key, entry.eye, { sphere: event.target.value })} placeholder="-1.25" className={inputClass} />
                  <input value={entry.cylinder} onChange={(event) => onChange(key, entry.eye, { cylinder: event.target.value })} placeholder="-0.50" className={inputClass} />
                  <input value={entry.axis} onChange={(event) => onChange(key, entry.eye, { axis: event.target.value })} placeholder="90" className={inputClass} />
                  <input value={entry.vision} onChange={(event) => onChange(key, entry.eye, { vision: event.target.value })} placeholder="6/6" className={inputClass} />
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
