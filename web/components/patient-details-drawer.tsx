"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Clock3, UserRound, X } from "lucide-react";

import { api } from "@/lib/api";
import { MYOPIA_REFERENCE_BAND } from "@/lib/myopia-reference";
import { MyopiaHistory, MyopiaMeasurementPayload, Patient, PatientTimelineEvent } from "@/lib/types";

interface PatientDetailsDrawerProps {
  patient: Patient | null;
  isOptometryClinic?: boolean;
  onClose: () => void;
  onLoadTimeline: (patientId: string) => Promise<PatientTimelineEvent[]>;
  onLoadMyopiaHistory?: (patientId: string) => Promise<MyopiaHistory>;
  readOnly?: boolean;
  onSave: (payloadPatientId: string, payload: {
    name: string;
    phone: string;
    email: string;
    address: string;
    reason: string;
    age: number;
    weight: number;
    height: number | null;
    temperature: number;
  }) => Promise<void>;
}

function detailText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function detailNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function detailItems(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function formatMillimeterDelta(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)} mm`;
}

function formatMillimeterValue(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${value.toFixed(2)} mm`;
}

function estimateUntreatedAnnualElongation(ageYears: number) {
  if (ageYears < 9) return 0.22;
  if (ageYears < 10) return 0.20;
  if (ageYears < 11) return 0.18;
  if (ageYears < 12) return 0.16;
  if (ageYears < 13) return 0.14;
  if (ageYears < 14) return 0.12;
  if (ageYears < 15) return 0.10;
  return 0.08;
}

function estimateTreatmentEffectiveness(treatmentType: string) {
  const normalized = treatmentType.trim().toLowerCase();
  if (!normalized || normalized === "observation" || normalized === "none") {
    return 0;
  }
  if (normalized.includes("dims")) return 0.50;
  if (normalized.includes("ortho")) return 0.45;
  if (normalized.includes("misight")) return 0.45;
  if (normalized.includes("multifocal")) return 0.40;
  if (normalized.includes("atropine 0.05")) return 0.55;
  if (normalized.includes("atropine 0.025")) return 0.45;
  if (normalized.includes("atropine 0.01")) return 0.30;
  if (normalized.includes("atropine")) return 0.35;
  return 0.25;
}

