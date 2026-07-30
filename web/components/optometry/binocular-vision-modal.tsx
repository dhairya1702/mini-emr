"use client";

import { ReactNode, useMemo, useState } from "react";
import { X } from "lucide-react";

import type { BinocularVisionEvaluationCreatePayload, BinocularVisionEvaluationRecord, BinocularVisionPayload, Patient } from "@/lib/types";

type FormValue = Record<string, unknown>;

const EMPTY_PAYLOAD: FormValue = {
  history: {
    main_complaints: "",
    spectacle_use_history: "",
    near_work_hours: "",
    associated_symptoms: "",
    previous_vision_therapy: "",
    general_health_medications: "",
  },
  refraction: {
    visual_acuity_with_glasses: { od: "", os: "" },
    visual_acuity_unaided: { od: "", os: "" },
    pgp: { od: "", os: "" },
    static_retinoscopy: { od: "", os: "" },
    acceptance: { od: "", os: "" },
    duochrome: { od: "", os: "" },
    jcc: { od: "", os: "" },
    add: { od: "", os: "" },
    borish_delayed_test: { od: "", os: "" },
    binocular_balancing: { od: "", os: "" },
  },
  assessment_setup: {
    tested_with: "",
  },
  sensory_evaluation: {
    stereopsis: { distance: "", near: "" },
    worth_four_dot: { near: "", intermediate: "", distance: "" },
  },
  motor_evaluation: {
    eom: { od: "", os: "" },
    cover_test: { distance: "", near: "" },
    maddox_rod_horizontal: { distance: "", near: "" },
    maddox_rod_vertical: { distance: "", near: "" },
    pbct: { distance: "", near: "" },
    ac_a_ratio: "",
    npc_accommodative_target: { subjective: "", objective: "" },
    npc_penlight_red_filter: { subjective: "", objective: "" },
    npc_comments: "",
    npa: { od: "", os: "", ou: "" },
    aa: { od: "", os: "", ou: "" },
    hoffstetter_min: "",
    mem: { od: "", os: "" },
    nra: "",
    pra: "",
    fusional_vergence: {
      nfv_distance: { blur: "", break: "", recovery: "" },
      pfv_distance: { blur: "", break: "", recovery: "" },
      nfv_near: { blur: "", break: "", recovery: "" },
      pfv_near: { blur: "", break: "", recovery: "" },
    },
    vergence_facility: { cpm: "", comments: "" },
    accommodative_facility: {
      lens: "",
      test_distance: "",
      od_cpm: "",
      os_cpm: "",
      ou_cpm: "",
      comments: "",
    },
  },
  impression: "",
  advice: "",
  follow_up: "",
};

function clonePayload() {
  return JSON.parse(JSON.stringify(EMPTY_PAYLOAD)) as FormValue;
}

function normalizePayload(payload?: BinocularVisionPayload | null) {
  if (!payload || typeof payload !== "object") {
    return clonePayload();
  }
  return mergeDeep(clonePayload(), payload as FormValue);
}

function mergeDeep(base: FormValue, patch: FormValue): FormValue {
  const next: FormValue = { ...base };
  Object.entries(patch).forEach(([key, value]) => {
    const current = next[key];
    if (
      current &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      next[key] = mergeDeep(current as FormValue, value as FormValue);
    } else {
      next[key] = value;
    }
  });
  return next;
}

