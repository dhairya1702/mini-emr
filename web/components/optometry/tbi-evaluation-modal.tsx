"use client";

import { ReactNode, useMemo, useState } from "react";
import { X } from "lucide-react";

import type { Patient, TbiEvaluationPayload, TbiEvaluationRecord } from "@/lib/types";

type TbiFormValue = Record<string, unknown>;

const EMPTY_PAYLOAD: TbiFormValue = {
  visual_acuity: {
    unaided: { od: "", os: "", ou: "" },
    aided: { od: "", os: "", ou: "" },
    near: { od: "", os: "", ou: "" },
    flash: { od: "", os: "" },
    acceptance: { od: "", os: "" },
    nct_atn: { od: "", os: "" },
  },
  visual_functions: {
    color_vision: { od: "", os: "" },
    contrast: { od: "", os: "" },
    peripheral_visual_field: { od: "", os: "" },
    central_visual_field: { od: "", os: "" },
    cover_test: "",
  },
  entrance_tests: {
    line_bisection: { performance: "", comments: "" },
    crossing_out_items: { performance: "", comments: "" },
    copying: { performance: "", comments: "" },
  },
  visual_analysis: {
    tvps: "",
    tvps_final_score: "",
    comments: "",
  },
  bilateral_integration: {
    standing_angels: {
      section_a: { correct: "", incorrect: "" },
      section_b: { correct: "", incorrect: "" },
      section_c: { correct: "", incorrect: "" },
      section_d: { correct: "", incorrect: "" },
      comments: "",
    },
    chalkboard_circles: {
      performance: "",
      comments: "",
    },
  },
  laterality_directionality: {
    piaget_left_right: {
      section_a: { correct: "", incorrect: "" },
      section_b: { correct: "", incorrect: "" },
      section_c: { correct: "", incorrect: "" },
      section_d: { correct: "", incorrect: "" },
      section_e: { correct: "", incorrect: "" },
      comments: "",
    },
  },
  vestibular_screening: {
    tandem_gait: { normal: "", abnormal: "", comments: "" },
    rombergs_test: { normal: "", abnormal: "", comments: "" },
    padula_visual_midline_shift: { performance: "", type_of_shift: "", comments: "" },
    yoked_prism_walk: {
      base_right_response: "",
      base_up_response: "",
      base_left_response: "",
      base_down_response: "",
    },
    vestibulo_ocular_reflex: {
      right: { normal: "", abnormal: "" },
      left: { normal: "", abnormal: "" },
      upwards: { normal: "", abnormal: "" },
      downwards: { normal: "", abnormal: "" },
      comments: "",
    },
  },
  final_comments: "",
  management_and_therapy_options: "",
};

function clonePayload() {
  return JSON.parse(JSON.stringify(EMPTY_PAYLOAD)) as TbiFormValue;
}