function formatLocalDateTimeInput(value?: Date) {
  const date = value ?? new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

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

function HistoricalMyopiaModal({
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
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[32px] border border-sky-200 bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.35)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Myopia Backfill</p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">Add Historical Measurement</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Enter a past axial-length reading to backfill the patient&apos;s progression chart.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-sky-200 p-2 text-slate-600 transition hover:bg-sky-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 space-y-5">
          <section className="rounded-[28px] border border-sky-200 bg-sky-50/30 p-4">
            <p className="text-sm font-medium text-slate-900">Measurement</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <label className="block lg:col-span-2">
                <span className="mb-2 block text-sm font-medium text-slate-700">Measured At</span>
                <input type="datetime-local" value={form.measured_at} onChange={(event) => setForm((current) => ({ ...current, measured_at: event.target.value }))} className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Age (years)</span>
                <input type="number" step="0.1" value={form.age_years || ""} onChange={(event) => setForm((current) => ({ ...current, age_years: Number(event.target.value || 0) }))} className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Treatment Type</span>
                <input value={form.treatment_type} onChange={(event) => setForm((current) => ({ ...current, treatment_type: event.target.value }))} placeholder="Atropine, ortho-k, DIMS" className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Axial Length OD (mm)</span>
                <input type="number" step="0.01" value={form.axial_length_right_mm || ""} onChange={(event) => setForm((current) => ({ ...current, axial_length_right_mm: Number(event.target.value || 0) }))} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Axial Length OS (mm)</span>
                <input type="number" step="0.01" value={form.axial_length_left_mm || ""} onChange={(event) => setForm((current) => ({ ...current, axial_length_left_mm: Number(event.target.value || 0) }))} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
            </div>
          </section>

          <section className="rounded-[28px] border border-sky-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-900">Refraction & Notes</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Refraction Right</span>
                <input value={form.refraction_right} onChange={(event) => setForm((current) => ({ ...current, refraction_right: event.target.value }))} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Refraction Left</span>
                <input value={form.refraction_left} onChange={(event) => setForm((current) => ({ ...current, refraction_left: event.target.value }))} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Treatment Notes</span>
                <textarea rows={4} value={form.treatment_notes} onChange={(event) => setForm((current) => ({ ...current, treatment_notes: event.target.value }))} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Visit Notes</span>
                <textarea rows={4} value={form.visit_notes} onChange={(event) => setForm((current) => ({ ...current, visit_notes: event.target.value }))} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
            </div>
          </section>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-sky-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-sky-50">
            Cancel
          </button>
          <button type="button" disabled={isSaving} onClick={handleSave} className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
            {isSaving ? "Saving..." : "Save Historical Reading"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MyopiaManagementModal({
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
  const [hoveredPoint, setHoveredPoint] = useState<{
    x: number;
    y: number;
    title: string;
    value: string;
  } | null>(null);

  if (!open) {
    return null;
  }

  const myopiaRecords = history?.records ?? [];
  const measurementCount = myopiaRecords.length;
  const latestRecord = myopiaRecords[myopiaRecords.length - 1] ?? null;
  const projectedSixMonthRight = latestRecord && history?.annualized_growth
    ? latestRecord.axial_length_right_mm + history.annualized_growth.right_mm * 0.5
    : null;
  const projectedSixMonthLeft = latestRecord && history?.annualized_growth
    ? latestRecord.axial_length_left_mm + history.annualized_growth.left_mm * 0.5
    : null;
  const projectedTwelveMonthRight = latestRecord && history?.annualized_growth
    ? latestRecord.axial_length_right_mm + history.annualized_growth.right_mm
    : null;
  const projectedTwelveMonthLeft = latestRecord && history?.annualized_growth
    ? latestRecord.axial_length_left_mm + history.annualized_growth.left_mm
    : null;
  const chartWidth = 760;
  const chartHeight = 260;
  const chartPadding = { top: 20, right: 28, bottom: 40, left: 56 };
  const ages = myopiaRecords.map((record) => record.age_years);
  const mmValues = myopiaRecords.flatMap((record) => [record.axial_length_right_mm, record.axial_length_left_mm]);
  const referenceLower = MYOPIA_REFERENCE_BAND.map((entry) => entry.lower_mm);
  const referenceUpper = MYOPIA_REFERENCE_BAND.map((entry) => entry.upper_mm);
  const projectedAges = latestRecord && history?.annualized_growth
    ? [latestRecord.age_years + 0.5, latestRecord.age_years + 1.0]
    : [];
  const modeledAges = [
    ...myopiaRecords.map((record) => record.age_years),
    ...projectedAges,
  ];
  const baselineRecord = myopiaRecords[0] ?? null;
  const modeledUntreatedPoints = baselineRecord
    ? modeledAges.map((ageValue) => {
        let cumulativeGrowth = 0;
        let currentAge = baselineRecord.age_years;
        while (currentAge < ageValue - 0.001) {
          const nextAge = Math.min(ageValue, currentAge + 0.5);
          const segmentYears = nextAge - currentAge;
          cumulativeGrowth += estimateUntreatedAnnualElongation(currentAge + segmentYears / 2) * segmentYears;
          currentAge = nextAge;
        }
        return {
          age: ageValue,
          right: baselineRecord.axial_length_right_mm + cumulativeGrowth,
          left: baselineRecord.axial_length_left_mm + cumulativeGrowth,
        };
      })
    : [];
  const modeledTreatedPoints = baselineRecord
    ? modeledAges.map((ageValue) => {
        let cumulativeGrowth = 0;
        let currentAge = baselineRecord.age_years;
        while (currentAge < ageValue - 0.001) {
          const nextAge = Math.min(ageValue, currentAge + 0.5);
          const segmentYears = nextAge - currentAge;
          const referenceRecord = [...myopiaRecords].reverse().find((record) => record.age_years <= currentAge + 0.001) ?? baselineRecord;
          const untreatedAnnual = estimateUntreatedAnnualElongation(currentAge + segmentYears / 2);
          const treatedAnnual = untreatedAnnual * (1 - estimateTreatmentEffectiveness(referenceRecord.treatment_type));
          cumulativeGrowth += treatedAnnual * segmentYears;
          currentAge = nextAge;
        }
        return {
          age: ageValue,
          right: baselineRecord.axial_length_right_mm + cumulativeGrowth,
          left: baselineRecord.axial_length_left_mm + cumulativeGrowth,
        };
      })
    : [];
  const projectedValues = [
    projectedSixMonthRight,
    projectedSixMonthLeft,
    projectedTwelveMonthRight,
    projectedTwelveMonthLeft,
    ...modeledUntreatedPoints.flatMap((point) => [point.right, point.left]),
    ...modeledTreatedPoints.flatMap((point) => [point.right, point.left]),
  ].filter((value): value is number => value !== null);
  const minAge = ages.length ? Math.min(...ages, MYOPIA_REFERENCE_BAND[0]!.age) : MYOPIA_REFERENCE_BAND[0]!.age;
  const maxAge = ages.length
    ? Math.max(...ages, ...projectedAges, MYOPIA_REFERENCE_BAND[MYOPIA_REFERENCE_BAND.length - 1]!.age)
    : Math.max(...projectedAges, MYOPIA_REFERENCE_BAND[MYOPIA_REFERENCE_BAND.length - 1]!.age);
  const minMm = Math.floor((Math.min(...mmValues, ...referenceLower) - 0.2) * 10) / 10;
  const maxMm = Math.ceil((Math.max(...mmValues, ...referenceUpper, ...projectedValues) + 0.2) * 10) / 10;
  const plotWidth = chartWidth - chartPadding.left - chartPadding.right;
  const plotHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const xForAge = (age: number) => chartPadding.left + ((age - minAge) / Math.max(maxAge - minAge, 1)) * plotWidth;
  const yForMm = (mm: number) => chartPadding.top + (1 - (mm - minMm) / Math.max(maxMm - minMm, 0.001)) * plotHeight;
  const referenceBandPathTop = MYOPIA_REFERENCE_BAND.map((entry, index) => `${index === 0 ? "M" : "L"} ${xForAge(entry.age)} ${yForMm(entry.upper_mm)}`).join(" ");
  const referenceBandPathBottom = [...MYOPIA_REFERENCE_BAND].reverse().map((entry) => `L ${xForAge(entry.age)} ${yForMm(entry.lower_mm)}`).join(" ");
  const referenceBandPath = `${referenceBandPathTop} ${referenceBandPathBottom} Z`;
  const rightLinePath = myopiaRecords.map((record, index) => `${index === 0 ? "M" : "L"} ${xForAge(record.age_years)} ${yForMm(record.axial_length_right_mm)}`).join(" ");
  const leftLinePath = myopiaRecords.map((record, index) => `${index === 0 ? "M" : "L"} ${xForAge(record.age_years)} ${yForMm(record.axial_length_left_mm)}`).join(" ");
  const untreatedRightPath = modeledUntreatedPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${xForAge(point.age)} ${yForMm(point.right)}`).join(" ");
  const untreatedLeftPath = modeledUntreatedPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${xForAge(point.age)} ${yForMm(point.left)}`).join(" ");
  const treatedRightPath = modeledTreatedPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${xForAge(point.age)} ${yForMm(point.right)}`).join(" ");
  const treatedLeftPath = modeledTreatedPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${xForAge(point.age)} ${yForMm(point.left)}`).join(" ");
  const yTicks = Array.from({ length: 5 }, (_, index) => minMm + ((maxMm - minMm) / 4) * index);
  const projectedRightPath = latestRecord && projectedSixMonthRight !== null && projectedTwelveMonthRight !== null
    ? `M ${xForAge(latestRecord.age_years)} ${yForMm(latestRecord.axial_length_right_mm)} L ${xForAge(latestRecord.age_years + 0.5)} ${yForMm(projectedSixMonthRight)} L ${xForAge(latestRecord.age_years + 1)} ${yForMm(projectedTwelveMonthRight)}`
    : "";
  const projectedLeftPath = latestRecord && projectedSixMonthLeft !== null && projectedTwelveMonthLeft !== null
    ? `M ${xForAge(latestRecord.age_years)} ${yForMm(latestRecord.axial_length_left_mm)} L ${xForAge(latestRecord.age_years + 0.5)} ${yForMm(projectedSixMonthLeft)} L ${xForAge(latestRecord.age_years + 1)} ${yForMm(projectedTwelveMonthLeft)}`
    : "";
  const tooltipWidth = hoveredPoint ? Math.max(150, hoveredPoint.value.length * 7 + 30) : 0;
  const tooltipX = hoveredPoint ? Math.min(Math.max(hoveredPoint.x - tooltipWidth / 2, chartPadding.left), chartWidth - chartPadding.right - tooltipWidth) : 0;
  const tooltipY = hoveredPoint ? Math.max(chartPadding.top, hoveredPoint.y - 62) : 0;
  const expectedUntreatedDelta = baselineRecord && latestRecord
    ? modeledUntreatedPoints.find((point) => Math.abs(point.age - latestRecord.age_years) < 0.001)
    : null;
  const expectedTreatedDelta = baselineRecord && latestRecord
    ? modeledTreatedPoints.find((point) => Math.abs(point.age - latestRecord.age_years) < 0.001)
    : null;
  const efficacyRight = expectedUntreatedDelta && baselineRecord && latestRecord
    ? ((expectedUntreatedDelta.right - latestRecord.axial_length_right_mm) / Math.max(expectedUntreatedDelta.right - baselineRecord.axial_length_right_mm, 0.001)) * 100
    : null;
  const efficacyLeft = expectedUntreatedDelta && baselineRecord && latestRecord
    ? ((expectedUntreatedDelta.left - latestRecord.axial_length_left_mm) / Math.max(expectedUntreatedDelta.left - baselineRecord.axial_length_left_mm, 0.001)) * 100
    : null;

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
                  OD {expectedUntreatedDelta ? formatMillimeterValue(expectedUntreatedDelta.right) : "—"} · OS {expectedUntreatedDelta ? formatMillimeterValue(expectedUntreatedDelta.left) : "—"}
                </p>
              </div>
              <div className="rounded-2xl border border-sky-100 bg-violet-50/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Expected Treated</p>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  OD {expectedTreatedDelta ? formatMillimeterValue(expectedTreatedDelta.right) : "—"} · OS {expectedTreatedDelta ? formatMillimeterValue(expectedTreatedDelta.left) : "—"}
                </p>
              </div>
              <div className="rounded-2xl border border-sky-100 bg-amber-50/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Observed Efficacy</p>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  OD {efficacyRight !== null ? `${Math.round(efficacyRight)}%` : "—"} · OS {efficacyLeft !== null ? `${Math.round(efficacyLeft)}%` : "—"}
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
                    OD {formatMillimeterValue(projectedSixMonthRight)} · OS {formatMillimeterValue(projectedSixMonthLeft)}
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-white/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Projected 12 Months</p>
                  <p className="mt-2 text-sm font-medium text-slate-900">
                    OD {formatMillimeterValue(projectedTwelveMonthRight)} · OS {formatMillimeterValue(projectedTwelveMonthLeft)}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-600">
                Projection uses the recorded annualized growth trend from this patient&apos;s existing axial-length history. It is a planning aid, not a diagnosis.
              </p>
            </div>

            <div className="rounded-[24px] border border-sky-100 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-900">Axial length trend with reference band</p>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{history?.overlay_version ?? "clinic-reference-v1"}</p>
              </div>
                        <div className="overflow-x-auto">
                          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="min-w-[720px]">
                            <rect x="0" y="0" width={chartWidth} height={chartHeight} rx="20" fill="#f8fbff" />
                  {yTicks.map((tick) => (
                    <g key={tick}>
                      <line x1={chartPadding.left} y1={yForMm(tick)} x2={chartWidth - chartPadding.right} y2={yForMm(tick)} stroke="#dbeafe" strokeDasharray="4 6" />
                      <text x={chartPadding.left - 10} y={yForMm(tick) + 4} textAnchor="end" className="fill-slate-500 text-[11px]">
                        {tick.toFixed(1)}
                      </text>
                    </g>
                  ))}
                            <path d={referenceBandPath} fill="rgba(125, 211, 252, 0.18)" stroke="none" />
                            {untreatedRightPath ? (
                              <path d={untreatedRightPath} fill="none" stroke="#059669" strokeWidth="2" strokeDasharray="4 8" strokeLinecap="round" strokeLinejoin="round" opacity="0.45" />
                            ) : null}
                            {untreatedLeftPath ? (
                              <path d={untreatedLeftPath} fill="none" stroke="#059669" strokeWidth="2" strokeDasharray="4 8" strokeLinecap="round" strokeLinejoin="round" opacity="0.25" />
                            ) : null}
                            {treatedRightPath ? (
                              <path d={treatedRightPath} fill="none" stroke="#7c3aed" strokeWidth="2" strokeDasharray="10 6" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
                            ) : null}
                            {treatedLeftPath ? (
                              <path d={treatedLeftPath} fill="none" stroke="#7c3aed" strokeWidth="2" strokeDasharray="10 6" strokeLinecap="round" strokeLinejoin="round" opacity="0.35" />
                            ) : null}
                            <path d={rightLinePath} fill="none" stroke="#0f766e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                            <path d={leftLinePath} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                            {projectedRightPath ? (
                              <path d={projectedRightPath} fill="none" stroke="#0f766e" strokeWidth="2.5" strokeDasharray="8 8" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
                            ) : null}
                            {projectedLeftPath ? (
                              <path d={projectedLeftPath} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeDasharray="8 8" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
                            ) : null}
                            {myopiaRecords.map((record) => (
                              <g key={record.id}>
                                <circle
                                  cx={xForAge(record.age_years)}
                                  cy={yForMm(record.axial_length_right_mm)}
                                  r="5.5"
                                  fill="#0f766e"
                                  onMouseEnter={() => setHoveredPoint({
                                    x: xForAge(record.age_years),
                                    y: yForMm(record.axial_length_right_mm),
                                    title: `OD · age ${record.age_years.toFixed(1)}y`,
                                    value: `${record.axial_length_right_mm.toFixed(2)} mm`,
                                  })}
                                  onMouseLeave={() => setHoveredPoint(null)}
                                />
                                <circle
                                  cx={xForAge(record.age_years)}
                                  cy={yForMm(record.axial_length_left_mm)}
                                  r="5.5"
                                  fill="#2563eb"
                                  onMouseEnter={() => setHoveredPoint({
                                    x: xForAge(record.age_years),
                                    y: yForMm(record.axial_length_left_mm),
                                    title: `OS · age ${record.age_years.toFixed(1)}y`,
                                    value: `${record.axial_length_left_mm.toFixed(2)} mm`,
                                  })}
                                  onMouseLeave={() => setHoveredPoint(null)}
                                />
                                <text x={xForAge(record.age_years)} y={chartHeight - 12} textAnchor="middle" className="fill-slate-500 text-[11px]">
                                  {record.age_years.toFixed(1)}y
                                </text>
                              </g>
                            ))}
                            {modeledUntreatedPoints.map((point) => (
                              <circle
                                key={`untreated-${point.age}`}
                                cx={xForAge(point.age)}
                                cy={yForMm(point.right)}
                                r="4.5"
                                fill="#ffffff"
                                stroke="#059669"
                                strokeWidth="2"
                                opacity="0.85"
                                onMouseEnter={() => setHoveredPoint({
                                  x: xForAge(point.age),
                                  y: yForMm(point.right),
                                  title: `Expected untreated OD · age ${point.age.toFixed(1)}y`,
                                  value: `${point.right.toFixed(2)} mm`,
                                })}
                                onMouseLeave={() => setHoveredPoint(null)}
                              />
                            ))}
                            {modeledUntreatedPoints.map((point) => (
                              <circle
                                key={`untreated-os-${point.age}`}
                                cx={xForAge(point.age)}
                                cy={yForMm(point.left)}
                                r="4.5"
                                fill="#ffffff"
                                stroke="#10b981"
                                strokeWidth="2"
                                opacity="0.65"
                                onMouseEnter={() => setHoveredPoint({
                                  x: xForAge(point.age),
                                  y: yForMm(point.left),
                                  title: `Expected untreated OS · age ${point.age.toFixed(1)}y`,
                                  value: `${point.left.toFixed(2)} mm`,
                                })}
                                onMouseLeave={() => setHoveredPoint(null)}
                              />
                            ))}
                            {modeledTreatedPoints.map((point) => (
                              <circle
                                key={`treated-${point.age}`}
                                cx={xForAge(point.age)}
                                cy={yForMm(point.right)}
                                r="4.5"
                                fill="#ffffff"
                                stroke="#7c3aed"
                                strokeWidth="2"
                                opacity="0.85"
                                onMouseEnter={() => setHoveredPoint({
                                  x: xForAge(point.age),
                                  y: yForMm(point.right),
                                  title: `Expected treated OD · age ${point.age.toFixed(1)}y`,
                                  value: `${point.right.toFixed(2)} mm`,
                                })}
                                onMouseLeave={() => setHoveredPoint(null)}
                              />
                            ))}
                            {modeledTreatedPoints.map((point) => (
                              <circle
                                key={`treated-os-${point.age}`}
                                cx={xForAge(point.age)}
                                cy={yForMm(point.left)}
                                r="4.5"
                                fill="#ffffff"
                                stroke="#8b5cf6"
                                strokeWidth="2"
                                opacity="0.65"
                                onMouseEnter={() => setHoveredPoint({
                                  x: xForAge(point.age),
                                  y: yForMm(point.left),
                                  title: `Expected treated OS · age ${point.age.toFixed(1)}y`,
                                  value: `${point.left.toFixed(2)} mm`,
                                })}
                                onMouseLeave={() => setHoveredPoint(null)}
                              />
                            ))}
                            {latestRecord && projectedSixMonthRight !== null ? (
                              <circle
                                cx={xForAge(latestRecord.age_years + 0.5)}
                                cy={yForMm(projectedSixMonthRight)}
                                r="5.5"
                                fill="#ffffff"
                                stroke="#0f766e"
                                strokeWidth="2.5"
                                onMouseEnter={() => setHoveredPoint({
                                  x: xForAge(latestRecord.age_years + 0.5),
                                  y: yForMm(projectedSixMonthRight),
                                  title: "Projected OD · 6 months",
                                  value: `${projectedSixMonthRight.toFixed(2)} mm`,
                                })}
                                onMouseLeave={() => setHoveredPoint(null)}
                              />
                            ) : null}
                            {latestRecord && projectedSixMonthLeft !== null ? (
                              <circle
                                cx={xForAge(latestRecord.age_years + 0.5)}
                                cy={yForMm(projectedSixMonthLeft)}
                                r="5.5"
                                fill="#ffffff"
                                stroke="#2563eb"
                                strokeWidth="2.5"
                                onMouseEnter={() => setHoveredPoint({
                                  x: xForAge(latestRecord.age_years + 0.5),
                                  y: yForMm(projectedSixMonthLeft),
                                  title: "Projected OS · 6 months",
                                  value: `${projectedSixMonthLeft.toFixed(2)} mm`,
                                })}
                                onMouseLeave={() => setHoveredPoint(null)}
                              />
                            ) : null}
                            {latestRecord && projectedTwelveMonthRight !== null ? (
                              <circle
                                cx={xForAge(latestRecord.age_years + 1)}
                                cy={yForMm(projectedTwelveMonthRight)}
                                r="5.5"
                                fill="#ffffff"
                                stroke="#0f766e"
                                strokeWidth="2.5"
                                onMouseEnter={() => setHoveredPoint({
                                  x: xForAge(latestRecord.age_years + 1),
                                  y: yForMm(projectedTwelveMonthRight),
                                  title: "Projected OD · 12 months",
                                  value: `${projectedTwelveMonthRight.toFixed(2)} mm`,
                                })}
                                onMouseLeave={() => setHoveredPoint(null)}
                              />
                            ) : null}
                            {latestRecord && projectedTwelveMonthLeft !== null ? (
                              <circle
                                cx={xForAge(latestRecord.age_years + 1)}
                                cy={yForMm(projectedTwelveMonthLeft)}
                                r="5.5"
                                fill="#ffffff"
                                stroke="#2563eb"
                                strokeWidth="2.5"
                                onMouseEnter={() => setHoveredPoint({
                                  x: xForAge(latestRecord.age_years + 1),
                                  y: yForMm(projectedTwelveMonthLeft),
                                  title: "Projected OS · 12 months",
                                  value: `${projectedTwelveMonthLeft.toFixed(2)} mm`,
                                })}
                                onMouseLeave={() => setHoveredPoint(null)}
                              />
                            ) : null}
                            {hoveredPoint ? (
                              <g pointerEvents="none">
                                <rect
                                  x={tooltipX}
                                  y={tooltipY}
                                  width={tooltipWidth}
                                  height="48"
                                  rx="12"
                                  fill="#0f172a"
                                  opacity="0.95"
                                />
                                <text x={tooltipX + 12} y={tooltipY + 18} className="fill-white text-[11px] font-medium">
                                  {hoveredPoint.title}
                                </text>
                                <text x={tooltipX + 12} y={tooltipY + 36} className="fill-sky-100 text-[12px]">
                                  {hoveredPoint.value}
                                </text>
                              </g>
                            ) : null}
                          </svg>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
                          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-teal-700" /> OD</span>
                          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" /> OS</span>
                          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-sky-200" /> Reference band</span>
                          <span className="inline-flex items-center gap-2"><span className="h-0.5 w-4 border-t-2 border-dashed border-emerald-600" /> Expected untreated</span>
                          <span className="inline-flex items-center gap-2"><span className="h-0.5 w-4 border-t-2 border-dashed border-violet-600" /> Expected treated</span>
                          <span className="inline-flex items-center gap-2"><span className="h-0.5 w-4 border-t-2 border-dashed border-slate-500" /> Projection</span>
                        </div>
                      </div>

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

export function PatientDetailsDrawer({
  patient,
  isOptometryClinic = false,
  onClose,
  onLoadTimeline,
  onLoadMyopiaHistory,
  readOnly = false,
  onSave,
}: PatientDetailsDrawerProps) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    reason: "",
    age: "",
    weight: "",
    height: "",
    temperature: "",
  });
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [timeline, setTimeline] = useState<PatientTimelineEvent[]>([]);
  const [isTimelineLoading, setIsTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");
  const [myopiaHistory, setMyopiaHistory] = useState<MyopiaHistory | null>(null);
  const [isMyopiaLoading, setIsMyopiaLoading] = useState(false);
  const [myopiaError, setMyopiaError] = useState("");
  const [isHistoricalMyopiaOpen, setIsHistoricalMyopiaOpen] = useState(false);
  const [isMyopiaManagementOpen, setIsMyopiaManagementOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");

  useEffect(() => {
    if (!patient) {
      return;
    }

    setForm({
      name: patient.name,
      phone: patient.phone,
      email: patient.email ?? "",
      address: patient.address ?? "",
      reason: patient.reason,
      age: patient.age?.toString() ?? "",
      weight: patient.weight?.toString() ?? "",
      height: patient.height?.toString() ?? "",
      temperature: patient.temperature?.toString() ?? "",
    });
    setError("");
  }, [patient]);

  const loadPatientHistory = useCallback(async (patientId: string) => {
    const [events, nextMyopiaHistory] = await Promise.all([
      onLoadTimeline(patientId),
      isOptometryClinic && onLoadMyopiaHistory
        ? onLoadMyopiaHistory(patientId)
        : Promise.resolve({
            patient_id: patientId,
            records: [],
            baseline_delta: null,
            last_delta: null,
            annualized_growth: null,
            overlay_version: "clinic-reference-v1",
          } satisfies MyopiaHistory),
    ]);
    return { events, nextMyopiaHistory };
  }, [isOptometryClinic, onLoadMyopiaHistory, onLoadTimeline]);

  useEffect(() => {
    if (!patient) {
      setTimeline([]);
      setTimelineError("");
      setIsTimelineLoading(false);
      setMyopiaHistory(null);
      setMyopiaError("");
      setIsMyopiaLoading(false);
      setSelectedEventId("");
      return;
    }

    const currentPatient = patient;
    let active = true;

    async function loadChartData() {
      setIsTimelineLoading(true);
      setIsMyopiaLoading(true);
      setTimelineError("");
      setMyopiaError("");
      try {
        const { events, nextMyopiaHistory } = await loadPatientHistory(currentPatient.id);
        if (!active) {
          return;
        }
        setTimeline(events);
        setMyopiaHistory(nextMyopiaHistory);
        setSelectedEventId("");
      } catch (loadError) {
        if (!active) {
          return;
        }
        setTimeline([]);
        setMyopiaHistory(null);
        const message = loadError instanceof Error ? loadError.message : "Failed to load patient history.";
        setTimelineError(message);
        setMyopiaError(message);
        setSelectedEventId("");
      } finally {
        if (active) {
          setIsTimelineLoading(false);
          setIsMyopiaLoading(false);
        }
      }
    }

    void loadChartData();
    return () => {
      active = false;
    };
  }, [loadPatientHistory, patient]);

  const currentPatient = patient;

  function formatStatusLabel(value: string) {
    return value
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function formatDateTime(value: string) {
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function getEventTitle(event: PatientTimelineEvent) {
    if (event.type === "visit_recorded" && event.title.trim().toLowerCase() === "visit recorded") {
      return "Visit";
    }
    return event.title;
  }

  function getTimelineIcon(type: PatientTimelineEvent["type"]) {
    if (type === "follow_up_scheduled" || type === "follow_up_completed") {
      return <CalendarClock className="h-4 w-4 text-amber-600" />;
    }
    if (type === "appointment_booked" || type === "appointment_checked_in") {
      return <CalendarClock className="h-4 w-4 text-sky-600" />;
    }
    if (type === "myopia_measurement") {
      return <Clock3 className="h-4 w-4 text-emerald-600" />;
    }
    if (type === "visit_recorded") return <UserRound className="h-4 w-4 text-sky-600" />;
    return <Clock3 className="h-4 w-4 text-sky-600" />;
  }

  function getPhoneDigits(value: string) {
    return value.replace(/\D/g, "");
  }

  if (!currentPatient) {
    return null;
  }

  const lastVisitAt = formatDateTime(currentPatient.last_visit_at);
  const visitEvents = timeline.filter((event) => event.type === "visit_recorded");
  const currentVisitEvent = visitEvents[0] ?? null;
  const selectedEvent = timeline.find((event) => event.id === selectedEventId) ?? null;
  const timelineGroups = timeline.reduce<Array<{ label: string; events: PatientTimelineEvent[] }>>((groups, event) => {
    const date = new Date(event.timestamp);
    const label = date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.label === label) {
      lastGroup.events.push(event);
      return groups;
    }
    groups.push({ label, events: [event] });
    return groups;
  }, []);
  const myopiaRecords = myopiaHistory?.records ?? [];
  const measurementCount = myopiaRecords.length;
  const latestMyopiaRecord = myopiaRecords[myopiaRecords.length - 1] ?? null;

  async function handleSaveHistoricalMyopia(payload: MyopiaMeasurementPayload) {
    setIsMyopiaLoading(true);
    setMyopiaError("");
    try {
      const saved = await api.createPatientMyopiaRecord(currentPatient.id, payload);
      const { events, nextMyopiaHistory } = await loadPatientHistory(currentPatient.id);
      setTimeline(events);
      setMyopiaHistory(nextMyopiaHistory);
      setSelectedEventId(`myopia-${saved.id}`);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to save historical myopia data.";
      setMyopiaError(message);
      throw saveError;
    } finally {
      setIsMyopiaLoading(false);
    }
  }

  async function handleSave() {
    if (readOnly) {
      return;
    }
    if (!patient) {
      return;
    }

    const digits = getPhoneDigits(form.phone);
    const age = Number(form.age);
    const weight = Number(form.weight);
    const temperature = Number(form.temperature);
    const height = form.height.trim() ? Number(form.height) : null;
    const normalizedEmail = form.email.trim().toLowerCase();

    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }

    if (digits.length !== 10) {
      setError("Phone number must be exactly 10 digits.");
      return;
    }

    if (!form.reason.trim()) {
      setError("Reason for visit is required.");
      return;
    }

    if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    if (!Number.isFinite(age) || age <= 0) {
      setError("Enter a valid age.");
      return;
    }

    if (!Number.isFinite(weight) || weight <= 0) {
      setError("Enter a valid weight.");
      return;
    }

    if (!Number.isFinite(temperature) || temperature < 90 || temperature > 110) {
      setError("Enter a valid temperature in F.");
      return;
    }

    if (height !== null && (!Number.isFinite(height) || height <= 0)) {
      setError("Enter a valid height.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await onSave(patient.id, {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: normalizedEmail,
        address: form.address.trim(),
        reason: form.reason.trim(),
        age,
        weight,
        height,
        temperature,
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update patient.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 bg-slate-950/35 p-3 backdrop-blur-sm sm:p-5">
      <div className="mx-auto flex h-full max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-[34px] border border-sky-100 bg-white shadow-[0_35px_90px_rgba(15,23,42,0.18)]">
        <div className="flex items-start justify-between gap-4 border-b border-sky-100 px-5 py-5 sm:px-7">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Patient Chart</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-900">{currentPatient.name}</h2>
            <p className="mt-2 text-sm text-slate-500">
              {currentPatient.phone} · {formatStatusLabel(currentPatient.status)} · last visit {lastVisitAt}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setError("");
              onClose();
            }}
            className="rounded-full border border-sky-100 p-2 text-slate-500 transition hover:text-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="min-h-0 border-b border-sky-100 bg-sky-50/35 px-4 py-5 lg:border-b-0 lg:border-r lg:px-5">
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Timeline</p>
                  <h3 className="mt-2 text-xl font-semibold text-slate-900">Patient history</h3>
                </div>
                {isTimelineLoading ? <span className="text-xs text-slate-500">Loading...</span> : null}
              </div>

              {timelineError ? <p className="mt-3 text-sm text-rose-600">{timelineError}</p> : null}

              <div className="mt-5 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                {timelineGroups.length ? (
                  timelineGroups.map((group) => (
                    <div key={group.label}>
                      <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {group.label}
                      </p>
                      <div className="space-y-3">
                        {group.events.map((event) => (
                          <button
                            key={event.id}
                            type="button"
                            onClick={() => setSelectedEventId(event.id)}
                            className={`block w-full rounded-[22px] border px-3 py-3 text-left ${
                              event.id === selectedEventId
                                ? "border-sky-300 bg-white shadow-[0_14px_32px_rgba(125,211,252,0.18)]"
                                : "border-sky-100 bg-white/90"
                            }`}
                          >
                            <div className="flex items-start gap-2.5">
                              <div className="rounded-full bg-white p-1.5 shadow-sm ring-1 ring-sky-100">
                                {getTimelineIcon(event.type)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-[13px] font-semibold text-slate-900">{getEventTitle(event)}</p>
                                  <p className="text-[11px] text-slate-500">{formatDateTime(event.timestamp)}</p>
                                </div>
                                <p className="mt-1.5 text-[13px] leading-6 text-slate-600">{event.description}</p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                ) : !isTimelineLoading ? (
                  <div className="rounded-2xl border border-dashed border-sky-200 bg-white/80 px-4 py-6 text-center text-sm text-slate-500">
                    No patient history yet.
                  </div>
                ) : null}
              </div>
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto px-5 py-5 sm:px-7">
            <div className="mx-auto max-w-4xl space-y-5">
              <div className="rounded-[28px] border border-sky-100 bg-white p-5">
                <div className="flex items-center gap-3 text-slate-700">
                  <UserRound className="h-4 w-4 text-sky-600" />
                  <div>
                    <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Bio Data</p>
                    <h4 className="mt-1 text-lg font-semibold text-slate-900">Patient identity</h4>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  {readOnly ? (
                    <>
                      <div className="sm:col-span-2">
                        <p className="text-sm font-medium text-slate-700">Name</p>
                        <div className="mt-2 rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800">{form.name || "—"}</div>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">Phone</p>
                        <div className="mt-2 rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800">{form.phone || "—"}</div>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">Email</p>
                        <div className="mt-2 rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800">{form.email || "—"}</div>
                      </div>
                      <div className="sm:col-span-2">
                        <p className="text-sm font-medium text-slate-700">Address</p>
                        <div className="mt-2 rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800">{form.address || "—"}</div>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">Age</p>
                        <div className="mt-2 rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800">{form.age || "—"}</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <label className="block sm:col-span-2">
                        <span className="text-sm font-medium text-slate-700">Name</span>
                        <input
                          value={form.name}
                          onChange={(event) => {
                            setError("");
                            setForm((current) => ({ ...current, name: event.target.value }));
                          }}
                          className="mt-2 w-full rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
                        />
                      </label>

                      <label className="block">
                        <span className="text-sm font-medium text-slate-700">Phone</span>
                        <input
                          value={form.phone}
                          onChange={(event) => {
                            setError("");
                            setForm((current) => ({ ...current, phone: event.target.value }));
                          }}
                          className="mt-2 w-full rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
                        />
                      </label>

                      <label className="block">
                        <span className="text-sm font-medium text-slate-700">Email</span>
                        <input
                          type="email"
                          value={form.email}
                          onChange={(event) => {
                            setError("");
                            setForm((current) => ({ ...current, email: event.target.value }));
                          }}
                          className="mt-2 w-full rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
                        />
                      </label>

                      <label className="block sm:col-span-2">
                        <span className="text-sm font-medium text-slate-700">Address</span>
                        <input
                          value={form.address}
                          onChange={(event) => {
                            setError("");
                            setForm((current) => ({ ...current, address: event.target.value }));
                          }}
                          className="mt-2 w-full rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
                        />
                      </label>

                      <label className="block">
                        <span className="text-sm font-medium text-slate-700">Age</span>
                        <input
                          value={form.age}
                          inputMode="numeric"
                          onChange={(event) => {
                            setError("");
                            setForm((current) => ({ ...current, age: event.target.value }));
                          }}
                          className="mt-2 w-full rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
                        />
                      </label>
                    </>
                  )}
                </div>
              </div>

              {isOptometryClinic ? (
                <div className="rounded-[28px] border border-sky-100 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Myopia Management</p>
                      <h4 className="mt-1 text-lg font-semibold text-slate-900">Longitudinal progression</h4>
                    </div>
                    <div className="flex items-center gap-3">
                      {isMyopiaLoading ? <span className="text-xs text-slate-500">Loading...</span> : null}
                      <button
                        type="button"
                        onClick={() => setIsMyopiaManagementOpen(true)}
                        className="rounded-full border border-sky-200 bg-white px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-slate-700 transition hover:bg-sky-50"
                      >
                        Open Myopia Management
                      </button>
                    </div>
                  </div>

                  {myopiaError ? <p className="mt-3 text-sm text-rose-600">{myopiaError}</p> : null}

                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-sky-100 bg-sky-50/35 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Readings</p>
                      <p className="mt-2 text-sm font-medium text-slate-900">{measurementCount || 0} recorded</p>
                    </div>
                    <div className="rounded-2xl border border-sky-100 bg-sky-50/35 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Latest Reading</p>
                      <p className="mt-2 text-sm font-medium text-slate-900">
                        {latestMyopiaRecord
                          ? `OD ${latestMyopiaRecord.axial_length_right_mm.toFixed(2)} · OS ${latestMyopiaRecord.axial_length_left_mm.toFixed(2)}`
                          : "No data yet"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-sky-100 bg-sky-50/35 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Trend Since Baseline</p>
                      <p className="mt-2 text-sm font-medium text-slate-900">
                        OD {formatMillimeterDelta(myopiaHistory?.baseline_delta?.right_mm)} · OS {formatMillimeterDelta(myopiaHistory?.baseline_delta?.left_mm)}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="rounded-[28px] border border-sky-100 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Selected Event</p>
                    <h4 className="mt-1 text-lg font-semibold text-slate-900">
                      {selectedEvent ? selectedEvent.title : "Timeline inspection"}
                    </h4>
                  </div>
                  {selectedEvent ? (
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-slate-600">
                      {formatStatusLabel(selectedEvent.type)}
                    </span>
                  ) : null}
                </div>

                {selectedEvent ? (
                  <div className="mt-5 space-y-4">
                    <div className="rounded-2xl border border-sky-100 bg-sky-50/30 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-900">{selectedEvent.title}</p>
                        <p className="text-xs text-slate-500">{formatDateTime(selectedEvent.timestamp)}</p>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{selectedEvent.description}</p>
                    </div>

                    {(() => {
                      const details = (selectedEvent.details ?? {}) as Record<string, unknown>;

                      if (selectedEvent.type === "visit_recorded") {
                        return (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {[
                              ["Reason", detailText(details.reason) || "—"],
                              ["Source", detailText(details.source) || "—"],
                              ["Age", detailNumber(details.age) ?? "—"],
                              ["Weight", detailNumber(details.weight) ? `${detailNumber(details.weight)} kg` : "—"],
                              ["Height", detailNumber(details.height) ? `${detailNumber(details.height)} cm` : "—"],
                              ["Temperature", detailNumber(details.temperature) ? `${detailNumber(details.temperature)} F` : "—"],
                            ].map(([label, value]) => (
                              <div key={String(label)} className="rounded-2xl border border-sky-100 bg-white p-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                                <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
                              </div>
                            ))}
                          </div>
                        );
                      }

                      if (selectedEvent.type === "consultation_note") {
                        return (
                          <div className="space-y-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                              {[
                                ["Version", detailNumber(details.version_number) ?? "—"],
                                ["Status", detailText(details.status).replaceAll("_", " ") || "—"],
                                ["Recipient", detailText(details.sent_to) || "—"],
                                ["Signed by", detailText(details.sent_by_name) || "—"],
                              ].map(([label, value]) => (
                                <div key={String(label)} className="rounded-2xl border border-sky-100 bg-white p-4">
                                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                                  <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
                                </div>
                              ))}
                            </div>
                            <div className="rounded-2xl border border-sky-100 bg-white p-4">
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Consultation content</p>
                              <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                                {detailText(details.content) || detailText(details.excerpt) || "No note content available."}
                              </div>
                            </div>
                          </div>
                        );
                      }

                      if (selectedEvent.type === "invoice_created" || selectedEvent.type === "bill_sent") {
                        const items = detailItems(details.items) as Array<Record<string, unknown>>;
                        return (
                          <div className="space-y-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                              {[
                                ["Payment status", detailText(details.payment_status) || "—"],
                                ["Recipient", detailText(details.recipient) || "—"],
                                ["Total", detailNumber(details.total) !== null ? `₹${detailNumber(details.total)}` : "—"],
                                ["Paid", detailNumber(details.amount_paid) !== null ? `₹${detailNumber(details.amount_paid)}` : "—"],
                                ["Due", detailNumber(details.balance_due) !== null ? `₹${detailNumber(details.balance_due)}` : "—"],
                                ["Items", detailNumber(details.item_count) ?? items.length ?? "—"],
                              ].map(([label, value]) => (
                                <div key={String(label)} className="rounded-2xl border border-sky-100 bg-white p-4">
                                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                                  <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
                                </div>
                              ))}
                            </div>
                            {items.length ? (
                              <div className="rounded-2xl border border-sky-100 bg-white p-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Line items</p>
                                <div className="mt-3 space-y-2">
                                  {items.map((item, index) => (
                                    <div key={`${selectedEvent.id}-item-${index}`} className="flex items-center justify-between rounded-xl bg-sky-50/40 px-3 py-2 text-sm text-slate-700">
                                      <span>{detailText(item.label) || "Item"}</span>
                                      <span>
                                        {detailNumber(item.quantity) ?? 0} × ₹{detailNumber(item.unit_price) ?? 0}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      }

                      if (selectedEvent.type === "follow_up_scheduled" || selectedEvent.type === "follow_up_completed") {
                        return (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {[
                              ["Status", detailText(details.status).replaceAll("_", " ") || "—"],
                              ["Scheduled for", detailText(details.scheduled_for) ? formatDateTime(detailText(details.scheduled_for)) : "—"],
                              ["Completed at", detailText(details.completed_at) ? formatDateTime(detailText(details.completed_at)) : "—"],
                              ["Notes", detailText(details.notes) || "—"],
                            ].map(([label, value]) => (
                              <div key={String(label)} className="rounded-2xl border border-sky-100 bg-white p-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                                <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
                              </div>
                            ))}
                          </div>
                        );
                      }

                      if (selectedEvent.type === "appointment_booked" || selectedEvent.type === "appointment_checked_in") {
                        return (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {[
                              ["Status", detailText(details.status).replaceAll("_", " ") || "—"],
                              ["Scheduled for", detailText(details.scheduled_for) ? formatDateTime(detailText(details.scheduled_for)) : "—"],
                              ["Checked in", detailText(details.checked_in_at) ? formatDateTime(detailText(details.checked_in_at)) : "—"],
                              ["Reason", detailText(details.reason) || "—"],
                            ].map(([label, value]) => (
                              <div key={String(label)} className="rounded-2xl border border-sky-100 bg-white p-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                                <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
                              </div>
                            ))}
                          </div>
                        );
                      }

                      if (selectedEvent.type === "patient_created") {
                        return (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {[
                              ["Reason", detailText(details.reason) || "—"],
                              ["Phone", detailText(details.phone) || "—"],
                              ["Email", detailText(details.email) || "—"],
                              ["Address", detailText(details.address) || "—"],
                            ].map(([label, value]) => (
                              <div key={String(label)} className="rounded-2xl border border-sky-100 bg-white p-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                                <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
                              </div>
                            ))}
                          </div>
                        );
                      }

                      if (selectedEvent.type === "myopia_measurement") {
                        return (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {[
                              ["Age", `${detailNumber(details.age_years) ?? "—"} years`],
                              ["Axial Length OD", detailNumber(details.axial_length_right_mm) !== null ? `${detailNumber(details.axial_length_right_mm)} mm` : "—"],
                              ["Axial Length OS", detailNumber(details.axial_length_left_mm) !== null ? `${detailNumber(details.axial_length_left_mm)} mm` : "—"],
                              ["Treatment", detailText(details.treatment_type) || "—"],
                              ["Refraction Right", detailText(details.refraction_right) || "—"],
                              ["Refraction Left", detailText(details.refraction_left) || "—"],
                              ["Treatment Notes", detailText(details.treatment_notes) || "—"],
                              ["Visit Notes", detailText(details.visit_notes) || "—"],
                            ].map(([label, value]) => (
                              <div key={String(label)} className="rounded-2xl border border-sky-100 bg-white p-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                                <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
                              </div>
                            ))}
                          </div>
                        );
                      }

                      return null;
                    })()}
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl border border-dashed border-sky-200 bg-sky-50/20 px-4 py-8 text-center text-sm text-slate-500">
                    Select a timeline event from the left to inspect its details.
                  </div>
                )}
              </div>

              {readOnly ? (
                <div className="rounded-[28px] border border-sky-100 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Current Visit</p>
                      <h4 className="mt-1 text-lg font-semibold text-slate-900">Latest recorded visit</h4>
                    </div>
                    {currentVisitEvent ? <p className="text-xs text-slate-500">{formatDateTime(currentVisitEvent.timestamp)}</p> : null}
                  </div>

                  {currentVisitEvent ? (
                    <div className="mt-5 space-y-4">
                      <div className="rounded-2xl border border-sky-100 bg-sky-50/30 p-4">
                        <p className="text-sm leading-6 text-slate-700">{currentVisitEvent.description}</p>
                      </div>
                      {(() => {
                        const details = (currentVisitEvent.details ?? {}) as Record<string, unknown>;
                        const ageValue = detailNumber(details.age) ?? currentPatient.age;
                        const weightValue = detailNumber(details.weight) ?? currentPatient.weight;
                        const heightValue = detailNumber(details.height) ?? currentPatient.height;
                        const temperatureValue = detailNumber(details.temperature) ?? currentPatient.temperature;
                        return (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {[
                              ["Reason", detailText(details.reason) || currentPatient.reason || "—"],
                              ["Source", detailText(details.source) || "—"],
                              ["Age", ageValue ?? "—"],
                              ["Weight", weightValue ? `${weightValue} kg` : "—"],
                              ["Height", heightValue ? `${heightValue} cm` : "—"],
                              ["Temperature", temperatureValue ? `${temperatureValue} F` : "—"],
                            ].map(([label, value]) => (
                              <div key={String(label)} className="rounded-2xl border border-sky-100 bg-white p-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                                <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="mt-5 rounded-2xl border border-dashed border-sky-200 bg-sky-50/20 px-4 py-8 text-center text-sm text-slate-500">
                      No visits recorded yet.
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-[28px] border border-sky-100 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Visits</p>
                      <h4 className="mt-1 text-lg font-semibold text-slate-900">Patient visit history</h4>
                    </div>
                    {isTimelineLoading ? <span className="text-xs text-slate-500">Loading...</span> : null}
                  </div>

                  {timelineError ? <p className="mt-4 text-sm text-rose-600">{timelineError}</p> : null}

                  <div className="mt-5 space-y-3">
                    {visitEvents.length ? (
                      visitEvents.map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          onClick={() => setSelectedEventId(event.id)}
                          className={`block w-full rounded-[22px] border px-4 py-4 text-left ${
                            event.id === selectedEventId
                              ? "border-sky-300 bg-white shadow-[0_14px_32px_rgba(125,211,252,0.18)]"
                              : "border-sky-100 bg-sky-50/35"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="rounded-full bg-white p-2 shadow-sm ring-1 ring-sky-100">
                              {getTimelineIcon(event.type)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-slate-900">{getEventTitle(event)}</p>
                                <p className="text-xs text-slate-500">{formatDateTime(event.timestamp)}</p>
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-600">{event.description}</p>
                            </div>
                          </div>
                        </button>
                      ))
                    ) : !isTimelineLoading ? (
                      <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50/20 px-4 py-8 text-center text-sm text-slate-500">
                        No visits recorded yet.
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="border-t border-sky-100 px-5 py-4 sm:px-7">
          {error ? <p className="mb-3 text-sm font-medium text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setError("");
                onClose();
              }}
              className="rounded-full border border-sky-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:text-slate-900"
            >
              Close
            </button>
            {!readOnly ? (
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSave}
                className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {isOptometryClinic ? (
        <HistoricalMyopiaModal
          open={isHistoricalMyopiaOpen}
          patientAge={currentPatient.age}
          onClose={() => setIsHistoricalMyopiaOpen(false)}
          onSave={handleSaveHistoricalMyopia}
        />
      ) : null}
      {isOptometryClinic ? (
        <MyopiaManagementModal
          open={isMyopiaManagementOpen}
          readOnly={readOnly}
          history={myopiaHistory}
          isLoading={isMyopiaLoading}
          error={myopiaError}
          onClose={() => setIsMyopiaManagementOpen(false)}
          onAddPastReading={() => {
            setIsMyopiaManagementOpen(false);
            setIsHistoricalMyopiaOpen(true);
          }}
        />
      ) : null}
    </div>
  );
}