function getAtPath(payload: FormValue, path: string[]) {
  let current: unknown = payload;
  for (const part of path) {
    if (!current || typeof current !== "object") {
      return "";
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : "";
}

function setAtPath(payload: FormValue, path: string[], value: string): FormValue {
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
  value: FormValue;
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
  rows = 2,
}: {
  label: string;
  path: string[];
  value: FormValue;
  onChange: (path: string[], nextValue: string) => void;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="font-semibold">{label}:</span>
      <textarea
        rows={rows}
        value={getAtPath(value, path)}
        onChange={(event) => onChange(path, event.target.value)}
        className="mt-1 w-full resize-y border-b border-black bg-transparent px-1 py-1 outline-none"
      />
    </label>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h4 className="mt-8 text-base font-bold underline">{children}</h4>;
}

function TwoEyeRow({
  basePath,
  value,
  onChange,
}: {
  basePath: string[];
  value: FormValue;
  onChange: (path: string[], nextValue: string) => void;
}) {
  return (
    <div className="grid grid-cols-2">
      <FieldBox label="OD" path={[...basePath, "od"]} value={value} onChange={onChange} />
      <FieldBox label="OS" path={[...basePath, "os"]} value={value} onChange={onChange} />
    </div>
  );
}

function ThreeValueRow({
  labels,
  basePath,
  value,
  onChange,
}: {
  labels: Array<{ key: string; label: string }>;
  basePath: string[];
  value: FormValue;
  onChange: (path: string[], nextValue: string) => void;
}) {
  return (
    <div className="grid grid-cols-3">
      {labels.map((entry) => (
        <FieldBox key={entry.key} label={entry.label} path={[...basePath, entry.key]} value={value} onChange={onChange} />
      ))}
    </div>
  );
}

function SensoryTable({
  value,
  onChange,
}: {
  value: FormValue;
  onChange: (path: string[], nextValue: string) => void;
}) {
  return (
    <table className="mt-2 w-full border-collapse text-sm">
      <thead>
        <tr>
          <th className="border border-black px-2 py-1 text-left">Test</th>
          <th className="border border-black px-2 py-1 text-left">Distance</th>
          <th className="border border-black px-2 py-1 text-left">Near</th>
          <th className="border border-black px-2 py-1 text-left">Normative value</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="border border-black px-2 py-1 font-semibold">Stereopsis</td>
          <td className="border border-black p-0"><input value={getAtPath(value, ["sensory_evaluation", "stereopsis", "distance"])} onChange={(event) => onChange(["sensory_evaluation", "stereopsis", "distance"], event.target.value)} className="w-full bg-transparent px-2 py-1 outline-none" /></td>
          <td className="border border-black p-0"><input value={getAtPath(value, ["sensory_evaluation", "stereopsis", "near"])} onChange={(event) => onChange(["sensory_evaluation", "stereopsis", "near"], event.target.value)} className="w-full bg-transparent px-2 py-1 outline-none" /></td>
          <td className="border border-black px-2 py-1">D 78 sec arc · N 40 sec arc</td>
        </tr>
      </tbody>
    </table>
  );
}

function WorthFourDotTable({
  value,
  onChange,
}: {
  value: FormValue;
  onChange: (path: string[], nextValue: string) => void;
}) {
  return (
    <table className="mt-4 w-full border-collapse text-sm">
      <thead>
        <tr>
          <th className="border border-black px-2 py-1 text-left">W4DT</th>
          <th className="border border-black px-2 py-1 text-left">Near</th>
          <th className="border border-black px-2 py-1 text-left">Intermediate</th>
          <th className="border border-black px-2 py-1 text-left">Distance</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="border border-black px-2 py-1">Fusion / suppression / diplopia</td>
          {["near", "intermediate", "distance"].map((key) => (
            <td key={key} className="border border-black p-0">
              <input value={getAtPath(value, ["sensory_evaluation", "worth_four_dot", key])} onChange={(event) => onChange(["sensory_evaluation", "worth_four_dot", key], event.target.value)} className="w-full bg-transparent px-2 py-1 outline-none" />
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

function VergenceTable({
  value,
  onChange,
}: {
  value: FormValue;
  onChange: (path: string[], nextValue: string) => void;
}) {
  const rows = [
    ["nfv_distance", "NFV Distance", "Blur 7 / Break 9 / Recovery 4"],
    ["pfv_distance", "PFV Distance", "Blur 9 / Break 19 / Recovery 10"],
    ["nfv_near", "NFV Near", "Blur 13 / Break 21 / Recovery 13"],
    ["pfv_near", "PFV Near", "Blur 17 / Break 21 / Recovery 11"],
  ];
  return (
    <table className="mt-2 w-full border-collapse text-sm">
      <thead>
        <tr>
          <th className="border border-black px-2 py-1 text-left">Fusional vergence</th>
          <th className="border border-black px-2 py-1 text-left">Blur</th>
          <th className="border border-black px-2 py-1 text-left">Break</th>
          <th className="border border-black px-2 py-1 text-left">Recovery</th>
          <th className="border border-black px-2 py-1 text-left">Normative</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([key, label, normative]) => (
          <tr key={key}>
            <td className="border border-black px-2 py-1 font-semibold">{label}</td>
            {["blur", "break", "recovery"].map((field) => (
              <td key={field} className="border border-black p-0">
                <input value={getAtPath(value, ["motor_evaluation", "fusional_vergence", key, field])} onChange={(event) => onChange(["motor_evaluation", "fusional_vergence", key, field], event.target.value)} className="w-full bg-transparent px-2 py-1 outline-none" />
              </td>
            ))}
            <td className="border border-black px-2 py-1">{normative}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function recordSummary(record: BinocularVisionEvaluationRecord) {
  const summary = record.summary_fields?.summary;
  return typeof summary === "string" && summary.trim() ? summary.trim() : "Binocular vision evaluation saved.";
}

export function BinocularVisionModal({
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
  evaluations: BinocularVisionEvaluationRecord[];
  isLoading: boolean;
  error: string;
  readOnly: boolean;
  onClose: () => void;
  onSave: (payload: BinocularVisionEvaluationCreatePayload) => Promise<void>;
}) {
  const [measuredAt, setMeasuredAt] = useState(() => toDateTimeLocal(new Date()));
  const [formValue, setFormValue] = useState<FormValue>(() => clonePayload());
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const latestEvaluations = useMemo(() => evaluations.slice().reverse(), [evaluations]);

  if (!open) {
    return null;
  }

  function handleChange(path: string[], nextValue: string) {
    setFormValue((current) => setAtPath(current, path, nextValue));
  }

  function loadEvaluation(record: BinocularVisionEvaluationRecord) {
    setFormValue(normalizePayload(record.payload));
    setMeasuredAt(toDateTimeLocal(new Date(record.measured_at)));
  }

  async function handleSave() {
    setIsSaving(true);
    setSaveError("");
    try {
      await onSave({
        measured_at: fromDateTimeLocal(measuredAt),
        payload: formValue as BinocularVisionPayload,
      });
      setFormValue(clonePayload());
      setMeasuredAt(toDateTimeLocal(new Date()));
    } catch (saveFailure) {
      setSaveError(saveFailure instanceof Error ? saveFailure.message : "Failed to save binocular vision evaluation.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-950/50 p-0 sm:items-center sm:px-2 sm:py-4">
      <div className="flex h-[100dvh] w-full max-w-7xl flex-col overflow-hidden border-0 border-slate-300 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.35)] sm:max-h-[95vh] sm:rounded-[18px] sm:border">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-3 py-2.5 sm:gap-4 sm:px-5 sm:py-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-slate-900 sm:text-xl">Binocular Vision Assessment</h3>
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
                <button key={evaluation.id} type="button" onClick={() => loadEvaluation(evaluation)} className="block w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-[#bfd7e8]">
                  <p className="text-sm font-medium text-slate-900">
                    {new Date(evaluation.measured_at).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">{recordSummary(evaluation)}</p>
                </button>
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

              <p className="text-lg font-bold underline">Binocular Vision Assessment</p>

              <SectionHeading>1. History</SectionHeading>
              <TextLine label="Main complaints" path={["history", "main_complaints"]} value={formValue} onChange={handleChange} />
              <TextLine label="History of spectacle use" path={["history", "spectacle_use_history"]} value={formValue} onChange={handleChange} />
              <TextLine label="Hours of near work / computer use" path={["history", "near_work_hours"]} value={formValue} onChange={handleChange} />
              <TextLine label="Associated symptoms" path={["history", "associated_symptoms"]} value={formValue} onChange={handleChange} />
              <TextLine label="Previous vision therapy details" path={["history", "previous_vision_therapy"]} value={formValue} onChange={handleChange} />
              <TextLine label="General health / medication details" path={["history", "general_health_medications"]} value={formValue} onChange={handleChange} />

              <SectionHeading>2. Refraction</SectionHeading>
              <p>Visual acuity with glasses:</p>
              <TwoEyeRow basePath={["refraction", "visual_acuity_with_glasses"]} value={formValue} onChange={handleChange} />
              <p className="mt-4">Unaided visual acuity:</p>
              <TwoEyeRow basePath={["refraction", "visual_acuity_unaided"]} value={formValue} onChange={handleChange} />
              {[
                ["pgp", "PGP"],
                ["static_retinoscopy", "Static retinoscopy"],
                ["acceptance", "Acceptance"],
                ["duochrome", "Duochrome"],
                ["jcc", "JCC"],
                ["add", "Add"],
                ["borish_delayed_test", "Borish delayed test"],
                ["binocular_balancing", "Binocular balancing"],
              ].map(([key, label]) => (
                <div key={key} className="mt-4">
                  <p>{label}:</p>
                  <TwoEyeRow basePath={["refraction", key]} value={formValue} onChange={handleChange} />
                </div>
              ))}

              <SectionHeading>3. Assessment Setup</SectionHeading>
              <TextLine label="Test performed with" path={["assessment_setup", "tested_with"]} value={formValue} onChange={handleChange} rows={1} />

              <SectionHeading>4. Sensory Evaluation</SectionHeading>
              <SensoryTable value={formValue} onChange={handleChange} />
              <WorthFourDotTable value={formValue} onChange={handleChange} />

              <SectionHeading>5. Motor Evaluation</SectionHeading>
              <p>EOM:</p>
              <TwoEyeRow basePath={["motor_evaluation", "eom"]} value={formValue} onChange={handleChange} />
              <p className="mt-4">Cover test:</p>
              <div className="grid grid-cols-2">
                <FieldBox label="D" path={["motor_evaluation", "cover_test", "distance"]} value={formValue} onChange={handleChange} />
                <FieldBox label="N" path={["motor_evaluation", "cover_test", "near"]} value={formValue} onChange={handleChange} />
              </div>
              <p className="mt-4">Maddox rod horizontal:</p>
              <div className="grid grid-cols-2">
                <FieldBox label="D" path={["motor_evaluation", "maddox_rod_horizontal", "distance"]} value={formValue} onChange={handleChange} />
                <FieldBox label="N" path={["motor_evaluation", "maddox_rod_horizontal", "near"]} value={formValue} onChange={handleChange} />
              </div>
              <p className="mt-4">Maddox rod vertical:</p>
              <div className="grid grid-cols-2">
                <FieldBox label="D" path={["motor_evaluation", "maddox_rod_vertical", "distance"]} value={formValue} onChange={handleChange} />
                <FieldBox label="N" path={["motor_evaluation", "maddox_rod_vertical", "near"]} value={formValue} onChange={handleChange} />
              </div>
              <p className="mt-4">PBCT:</p>
              <div className="grid grid-cols-2">
                <FieldBox label="D" path={["motor_evaluation", "pbct", "distance"]} value={formValue} onChange={handleChange} />
                <FieldBox label="N" path={["motor_evaluation", "pbct", "near"]} value={formValue} onChange={handleChange} />
              </div>
              <TextLine label="AC/A ratio" path={["motor_evaluation", "ac_a_ratio"]} value={formValue} onChange={handleChange} rows={1} />
              <p className="mt-4">NPC - accommodative target:</p>
              <ThreeValueRow labels={[{ key: "subjective", label: "Subj" }, { key: "objective", label: "Obj" }, { key: "comments", label: "Comments" }]} basePath={["motor_evaluation", "npc_accommodative_target"]} value={formValue} onChange={(path, next) => {
                if (path.at(-1) === "comments") {
                  handleChange(["motor_evaluation", "npc_comments"], next);
                } else {
                  handleChange(path, next);
                }
              }} />
              <p className="mt-4">NPC - penlight red/green or red filter:</p>
              <ThreeValueRow labels={[{ key: "subjective", label: "Subj" }, { key: "objective", label: "Obj" }, { key: "comments", label: "Comments" }]} basePath={["motor_evaluation", "npc_penlight_red_filter"]} value={formValue} onChange={(path, next) => {
                if (path.at(-1) === "comments") {
                  handleChange(["motor_evaluation", "npc_comments"], next);
                } else {
                  handleChange(path, next);
                }
              }} />
              <p className="mt-4 text-sm">NPC normative: child 5 cm objective / 7 cm subjective; adult 8 cm objective / 10 cm subjective.</p>
              <p className="mt-4">NPA:</p>
              <ThreeValueRow labels={[{ key: "od", label: "OD" }, { key: "os", label: "OS" }, { key: "ou", label: "OU" }]} basePath={["motor_evaluation", "npa"]} value={formValue} onChange={handleChange} />
              <p className="mt-4">AA:</p>
              <ThreeValueRow labels={[{ key: "od", label: "OD" }, { key: "os", label: "OS" }, { key: "ou", label: "OU" }]} basePath={["motor_evaluation", "aa"]} value={formValue} onChange={handleChange} />
              <p className="mt-2 text-sm">Hofstetter minimum: 15 - 0.25 x age.</p>
              <TextLine label="Hofstetter minimum" path={["motor_evaluation", "hoffstetter_min"]} value={formValue} onChange={handleChange} rows={1} />
              <p className="mt-4">MEM (normative +0.25D to +0.75D):</p>
              <TwoEyeRow basePath={["motor_evaluation", "mem"]} value={formValue} onChange={handleChange} />
              <div className="mt-4 grid grid-cols-2 gap-0">
                <FieldBox label="NRA (+1.50D to +2.50D)" path={["motor_evaluation", "nra"]} value={formValue} onChange={handleChange} />
                <FieldBox label="PRA (-1.50D to -3.50D)" path={["motor_evaluation", "pra"]} value={formValue} onChange={handleChange} />
              </div>
              <VergenceTable value={formValue} onChange={handleChange} />
              <p className="mt-4">Vergence facility (12 BO / 3 BI flippers; normative 8-15 cpm):</p>
              <div className="grid grid-cols-2">
                <FieldBox label="CPM" path={["motor_evaluation", "vergence_facility", "cpm"]} value={formValue} onChange={handleChange} />
                <FieldBox label="Comments" path={["motor_evaluation", "vergence_facility", "comments"]} value={formValue} onChange={handleChange} />
              </div>
              <p className="mt-4">Accommodative facility:</p>
              <ThreeValueRow labels={[{ key: "lens", label: "Lens" }, { key: "test_distance", label: "Distance" }, { key: "od_cpm", label: "OD cpm" }]} basePath={["motor_evaluation", "accommodative_facility"]} value={formValue} onChange={handleChange} />
              <ThreeValueRow labels={[{ key: "os_cpm", label: "OS cpm" }, { key: "ou_cpm", label: "OU cpm" }, { key: "comments", label: "Comments" }]} basePath={["motor_evaluation", "accommodative_facility"]} value={formValue} onChange={handleChange} />
              <p className="mt-2 text-sm">Norms depend on lens and age; record the lens used with the CPM.</p>

              <SectionHeading>6. Impression</SectionHeading>
              <textarea value={getAtPath(formValue, ["impression"])} onChange={(event) => handleChange(["impression"], event.target.value)} rows={4} className="w-full resize-y border-b border-black bg-transparent px-1 py-1 outline-none" />
              <SectionHeading>7. Advice</SectionHeading>
              <textarea value={getAtPath(formValue, ["advice"])} onChange={(event) => handleChange(["advice"], event.target.value)} rows={4} className="w-full resize-y border-b border-black bg-transparent px-1 py-1 outline-none" />
              <SectionHeading>8. Follow up</SectionHeading>
              <textarea value={getAtPath(formValue, ["follow_up"])} onChange={(event) => handleChange(["follow_up"], event.target.value)} rows={3} className="w-full resize-y border-b border-black bg-transparent px-1 py-1 outline-none" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
