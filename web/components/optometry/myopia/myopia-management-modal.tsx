"use client";

import { X } from "lucide-react";

import { MyopiaHistory } from "@/lib/types";
import { buildMyopiaChartModel } from "@/lib/optometry/myopia/chart";
import { formatMillimeterDelta, formatMillimeterValue } from "@/lib/optometry/myopia/shared";

import { MyopiaProgressionChart } from "@/components/optometry/myopia/myopia-progression-chart";

export function MyopiaManagementModal({
  open,
  readOnly,
  history,
  isLoading,
  error,
  onClose,
  onAddPastReading,
}: {
  open: boolean;
  readOnly: boolean;
  history: MyopiaHistory | null;
  isLoading: boolean;
  error: string;
  onClose: () => void;
  onAddPastReading: () => void;
}) {
  if (!open) {
    return null;
  }

  const myopiaRecords = history?.records ?? [];
  const measurementCount = myopiaRecords.length;
  const chartModel = buildMyopiaChartModel(history);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-[32px] border border-sky-200 bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.35)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Optometry Module</p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">Myopia Management</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Review axial-length progression, treatment changes, and backfilled records in one place.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {!readOnly ? (
              <button
                type="button"
                onClick={onAddPastReading}
                className="rounded-full border border-sky-200 bg-white px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-slate-700 transition hover:bg-sky-50"
              >
                Add Past Reading
              </button>
            ) : null}
            <button type="button" onClick={onClose} className="rounded-full border border-sky-200 p-2 text-slate-600 transition hover:bg-sky-50">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}

        {measurementCount ? (
          <div className="mt-6 space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-sky-100 bg-sky-50/35 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Baseline Delta</p>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  OD {formatMillimeterDelta(history?.baseline_delta?.right_mm)} · OS {formatMillimeterDelta(history?.baseline_delta?.left_mm)}
                </p>
              </div>
              <div className="rounded-2xl border border-sky-100 bg-sky-50/35 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Last Visit Delta</p>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  OD {formatMillimeterDelta(history?.last_delta?.right_mm)} · OS {formatMillimeterDelta(history?.last_delta?.left_mm)}
                </p>
              </div>
              <div className="rounded-2xl border border-sky-100 bg-sky-50/35 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Annualized Growth</p>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  OD {formatMillimeterDelta(history?.annualized_growth?.right_mm)} · OS {formatMillimeterDelta(history?.annualized_growth?.left_mm)}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-sky-100 bg-emerald-50/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Expected Untreated</p>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  OD {chartModel?.expectedUntreatedDelta ? formatMillimeterValue(chartModel.expectedUntreatedDelta.right) : "—"} · OS {chartModel?.expectedUntreatedDelta ? formatMillimeterValue(chartModel.expectedUntreatedDelta.left) : "—"}
                </p>
              </div>
              <div className="rounded-2xl border border-sky-100 bg-violet-50/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Expected Treated</p>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  OD {chartModel?.expectedTreatedDelta ? formatMillimeterValue(chartModel.expectedTreatedDelta.right) : "—"} · OS {chartModel?.expectedTreatedDelta ? formatMillimeterValue(chartModel.expectedTreatedDelta.left) : "—"}
                </p>
              </div>
              <div className="rounded-2xl border border-sky-100 bg-amber-50/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Observed Efficacy</p>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  OD {chartModel?.efficacyRight !== null && chartModel?.efficacyRight !== undefined ? `${Math.round(chartModel.efficacyRight)}%` : "—"} · OS {chartModel?.efficacyLeft !== null && chartModel?.efficacyLeft !== undefined ? `${Math.round(chartModel.efficacyLeft)}%` : "—"}
                </p>
              </div>
            </div>

            <div className="rounded-[24px] border border-amber-200 bg-amber-50/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-900">Projection</p>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Trend-Based</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-amber-100 bg-white/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Projected 6 Months</p>
                  <p className="mt-2 text-sm font-medium text-slate-900">
                    OD {formatMillimeterValue(chartModel?.projectedSixMonthRight)} · OS {formatMillimeterValue(chartModel?.projectedSixMonthLeft)}
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-white/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Projected 12 Months</p>
                  <p className="mt-2 text-sm font-medium text-slate-900">
                    OD {formatMillimeterValue(chartModel?.projectedTwelveMonthRight)} · OS {formatMillimeterValue(chartModel?.projectedTwelveMonthLeft)}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-600">
                Projection uses the recorded annualized growth trend from this patient&apos;s existing axial-length history. It is a planning aid, not a diagnosis.
              </p>
            </div>

            <MyopiaProgressionChart history={history} />

            <div className="space-y-3">
              {myopiaRecords.slice().reverse().map((record) => (
                <div key={record.id} className="rounded-2xl border border-sky-100 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">
                      {new Date(record.measured_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} · age {record.age_years.toFixed(1)}y
                    </p>
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-slate-700">
                      {record.treatment_type || "No treatment tagged"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-700">
                    OD {record.axial_length_right_mm.toFixed(2)} mm · OS {record.axial_length_left_mm.toFixed(2)} mm
                  </p>
                  {(record.refraction_right || record.refraction_left) ? (
                    <p className="mt-1 text-sm text-slate-600">
                      Refraction: OD {record.refraction_right || "—"} · OS {record.refraction_left || "—"}
                    </p>
                  ) : null}
                  {record.treatment_notes || record.visit_notes ? (
                    <p className="mt-1 text-sm text-slate-600">
                      {[record.treatment_notes, record.visit_notes].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : !isLoading ? (
          <div className="mt-6 rounded-2xl border border-dashed border-sky-200 bg-sky-50/20 px-4 py-8 text-center text-sm text-slate-500">
            No axial length history yet. Add the first measurement to begin the visualisation.
          </div>
        ) : (
          <div className="mt-6 text-sm text-slate-500">Loading myopia history...</div>
        )}
      </div>
    </div>
  );
}
