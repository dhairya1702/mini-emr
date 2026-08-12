"use client";

import { useState, type ReactNode } from "react";
import {
  Activity,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Pill,
  Plus,
  ShieldCheck,
  TrendingUp,
  X,
} from "lucide-react";

import { MyopiaHistory, MyopiaMeasurementRecord } from "@/lib/types";
import { buildMyopiaChartModel } from "@/lib/optometry/myopia/chart";
import { formatMillimeterDelta, formatMillimeterValue } from "@/lib/optometry/myopia/shared";

import { MyopiaProgressionChart } from "@/components/optometry/myopia/myopia-progression-chart";

const EMPTY_TREATMENTS = new Set(["", "none", "observation"]);

function formatRecordDate(value: string) {
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatStartedDate(value: string) {
  return new Date(value).toLocaleDateString([], { month: "short", year: "numeric" });
}

function normalizedTreatment(value: string) {
  return value.trim().toLowerCase();
}

function treatmentIsActive(value: string) {
  return !EMPTY_TREATMENTS.has(normalizedTreatment(value));
}

function timelineDelta(records: MyopiaMeasurementRecord[], index: number) {
  if (index === 0) {
    return "Baseline";
  }
  const current = records[index]!;
  const previous = records[index - 1]!;
  return `OD ${formatMillimeterDelta(current.axial_length_right_mm - previous.axial_length_right_mm)} / OS ${formatMillimeterDelta(current.axial_length_left_mm - previous.axial_length_left_mm)}`;
}

function MetricCell({
  icon,
  label,
  right,
  left,
  caption,
  iconClassName,
}: {
  icon: ReactNode;
  label: string;
  right: string;
  left: string;
  caption: string;
  iconClassName: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3 lg:px-5">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconClassName}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-950">{label}</p>
        <p className="mt-1 whitespace-nowrap text-sm font-semibold">
          <span className="text-teal-700">OD&nbsp; {right}</span>
          <span className="mx-2 text-slate-950">·</span>
          <span className="text-violet-700">OS&nbsp; {left}</span>
        </p>
        <p className="mt-1 truncate text-[11px] text-slate-950">{caption}</p>
      </div>
    </div>
  );
}

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
  const [timelinePage, setTimelinePage] = useState(0);

  if (!open) {
    return null;
  }

  const myopiaRecords = history?.records ?? [];
  const measurementCount = myopiaRecords.length;
  const chartModel = buildMyopiaChartModel(history);
  const latestTreatmentRecord = myopiaRecords.at(-1) ?? null;
  const latestTreatment = latestTreatmentRecord?.treatment_type.trim() || "No treatment tagged";
  const isActiveTreatment = treatmentIsActive(latestTreatment);
  const treatmentStartRecord = latestTreatmentRecord
    ? myopiaRecords.find(
      (record) => normalizedTreatment(record.treatment_type) === normalizedTreatment(latestTreatment),
    ) ?? latestTreatmentRecord
    : null;
  const timelinePageCount = Math.max(1, Math.ceil(measurementCount / 10));
  const safeTimelinePage = Math.min(timelinePage, timelinePageCount - 1);
  const visibleTimelineRecords = [...myopiaRecords]
    .reverse()
    .slice(safeTimelinePage * 10, safeTimelinePage * 10 + 10);

  return (
    <div className="fixed inset-0 z-40 bg-white">
      <div className="h-[100dvh] w-full overflow-y-auto bg-white p-4 text-slate-950 sm:p-5">
        <header className="flex items-center justify-between gap-4">
          <h3 className="text-2xl font-semibold tracking-[-0.025em] text-slate-950">Myopia Management</h3>
          <div className="flex items-center gap-2">
            {!readOnly ? (
              <button
                type="button"
                onClick={onAddPastReading}
                className="inline-flex items-center gap-2 rounded-xl border border-blue-500 bg-white px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
              >
                <Plus className="h-4 w-4" />
                Add reading
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close myopia management"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#dbe7ef] text-slate-950 transition hover:bg-[#f3f8fb]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {error ? <p className="mt-3 text-sm font-medium text-rose-700">{error}</p> : null}

        {measurementCount ? (
          <div className="mt-4 space-y-4">
            <section className="grid overflow-hidden rounded-xl border border-[#dbe7ef] bg-white sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-[#dbe7ef]">
              <MetricCell
                icon={<Activity className="h-5 w-5" />}
                label="Since baseline"
                right={formatMillimeterDelta(history?.baseline_delta?.right_mm)}
                left={formatMillimeterDelta(history?.baseline_delta?.left_mm)}
                caption="Total change from baseline"
                iconClassName="bg-blue-50 text-blue-800"
              />
              <MetricCell
                icon={<CalendarDays className="h-5 w-5" />}
                label="Since last visit"
                right={formatMillimeterDelta(history?.last_delta?.right_mm)}
                left={formatMillimeterDelta(history?.last_delta?.left_mm)}
                caption="Change since prior visit"
                iconClassName="bg-blue-50 text-blue-800"
              />
              <MetricCell
                icon={<TrendingUp className="h-5 w-5" />}
                label="Annualized growth"
                right={formatMillimeterDelta(history?.annualized_growth?.right_mm)}
                left={formatMillimeterDelta(history?.annualized_growth?.left_mm)}
                caption="Millimeters per year"
                iconClassName="bg-blue-50 text-blue-800"
              />
              <MetricCell
                icon={<ShieldCheck className="h-5 w-5" />}
                label="Treatment effect"
                right={chartModel?.efficacyRight !== null && chartModel?.efficacyRight !== undefined ? `${Math.round(chartModel.efficacyRight)}%` : "—"}
                left={chartModel?.efficacyLeft !== null && chartModel?.efficacyLeft !== undefined ? `${Math.round(chartModel.efficacyLeft)}%` : "—"}
                caption="Observed efficacy"
                iconClassName="bg-amber-50 text-amber-800"
              />
            </section>

            <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,2.15fr)_minmax(320px,1fr)]">
              <MyopiaProgressionChart history={history} />

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-xl border border-[#dbe7ef] bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold text-slate-950">Projection</h4>
                    <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">Trend-based</span>
                  </div>
                  <div className="mt-3 divide-y divide-[#dbe7ef] rounded-lg border border-[#dbe7ef] px-3">
                    <div className="py-3">
                      <p className="text-xs font-semibold text-slate-950">Projected 6 months</p>
                      <p className="mt-1 flex items-center gap-3 text-sm font-semibold">
                        <span className="text-teal-700">OD&nbsp; {formatMillimeterValue(chartModel?.projectedSixMonthRight)}</span>
                        <span className="text-violet-700">OS&nbsp; {formatMillimeterValue(chartModel?.projectedSixMonthLeft)}</span>
                      </p>
                    </div>
                    <div className="py-3">
                      <p className="text-xs font-semibold text-slate-950">Projected 12 months</p>
                      <p className="mt-1 flex items-center gap-3 text-sm font-semibold">
                        <span className="text-teal-700">OD&nbsp; {formatMillimeterValue(chartModel?.projectedTwelveMonthRight)}</span>
                        <span className="text-violet-700">OS&nbsp; {formatMillimeterValue(chartModel?.projectedTwelveMonthLeft)}</span>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-[#dbe7ef] bg-white p-4">
                  <h4 className="text-sm font-semibold text-slate-950">Current treatment</h4>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-teal-700">
                      <Pill className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-950">{latestTreatment}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-950">
                        <span className={`rounded-md px-2 py-0.5 ${isActiveTreatment ? "bg-emerald-100 text-emerald-900" : "bg-[#f3f8fb] text-slate-950"}`}>
                          {isActiveTreatment ? "Active" : "Monitoring"}
                        </span>
                        {treatmentStartRecord ? <span>Started {formatStartedDate(treatmentStartRecord.measured_at)}</span> : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => document.getElementById("myopia-treatment-timeline")?.scrollIntoView({ behavior: "smooth" })}
                      className="shrink-0 text-xs font-semibold text-blue-700 hover:underline"
                    >
                      View history
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section id="myopia-treatment-timeline" className="overflow-hidden rounded-xl border border-[#dbe7ef] bg-white">
              <div className="border-b border-[#dbe7ef] px-4 py-3">
                <h4 className="text-sm font-semibold text-slate-950">Readings &amp; treatment timeline</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                  <thead className="bg-[#f8fbff] text-xs text-slate-950">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Date</th>
                      <th className="px-4 py-2.5 font-semibold">OD (mm)</th>
                      <th className="px-4 py-2.5 font-semibold">OS (mm)</th>
                      <th className="px-4 py-2.5 font-semibold">Change from prior</th>
                      <th className="px-4 py-2.5 font-semibold">Treatment</th>
                      <th className="px-4 py-2.5 font-semibold">Notes</th>
                      <th className="w-12 px-3 py-2.5"><span className="sr-only">Details</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#dbe7ef]">
                    {visibleTimelineRecords.map((record) => {
                      const chronologicalIndex = myopiaRecords.findIndex((item) => item.id === record.id);
                      const notes = [record.treatment_notes, record.visit_notes].filter(Boolean).join(" · ") || "—";
                      return (
                        <tr key={record.id} className="text-slate-950 hover:bg-[#f8fbff]">
                          <td className="whitespace-nowrap px-4 py-3 font-semibold">{formatRecordDate(record.measured_at)}</td>
                          <td className="whitespace-nowrap px-4 py-3 font-semibold"><span className="mr-2 inline-block h-2 w-2 rounded-full bg-teal-700" />{record.axial_length_right_mm.toFixed(2)}</td>
                          <td className="whitespace-nowrap px-4 py-3 font-semibold"><span className="mr-2 inline-block h-2 w-2 rounded-full bg-violet-700" />{record.axial_length_left_mm.toFixed(2)}</td>
                          <td className="whitespace-nowrap px-4 py-3">{timelineDelta(myopiaRecords, chronologicalIndex)}</td>
                          <td className="px-4 py-3">
                            <span className={treatmentIsActive(record.treatment_type) ? "rounded-md bg-emerald-100 px-2 py-1 font-medium text-emerald-900" : "font-medium text-slate-950"}>
                              {record.treatment_type || "None"}
                            </span>
                          </td>
                          <td className="max-w-[320px] truncate px-4 py-3" title={notes}>{notes}</td>
                          <td className="relative px-3 py-3 text-right">
                            <details className="relative">
                              <summary className="inline-flex cursor-pointer list-none rounded-lg p-1.5 text-slate-950 hover:bg-[#eaf3f9] [&::-webkit-details-marker]:hidden">
                                <MoreVertical className="h-4 w-4" />
                                <span className="sr-only">View reading details</span>
                              </summary>
                              <div className="absolute bottom-8 right-0 z-20 w-80 rounded-xl border border-[#dbe7ef] bg-white p-3 text-left text-xs text-slate-950 shadow-lg">
                                <p><span className="font-semibold">Age:</span> {record.age_years.toFixed(1)} years</p>
                                <p className="mt-2"><span className="font-semibold">Refraction:</span> OD {record.refraction_right || "—"} · OS {record.refraction_left || "—"}</p>
                                <p className="mt-2"><span className="font-semibold">Treatment notes:</span> {record.treatment_notes || "—"}</p>
                                <p className="mt-2"><span className="font-semibold">Visit notes:</span> {record.visit_notes || "—"}</p>
                              </div>
                            </details>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-center gap-2 border-t border-[#dbe7ef] px-4 py-2 text-xs font-medium text-slate-950">
                <button
                  type="button"
                  aria-label="Previous readings page"
                  disabled={safeTimelinePage === 0}
                  onClick={() => setTimelinePage((current) => Math.max(0, current - 1))}
                  className="rounded-md p-1.5 hover:bg-[#f3f8fb] disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="rounded-md bg-blue-50 px-3 py-1.5 font-semibold text-blue-700">{safeTimelinePage + 1}</span>
                <button
                  type="button"
                  aria-label="Next readings page"
                  disabled={safeTimelinePage >= timelinePageCount - 1}
                  onClick={() => setTimelinePage((current) => Math.min(timelinePageCount - 1, current + 1))}
                  className="rounded-md p-1.5 hover:bg-[#f3f8fb] disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <span className="ml-2 rounded-lg border border-[#dbe7ef] px-3 py-1.5">10 / page</span>
              </div>
            </section>
          </div>
        ) : !isLoading ? (
          <div className="mt-5 rounded-xl border border-dashed border-[#bfd7e8] bg-[#f3f8fb]/20 px-4 py-8 text-center text-sm text-slate-950">
            No axial length history yet. Add the first measurement to begin the visualisation.
          </div>
        ) : (
          <div className="mt-5 text-sm text-slate-950">Loading myopia history...</div>
        )}
      </div>
    </div>
  );
}