function getAtPath(payload: TbiFormValue, path: string[]) {
  let current: unknown = payload;
  for (const part of path) {
    if (!current || typeof current !== "object") {
      return "";
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : "";
}

function setAtPath(payload: TbiFormValue, path: string[], value: string): TbiFormValue {
  const next = { ...payload };
  let current: Record<string, unknown> = next;
  path.slice(0, -1).forEach((part) => {
    const child = current[part];
    current[part] = child && typeof child === "object" && !Array.isArray(child) ? { ...(child as Record<string, unknown>) } : {};
    current = current[part] as Record<string, unknown>;
  });
  current[path[path.length - 1]] = value;
  return next;
}

function toDateTimeLocal(value: Date) {
  const offsetMs = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function FieldBox({
  label,
  path,
  value,
  onChange,
}: {
  label: string;
  path: string[];
  value: TbiFormValue;
  onChange: (path: string[], nextValue: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 items-center border border-black">
      <span className="shrink-0 px-3 py-1 font-semibold">{label}:</span>
      <input
        value={getAtPath(value, path)}
        onChange={(event) => onChange(path, event.target.value)}
        className="min-w-0 flex-1 bg-transparent px-2 py-1 outline-none"
      />
    </label>
  );
}

function TextLine({
  label,
  path,
  value,
  onChange,
}: {
  label: string;
  path: string[];
  value: TbiFormValue;
  onChange: (path: string[], nextValue: string) => void;
}) {
  return (
    <label className="block">
      <span className="font-semibold">{label}:</span>
      <textarea
        rows={2}
        value={getAtPath(value, path)}
        onChange={(event) => onChange(path, event.target.value)}
        className="mt-1 w-full resize-y border-b border-black bg-transparent px-1 py-1 outline-none"
      />
    </label>
  );
}

function ThreeEyeRow({
  basePath,
  value,
  onChange,
}: {
  basePath: string[];
  value: TbiFormValue;
  onChange: (path: string[], nextValue: string) => void;
}) {
  return (
    <div className="grid grid-cols-3">
      <FieldBox label="OD" path={[...basePath, "od"]} value={value} onChange={onChange} />
      <FieldBox label="OS" path={[...basePath, "os"]} value={value} onChange={onChange} />
      <FieldBox label="OU" path={[...basePath, "ou"]} value={value} onChange={onChange} />
    </div>
  );
}

function TwoEyeRow({
  basePath,
  value,
  onChange,
}: {
  basePath: string[];
  value: TbiFormValue;
  onChange: (path: string[], nextValue: string) => void;
}) {
  return (
    <div className="grid grid-cols-2">
      <FieldBox label="OD" path={[...basePath, "od"]} value={value} onChange={onChange} />
      <FieldBox label="OS" path={[...basePath, "os"]} value={value} onChange={onChange} />
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h4 className="mt-8 text-base font-bold underline">{children}</h4>;
}

function TestHeading({ children }: { children: ReactNode }) {
  return <p className="mt-6 font-bold underline">{children}</p>;
}

function FreeTextTest({
  title,
  basePath,
  value,
  onChange,
}: {
  title: string;
  basePath: string[];
  value: TbiFormValue;
  onChange: (path: string[], nextValue: string) => void;
}) {
  return (
    <div>
      <TestHeading>{title}</TestHeading>
      <TextLine label="Performance" path={[...basePath, "performance"]} value={value} onChange={onChange} />
      <TextLine label="Comments" path={[...basePath, "comments"]} value={value} onChange={onChange} />
    </div>
  );
}

function CorrectIncorrectTable({
  rows,
  basePath,
  value,
  onChange,
}: {
  rows: Array<{ key: string; label: string }>;
  basePath: string[];
  value: TbiFormValue;
  onChange: (path: string[], nextValue: string) => void;
}) {
  return (
    <table className="mt-2 w-full border-collapse text-sm">
      <thead>
        <tr>
          <th className="w-1/3 border border-black px-2 py-1 text-left">Performance:</th>
          <th className="w-1/3 border border-black px-2 py-1 text-left">Correct</th>
          <th className="w-1/3 border border-black px-2 py-1 text-left">Incorrect</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td className="border border-black px-2 py-1">{row.label}</td>
            <td className="border border-black p-0">
              <input value={getAtPath(value, [...basePath, row.key, "correct"])} onChange={(event) => onChange([...basePath, row.key, "correct"], event.target.value)} className="w-full bg-transparent px-2 py-1 outline-none" />
            </td>
            <td className="border border-black p-0">
              <input value={getAtPath(value, [...basePath, row.key, "incorrect"])} onChange={(event) => onChange([...basePath, row.key, "incorrect"], event.target.value)} className="w-full bg-transparent px-2 py-1 outline-none" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NormalAbnormalRow({
  basePath,
  value,
  onChange,
}: {
  basePath: string[];
  value: TbiFormValue;
  onChange: (path: string[], nextValue: string) => void;
}) {
  return (
    <table className="mt-2 w-full border-collapse text-sm">
      <tbody>
        <tr>
          <td className="w-1/3 border border-black px-2 py-1">Performance</td>
          <td className="w-1/3 border border-black p-0">
            <div className="flex items-center">
              <span className="px-2">Normal</span>
              <input value={getAtPath(value, [...basePath, "normal"])} onChange={(event) => onChange([...basePath, "normal"], event.target.value)} className="min-w-0 flex-1 bg-transparent px-2 py-1 outline-none" />
            </div>
          </td>
          <td className="w-1/3 border border-black p-0">
            <div className="flex items-center">
              <span className="px-2">Abnormal</span>
              <input value={getAtPath(value, [...basePath, "abnormal"])} onChange={(event) => onChange([...basePath, "abnormal"], event.target.value)} className="min-w-0 flex-1 bg-transparent px-2 py-1 outline-none" />
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function AxisDiagram() {
  return (
    <svg viewBox="0 0 160 120" className="mx-auto h-28 w-40 text-black">
      <line x1="80" y1="10" x2="80" y2="110" stroke="currentColor" strokeWidth="2" />
      <line x1="25" y1="60" x2="135" y2="60" stroke="currentColor" strokeWidth="2" />
      <line x1="35" y1="25" x2="125" y2="95" stroke="currentColor" strokeWidth="2" />
      <line x1="125" y1="25" x2="35" y2="95" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function TbiEvaluationModal({
  open,
  patient,
  evaluations,
  isLoading,
  error,
  readOnly,
  onClose,
  onSave,
}: {
  open: boolean;
  patient: Patient | null;
  evaluations: TbiEvaluationRecord[];
  isLoading: boolean;
  error: string;
  readOnly: boolean;
  onClose: () => void;
  onSave: (payload: { measured_at: string; payload: TbiEvaluationPayload }) => Promise<void>;
}) {
  const [measuredAt, setMeasuredAt] = useState(() => toDateTimeLocal(new Date()));
  const [formValue, setFormValue] = useState<TbiFormValue>(() => clonePayload());
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const latestEvaluations = useMemo(() => evaluations.slice().reverse(), [evaluations]);

  if (!open) {
    return null;
  }

  function handleChange(path: string[], nextValue: string) {
    setFormValue((current) => setAtPath(current, path, nextValue));
  }

  async function handleSave() {
    setIsSaving(true);
    setSaveError("");
    try {
      await onSave({
        measured_at: fromDateTimeLocal(measuredAt),
        payload: formValue,
      });
      setFormValue(clonePayload());
      setMeasuredAt(toDateTimeLocal(new Date()));
    } catch (saveFailure) {
      setSaveError(saveFailure instanceof Error ? saveFailure.message : "Failed to save TBI evaluation.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-950/50 p-0 sm:items-center sm:px-2 sm:py-4">
      <div className="flex h-[100dvh] w-full max-w-7xl flex-col overflow-hidden border-0 border-slate-300 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.35)] sm:max-h-[95vh] sm:rounded-[18px] sm:border">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-3 py-2.5 sm:gap-4 sm:px-5 sm:py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 sm:text-xs sm:tracking-[0.18em]">Optometry Module</p>
            <h3 className="truncate text-lg font-semibold text-slate-900 sm:text-xl">Neurovision / TBI Evaluation</h3>
            {patient ? <p className="truncate text-xs text-slate-500 sm:text-sm">{patient.name} · {patient.phone}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-xl border border-slate-300 p-2 text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="max-h-[142px] overflow-y-auto border-b border-slate-200 bg-slate-50 p-3 sm:max-h-[180px] sm:p-4 lg:max-h-none lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-900">Previous Evaluations</h4>
              {isLoading ? <span className="text-xs text-slate-500">Loading...</span> : null}
            </div>
            {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
            <div className="mt-3 space-y-2">
              {latestEvaluations.length ? latestEvaluations.map((evaluation) => (
                <div key={evaluation.id} className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-sm font-medium text-slate-900">
                    {new Date(evaluation.measured_at).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                    {String(evaluation.summary_fields?.summary || "Neurovision / TBI evaluation saved.")}
                  </p>
                </div>
              )) : !isLoading ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-5 text-center text-sm text-slate-500">
                  No evaluations yet.
                </p>
              ) : null}
            </div>
          </aside>

          <div className="min-h-0 overflow-auto overscroll-contain bg-[#d9d9d9] p-0 [-webkit-overflow-scrolling:touch] sm:p-6">
            <div className="min-h-full w-[412px] max-w-none p-2 sm:w-auto sm:p-0">
              <div className="w-[980px] max-w-none origin-top-left scale-[0.39] bg-white px-10 py-8 font-[Arial] text-[15px] leading-normal text-black shadow-sm sm:mx-auto sm:scale-100 sm:px-14">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
                <label className="text-sm font-semibold text-slate-700">
                  Evaluation date
                  <input
                    type="datetime-local"
                    value={measuredAt}
                    onChange={(event) => setMeasuredAt(event.target.value)}
                    className="ml-3 rounded border border-slate-300 px-2 py-1 text-sm font-normal text-slate-900"
                  />
                </label>
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={isSaving}
                    className="rounded bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {isSaving ? "Saving..." : "Save Evaluation"}
                  </button>
                ) : null}
              </div>
              {saveError ? <p className="mb-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{saveError}</p> : null}

              <p className="font-bold underline">Traumatic brain injury checklist</p>

              <SectionHeading>Visual acuity:</SectionHeading>
              <p>Unaided visual acuity:</p>
              <ThreeEyeRow basePath={["visual_acuity", "unaided"]} value={formValue} onChange={handleChange} />
              <p className="mt-6">Aided visual acuity:</p>
              <ThreeEyeRow basePath={["visual_acuity", "aided"]} value={formValue} onChange={handleChange} />
              <p className="mt-6">Near visual acuity:</p>
              <ThreeEyeRow basePath={["visual_acuity", "near"]} value={formValue} onChange={handleChange} />
              <p className="mt-6">Flash:</p>
              <div className="grid gap-0">
                <FieldBox label="OD" path={["visual_acuity", "flash", "od"]} value={formValue} onChange={handleChange} />
                <FieldBox label="OS" path={["visual_acuity", "flash", "os"]} value={formValue} onChange={handleChange} />
              </div>
              <p className="mt-6">Acceptance:</p>
              <div className="grid gap-0">
                <FieldBox label="OD" path={["visual_acuity", "acceptance", "od"]} value={formValue} onChange={handleChange} />
                <FieldBox label="OS" path={["visual_acuity", "acceptance", "os"]} value={formValue} onChange={handleChange} />
              </div>
              <p className="mt-6">NCT/ ATN:</p>
              <div className="grid gap-0">
                <FieldBox label="OD" path={["visual_acuity", "nct_atn", "od"]} value={formValue} onChange={handleChange} />
                <FieldBox label="OS" path={["visual_acuity", "nct_atn", "os"]} value={formValue} onChange={handleChange} />
              </div>

              <SectionHeading>Tests for visual functions:</SectionHeading>
              <p>Color vision test: (Pseudo isochromatic plates)</p>
              <TwoEyeRow basePath={["visual_functions", "color_vision"]} value={formValue} onChange={handleChange} />
              <p className="mt-6">Contrast: (Pelli Robson)</p>
              <TwoEyeRow basePath={["visual_functions", "contrast"]} value={formValue} onChange={handleChange} />
              <p className="mt-6">Visual field: Peripheral (Arc perimeter)</p>
              <TwoEyeRow basePath={["visual_functions", "peripheral_visual_field"]} value={formValue} onChange={handleChange} />
              <div className="my-8 grid grid-cols-2 gap-10">
                <AxisDiagram />
                <AxisDiagram />
              </div>
              <p className="mt-6">Visual field: Central (Amsler)</p>
              <TwoEyeRow basePath={["visual_functions", "central_visual_field"]} value={formValue} onChange={handleChange} />
              <TextLine label="Cover test" path={["visual_functions", "cover_test"]} value={formValue} onChange={handleChange} />

              <SectionHeading>Entrance tests:</SectionHeading>
              <FreeTextTest title="Line bisection test" basePath={["entrance_tests", "line_bisection"]} value={formValue} onChange={handleChange} />
              <FreeTextTest title="Unilateral spatial inattention - Crossing out items" basePath={["entrance_tests", "crossing_out_items"]} value={formValue} onChange={handleChange} />
              <FreeTextTest title="Unilateral spatial inattention - Copying" basePath={["entrance_tests", "copying"]} value={formValue} onChange={handleChange} />

              <SectionHeading>Non-motor perception - Visual analysis skills</SectionHeading>
              <TextLine label="TVPS" path={["visual_analysis", "tvps"]} value={formValue} onChange={handleChange} />
              <TextLine label="TVPS final score" path={["visual_analysis", "tvps_final_score"]} value={formValue} onChange={handleChange} />
              <TextLine label="Comments" path={["visual_analysis", "comments"]} value={formValue} onChange={handleChange} />

              <SectionHeading>Bilateral integration:</SectionHeading>
              <TestHeading>Standing angels in the snow:</TestHeading>
              <CorrectIncorrectTable
                rows={[
                  { key: "section_a", label: "Section A" },
                  { key: "section_b", label: "Section B" },
                  { key: "section_c", label: "Section C" },
                  { key: "section_d", label: "Section D" },
                ]}
                basePath={["bilateral_integration", "standing_angels"]}
                value={formValue}
                onChange={handleChange}
              />
              <TextLine label="Comments" path={["bilateral_integration", "standing_angels", "comments"]} value={formValue} onChange={handleChange} />
              <FreeTextTest title="Chalkboard circles:" basePath={["bilateral_integration", "chalkboard_circles"]} value={formValue} onChange={handleChange} />

              <SectionHeading>Laterality and directionality:</SectionHeading>
              <TestHeading>Piaget test of left-right concept:</TestHeading>
              <CorrectIncorrectTable
                rows={[
                  { key: "section_a", label: "Section A" },
                  { key: "section_b", label: "Section B" },
                  { key: "section_c", label: "Section C" },
                  { key: "section_d", label: "Section D" },
                  { key: "section_e", label: "Section E" },
                ]}
                basePath={["laterality_directionality", "piaget_left_right"]}
                value={formValue}
                onChange={handleChange}
              />
              <TextLine label="Comments" path={["laterality_directionality", "piaget_left_right", "comments"]} value={formValue} onChange={handleChange} />

              <SectionHeading>Vestibular screening test:</SectionHeading>
              <TestHeading>Tandem gait/ walking:</TestHeading>
              <NormalAbnormalRow basePath={["vestibular_screening", "tandem_gait"]} value={formValue} onChange={handleChange} />
              <TextLine label="Comments" path={["vestibular_screening", "tandem_gait", "comments"]} value={formValue} onChange={handleChange} />
              <TestHeading>Romberg&apos;s test:</TestHeading>
              <NormalAbnormalRow basePath={["vestibular_screening", "rombergs_test"]} value={formValue} onChange={handleChange} />
              <TextLine label="Comments" path={["vestibular_screening", "rombergs_test", "comments"]} value={formValue} onChange={handleChange} />
              <TestHeading>Padula visual midline shift test:</TestHeading>
              <TextLine label="Performance" path={["vestibular_screening", "padula_visual_midline_shift", "performance"]} value={formValue} onChange={handleChange} />
              <TextLine label="Type of shift" path={["vestibular_screening", "padula_visual_midline_shift", "type_of_shift"]} value={formValue} onChange={handleChange} />
              <TextLine label="Comments" path={["vestibular_screening", "padula_visual_midline_shift", "comments"]} value={formValue} onChange={handleChange} />
              <TestHeading>15 -diopter Yolk prism walk:</TestHeading>
              <TextLine label="Base-right response" path={["vestibular_screening", "yoked_prism_walk", "base_right_response"]} value={formValue} onChange={handleChange} />
              <TextLine label="Base-up response" path={["vestibular_screening", "yoked_prism_walk", "base_up_response"]} value={formValue} onChange={handleChange} />
              <TextLine label="Base-left response" path={["vestibular_screening", "yoked_prism_walk", "base_left_response"]} value={formValue} onChange={handleChange} />
              <TextLine label="Base-down response" path={["vestibular_screening", "yoked_prism_walk", "base_down_response"]} value={formValue} onChange={handleChange} />
              <TestHeading>Vestibulo-ocular reflex test:</TestHeading>
              <table className="mt-2 w-full border-collapse text-sm">
                <tbody>
                  <tr>
                    <td className="w-1/3 border border-black px-2 py-1">Performance:</td>
                    <td className="w-1/3 border border-black px-2 py-1">Normal</td>
                    <td className="w-1/3 border border-black px-2 py-1">Abnormal</td>
                  </tr>
                  {[
                    ["right", "Right:"],
                    ["left", "Left:"],
                    ["upwards", "Upwards:"],
                    ["downwards", "Downwards:"],
                  ].map(([key, label]) => (
                    <tr key={key}>
                      <td className="border border-black px-2 py-1">{label}</td>
                      <td className="border border-black p-0"><input value={getAtPath(formValue, ["vestibular_screening", "vestibulo_ocular_reflex", key, "normal"])} onChange={(event) => handleChange(["vestibular_screening", "vestibulo_ocular_reflex", key, "normal"], event.target.value)} className="w-full bg-transparent px-2 py-1 outline-none" /></td>
                      <td className="border border-black p-0"><input value={getAtPath(formValue, ["vestibular_screening", "vestibulo_ocular_reflex", key, "abnormal"])} onChange={(event) => handleChange(["vestibular_screening", "vestibulo_ocular_reflex", key, "abnormal"], event.target.value)} className="w-full bg-transparent px-2 py-1 outline-none" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TextLine label="Comments" path={["vestibular_screening", "vestibulo_ocular_reflex", "comments"]} value={formValue} onChange={handleChange} />

              <SectionHeading>Final comments:</SectionHeading>
              <textarea value={getAtPath(formValue, ["final_comments"])} onChange={(event) => handleChange(["final_comments"], event.target.value)} rows={5} className="w-full resize-y border-b border-black bg-transparent px-1 py-1 outline-none" />
              <SectionHeading>Management and therapy options:</SectionHeading>
              <textarea value={getAtPath(formValue, ["management_and_therapy_options"])} onChange={(event) => handleChange(["management_and_therapy_options"], event.target.value)} rows={5} className="w-full resize-y border-b border-black bg-transparent px-1 py-1 outline-none" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
