"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { OptometryActionFooter, OptometryModalShell } from "@/components/optometry/optometry-modal-shell";
import { ClinicalDrawingModal } from "@/components/clinical-drawing-modal";
import { hasEyeExamData } from "@/lib/structured-modules";
import type { EyeExamPayload } from "@/lib/types";

type Data = Record<string, unknown>;
type Path = string[];
type Setter = (path: Path, value: unknown) => void;

type Props = {
  open: boolean;
  value: EyeExamPayload;
  onClose: () => void;
  onSave: (next: EyeExamPayload) => void | Promise<void>;
  onDraftChange?: (next: EyeExamPayload) => void;
  onContinue?: (next: EyeExamPayload) => void | Promise<void>;
  inline?: boolean;
  sidebar?: ReactNode;
  activePage?: number;
  onActivePageChange?: (page: number) => void;
};

const PAGES = ["Visual acuity", "Refraction", "Glasses prescriptions", "PMT and Keratometry", "IOP", "Ocular Examination", "Additional tests"];
const EYES = [["right", "Right eye / OD"], ["left", "Left eye / OS"]] as const;
const DISTANCE_ACUITY = ["PL-", "PL+", "FL", "HM", "CFCF", "FC", "1/60", "2/60", "3/60", "4/60", "5/60", "6/60", "6/36", "6/24", "6/18", "6/12", "6/9", "6/7.5", "6/6", "6/5"];
const NEAR_ACUITY = ["N4", "N5", "N6", "N8", "N10", "N12", "N14", "N18", "N24", "N36", "<N36"];
const CONTRAST_VALUES = ["2.25", "2.10", "1.95", "1.80", "1.65", "1.50", "1.35", "1.20", "1.05", "0.90", "0.75", "0.60"];
const ANTERIOR_STRUCTURES = ["Appearance", "Adnexa", "Conjunctiva", "Sclera", "Cornea", "Anterior chamber (AC)", "Pupil", "Iris", "Lens"];
const POSTERIOR_STRUCTURES = ["Vitreous", "Choroid", "Fundus"];
const EXAM_STRUCTURES = [...ANTERIOR_STRUCTURES, ...POSTERIOR_STRUCTURES];

function get(data: Data, path: Path): unknown {
  let current: unknown = data;
  for (const part of path) {
    if (!current || typeof current !== "object") return "";
    current = (current as Data)[part];
  }
  return current ?? "";
}

function set(data: Data, path: Path, value: unknown): Data {
  const next = { ...data };
  let current = next;
  path.slice(0, -1).forEach((part) => {
    const child = current[part];
    current[part] = child && typeof child === "object" && !Array.isArray(child) ? { ...(child as Data) } : {};
    current = current[part] as Data;
  });
  current[path.at(-1)!] = value;
  return next;
}

function Page({ title, children }: { title: string; children: ReactNode }) {
  return <div className="w-full bg-white text-slate-950"><h3 className="mb-5 text-center text-lg font-bold uppercase underline decoration-1 underline-offset-4">{title}</h3><div className="space-y-6">{children}</div></div>;
}

function Title({ children }: { children: ReactNode }) {
  return <h4 className="border border-black bg-slate-100 px-3 py-2 text-center text-sm font-bold uppercase tracking-[0.08em] text-black">{children}</h4>;
}

function Field({ label, path, data, change, multiline = false }: { label: string; path: Path; data: Data; change: Setter; multiline?: boolean }) {
  const value = String(get(data, path));
  return <label className="grid border border-black sm:grid-cols-[220px_minmax(0,1fr)]"><span className="border-b border-black bg-slate-50 px-3 py-2 text-sm font-semibold text-black sm:border-b-0 sm:border-r">{label}</span>{multiline ? <textarea rows={3} value={value} onChange={(event) => change(path, event.target.value)} className="resize-y px-3 py-2 text-sm outline-none" /> : <input value={value} onChange={(event) => change(path, event.target.value)} className="min-w-0 px-3 py-2 text-sm outline-none" />}</label>;
}

function Choice({ label, path, options, data, change }: { label: string; path: Path; options: string[]; data: Data; change: Setter }) {
  const value = String(get(data, path));
  return <div className="grid border border-black sm:grid-cols-[220px_minmax(0,1fr)]"><span className="border-b border-black bg-slate-50 px-3 py-2 text-sm font-semibold text-black sm:border-b-0 sm:border-r">{label}</span><div className="flex flex-wrap gap-2 p-2">{options.map((option) => <button key={option} type="button" onClick={() => change(path, value === option ? "" : option)} className={`border px-3 py-1.5 text-sm font-medium ${value === option ? "border-slate-900 bg-slate-900 text-white" : "border-slate-400 bg-white text-slate-700"}`}>{option}</button>)}</div></div>;
}

function AcuityValue({ label, path, options, data, change }: { label: string; path: Path; options: string[]; data: Data; change: Setter }) {
  const value = String(get(data, path));
  return <div className="border border-black"><div className="flex items-center border-b border-black bg-slate-50"><span className="w-28 shrink-0 border-r border-black px-3 py-2 text-sm font-semibold text-black">{label}</span><input aria-label={label} value={value} onChange={(event) => change(path, event.target.value)} placeholder="Select or type" className="min-w-0 flex-1 px-3 py-2 text-sm outline-none" /></div><div className="flex flex-wrap gap-1.5 p-2">{options.map((option) => <button key={option} type="button" onClick={() => change(path, option)} className={`border px-2 py-1 text-xs font-semibold ${value === option ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{option}</button>)}</div></div>;
}

function EyeTable({ title, columns, base, data, change, compact = false }: { title: string; columns: Array<[string, string]>; base: Path; data: Data; change: Setter; compact?: boolean }) {
  return <div className="min-w-0 overflow-x-auto"><table className={`w-full border-collapse text-sm ${compact ? "table-fixed min-w-[480px]" : "min-w-[760px]"}`}>{compact ? <colgroup><col className="w-[34%]" />{columns.map(([, key]) => <col key={key} className="w-[22%]" />)}</colgroup> : null}<thead><tr><th colSpan={columns.length + 1} className="border border-black bg-slate-100 px-3 py-2 uppercase text-black">{title}</th></tr><tr><th className="border border-black bg-slate-50 px-3 py-2 text-left text-black">Eye</th>{columns.map(([label]) => <th key={label} className="border border-black bg-slate-50 px-3 py-2 text-black">{label}</th>)}</tr></thead><tbody>{EYES.map(([eye, label]) => <tr key={eye}><th className="border border-black bg-slate-50 px-3 py-2 text-left text-black">{label}</th>{columns.map(([column, key]) => <td key={key} className="border border-black p-0"><input aria-label={`${label} ${column}`} value={String(get(data, [...base, eye, key]))} onChange={(event) => change([...base, eye, key], event.target.value)} className={`w-full px-3 py-2 outline-none ${compact ? "min-w-0" : "min-w-24"}`} /></td>)}</tr>)}</tbody></table></div>;
}

function VisualAcuity({ data, change }: { data: Data; change: Setter }) {
  const measurements = [["UCVA", "ucva"], ["Pinhole", "pinhole"], ["With glasses", "glasses"], ["With contact lens", "contact_lens"]] as const;
  return <Page title="Visual Acuity">{EYES.map(([eye, eyeLabel]) => <section key={eye} className="space-y-4"><Title>{eyeLabel}</Title>{measurements.map(([label, key]) => <div key={key} className="grid gap-3 xl:grid-cols-2"><AcuityValue label={`${label} distance`} path={["visual_acuity", eye, `${key}_distance`]} options={DISTANCE_ACUITY} data={data} change={change} /><AcuityValue label={`${label} near`} path={["visual_acuity", eye, `${key}_near`]} options={NEAR_ACUITY} data={data} change={change} /></div>)}<Field label={`${eyeLabel} comments`} path={["visual_acuity", eye, "comments"]} data={data} change={change} multiline /></section>)}</Page>;
}

const REFRACTION_COLUMNS: Array<[string, string]> = [["Sphere", "sphere"], ["Cylinder", "cylinder"], ["Axis", "axis"], ["Distance vision", "distance_vision"], ["Add", "add"], ["Near vision", "near_vision"]];

function Refraction({ data, change }: { data: Data; change: Setter }) {
  return <Page title="Refraction"><EyeTable title="Dry/Auto Refraction" columns={REFRACTION_COLUMNS} base={["refraction", "dry"]} data={data} change={change} /><div className="grid gap-3 md:grid-cols-2"><Field label="OD retinoscopy notation" path={["refraction", "dry", "right", "retinoscopy"]} data={data} change={change} /><Field label="OS retinoscopy notation" path={["refraction", "dry", "left", "retinoscopy"]} data={data} change={change} /></div><Field label="Dry refraction comments" path={["refraction", "dry", "comments"]} data={data} change={change} multiline /><EyeTable title="Dilated / Cycloplegic Refraction" columns={REFRACTION_COLUMNS} base={["refraction", "dilated"]} data={data} change={change} /><div className="grid gap-3 md:grid-cols-2"><Field label="Drug used" path={["refraction", "dilated", "drug_used"]} data={data} change={change} /><Field label="Dilated refraction comments" path={["refraction", "dilated", "comments"]} data={data} change={change} /></div></Page>;
}

const RX_COLUMNS: Array<[string, string]> = [["Sphere", "sphere"], ["Cylinder", "cylinder"], ["Axis", "axis"], ["Vision", "vision"], ["Add", "add"]];

function PrescriptionDetails({ name, path, data, change }: { name: string; path: string; data: Data; change: Setter }) {
  return <section className="space-y-3"><EyeTable title={name} columns={RX_COLUMNS} base={["prescriptions", path, "eyes"]} data={data} change={change} /><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><Field label="Type of lens" path={["prescriptions", path, "lens_type"]} data={data} change={change} /><Field label="Lens material" path={["prescriptions", path, "lens_material"]} data={data} change={change} /><Field label="Lens tint" path={["prescriptions", path, "lens_tint"]} data={data} change={change} /><Field label="IPD" path={["prescriptions", path, "ipd"]} data={data} change={change} /></div></section>;
}

function DistanceNearPrescription({ data, change }: { data: Data; change: Setter }) {
  const columns: Array<[string, string, string]> = [["SPH", "distance", "sphere"], ["CYL", "distance", "cylinder"], ["Axis", "distance", "axis"], ["Distance VA", "distance", "vision"], ["ADD", "distance", "add"], ["Near VA", "near", "vision"]];
  return <section className="space-y-3"><div className="min-w-0 overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-sm"><thead><tr><th colSpan={columns.length + 1} className="border border-black bg-slate-100 px-3 py-2 uppercase text-black">Distance/Near</th></tr><tr><th className="border border-black bg-slate-50 px-3 py-2 text-left text-black">Eye</th>{columns.map(([label]) => <th key={label} className="border border-black bg-slate-50 px-3 py-2 text-black">{label}</th>)}</tr></thead><tbody>{EYES.map(([eye, label]) => <tr key={eye}><th className="border border-black bg-slate-50 px-3 py-2 text-left text-black">{label}</th>{columns.map(([column, section, key]) => <td key={column} className="border border-black p-0"><input aria-label={`${label} ${column}`} value={String(get(data, ["prescriptions", section, "eyes", eye, key]))} onChange={(event) => change(["prescriptions", section, "eyes", eye, key], event.target.value)} placeholder={["SPH", "CYL", "ADD"].includes(column) ? "+ / -" : undefined} className="w-full min-w-24 px-3 py-2 outline-none" /></td>)}</tr>)}</tbody></table></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><Field label="Type of lens" path={["prescriptions", "distance", "lens_type"]} data={data} change={change} /><Field label="Lens material" path={["prescriptions", "distance", "lens_material"]} data={data} change={change} /><Field label="Lens tint" path={["prescriptions", "distance", "lens_tint"]} data={data} change={change} /><Field label="IPD" path={["prescriptions", "distance", "ipd"]} data={data} change={change} /></div></section>;
}

function GlassesPrescriptions({ data, change }: { data: Data; change: Setter }) {
  return <Page title="Glasses Prescriptions"><DistanceNearPrescription data={data} change={change} /><PrescriptionDetails name="Intermediate Glasses Prescription" path="intermediate" data={data} change={change} /><Title>Dispensing Details</Title><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><Field label="Frame material" path={["prescriptions", "dispensing", "frame_material"]} data={data} change={change} /><Field label="Frame size" path={["prescriptions", "dispensing", "frame_size"]} data={data} change={change} /><Field label="Diameter" path={["prescriptions", "dispensing", "diameter"]} data={data} change={change} /><Field label="Prism" path={["prescriptions", "dispensing", "prism"]} data={data} change={change} /><Field label="Base" path={["prescriptions", "dispensing", "base"]} data={data} change={change} /><Field label="Fitting height" path={["prescriptions", "dispensing", "fitting_height"]} data={data} change={change} /></div><Field label="Advice" path={["prescriptions", "advice"]} data={data} change={change} multiline /></Page>;
}

function PmtKeratometry({ data, change }: { data: Data; change: Setter }) {
  return <Page title="PMT and Keratometry"><EyeTable title="Post-mydriatic Test (PMT)" columns={REFRACTION_COLUMNS} base={["pmt"]} data={data} change={change} /><EyeTable title="Keratometry" columns={[["K1", "k1"], ["K1 axis", "k1_axis"], ["K2", "k2"], ["K2 axis", "k2_axis"], ["Average K", "average_k"], ["K cylinder", "k_cylinder"]]} base={["keratometry"]} data={data} change={change} /><Field label="Keratometry comments" path={["keratometry", "comments"]} data={data} change={change} multiline /></Page>;
}

function IntraocularPressure({ data, change }: { data: Data; change: Setter }) {
  return <Page title="IOP"><EyeTable title="Intraocular Pressure" columns={[["Value (mmHg)", "value"], ["Method", "method"], ["Time", "time"], ["Comments", "comments"]]} base={["iop"]} data={data} change={change} /></Page>;
}

function AdditionalTests({ data, change }: { data: Data; change: Setter }) {
  return <Page title="Additional Tests"><div className="grid gap-4 xl:grid-cols-2">{EYES.map(([eye, label]) => <div key={eye} className="space-y-3"><Choice label={`${label} Amsler`} path={["amsler", eye, "status"]} options={["Normal", "Abnormal"]} data={data} change={change} /><Field label={`${label} Amsler comments`} path={["amsler", eye, "comments"]} data={data} change={change} /></div>)}</div><EyeTable title="Quick Contact Lens Measurements" columns={[["BC", "bc"], ["DIA", "dia"], ["SPH", "sphere"], ["CYL", "cylinder"], ["Axis", "axis"], ["ADD", "add"]]} base={["contact_lens"]} data={data} change={change} /><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><Field label="Contact lens type" path={["contact_lens", "type"]} data={data} change={change} /><Field label="Colour" path={["contact_lens", "colour"]} data={data} change={change} /><Field label="Revisit date" path={["contact_lens", "revisit_date"]} data={data} change={change} /><Field label="Advice" path={["contact_lens", "advice"]} data={data} change={change} /></div><div className="grid gap-4 xl:grid-cols-2">{EYES.map(([eye, label]) => <div key={eye} className="space-y-3"><Field label={`${label} colour vision`} path={["colour_vision", eye, "result"]} data={data} change={change} /><AcuityValue label={`${label} contrast`} path={["contrast_sensitivity", eye, "value"]} options={CONTRAST_VALUES} data={data} change={change} /><Field label={`${label} contrast comments`} path={["contrast_sensitivity", eye, "comments"]} data={data} change={change} /></div>)}</div><Field label="Orthoptic screening" path={["orthoptics", "screening"]} data={data} change={change} multiline /><Field label="Additional test comments" path={["additional_tests", "comments"]} data={data} change={change} multiline /></Page>;
}

function OcularStructureTable({ title, structures, data, change }: { title: string; structures: string[]; data: Data; change: Setter }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[980px] border-collapse text-sm"><thead><tr><th colSpan={5} className="border border-black bg-slate-100 px-3 py-2 text-center uppercase text-black">{title}</th></tr><tr><th className="border border-black bg-slate-100 px-3 py-2 text-left text-black">Structure</th>{EYES.map(([eye, label]) => <th key={eye} colSpan={2} className="border border-black bg-slate-100 px-3 py-2 text-black">{label}</th>)}</tr><tr><th className="border border-black bg-slate-50" />{EYES.flatMap(([eye]) => [<th key={`${eye}-status`} className="border border-black bg-slate-50 px-3 py-2 text-black">Status</th>, <th key={`${eye}-finding`} className="border border-black bg-slate-50 px-3 py-2 text-black">Finding / comments</th>])}</tr></thead><tbody>{structures.map((structure) => <tr key={structure}><th className="border border-black bg-slate-50 px-3 py-2 text-left text-black">{structure}</th>{EYES.flatMap(([eye]) => [<td key={`${eye}-status`} className="border border-black p-0"><select aria-label={`${eye} ${structure} status`} value={String(get(data, ["examination", "eyes", eye, structure, "status"]))} onChange={(event) => change(["examination", "eyes", eye, structure, "status"], event.target.value)} className="w-full bg-white px-2 py-2 outline-none"><option value="">Not examined</option><option>Normal</option><option>Abnormal</option></select></td>, <td key={`${eye}-finding`} className="border border-black p-0"><input aria-label={`${eye} ${structure} finding`} value={String(get(data, ["examination", "eyes", eye, structure, "finding"]))} onChange={(event) => change(["examination", "eyes", eye, structure, "finding"], event.target.value)} className="w-full min-w-48 px-3 py-2 outline-none" /></td>])}</tr>)}</tbody></table></div>;
}

type OcularDrawingTarget = { segment: "anterior" | "posterior"; eye: "right" | "left" };

function OcularDrawingSection({ segment, data, onOpen }: { segment: OcularDrawingTarget["segment"]; data: Data; onOpen: (target: OcularDrawingTarget) => void }) {
  return <section className="space-y-3"><h4 className="text-center text-sm font-bold uppercase tracking-[0.08em] text-slate-700">{segment === "anterior" ? "Anterior Segment Drawings" : "Posterior Segment Drawings"}</h4><div className="grid gap-4 md:grid-cols-2">{EYES.map(([eye, label]) => { const drawing = String(get(data, ["examination", "drawings", segment, eye])); return <div key={eye} className="border border-black bg-slate-50 p-3"><div className="mb-3 flex items-center justify-between gap-3"><span className="text-sm font-semibold text-black">{label}</span><button type="button" onClick={() => onOpen({ segment, eye })} className="border border-slate-900 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-100">{drawing ? "Edit drawing" : "Open drawing"}</button></div>{drawing ? <div role="img" aria-label={`${label} ${segment} segment drawing`} className="aspect-[21/10] w-full border border-slate-300 bg-white bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url("${drawing}")` }} /> : <div className="flex aspect-[21/10] items-center justify-center border border-dashed border-slate-300 bg-white text-sm text-slate-400">Blank canvas</div>}</div>; })}</div></section>;
}

function OcularExamination({ data, change }: { data: Data; change: Setter }) {
  const [activeDrawing, setActiveDrawing] = useState<OcularDrawingTarget | null>(null);
  const markAllNormal = () => EYES.forEach(([eye]) => EXAM_STRUCTURES.forEach((structure) => change(["examination", "eyes", eye, structure, "status"], "Normal")));
  const drawingValue = activeDrawing ? String(get(data, ["examination", "drawings", activeDrawing.segment, activeDrawing.eye])) : "";
  return <Page title="Ocular Examination"><div className="flex justify-end"><button type="button" onClick={markAllNormal} className="border border-slate-900 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100">Mark all structures normal</button></div><OcularStructureTable title="Anterior Segment Evaluation" structures={ANTERIOR_STRUCTURES} data={data} change={change} /><OcularDrawingSection segment="anterior" data={data} onOpen={setActiveDrawing} /><OcularStructureTable title="Posterior Segment Evaluation" structures={POSTERIOR_STRUCTURES} data={data} change={change} /><OcularDrawingSection segment="posterior" data={data} onOpen={setActiveDrawing} /><Field label="Examination comments" path={["examination", "comments"]} data={data} change={change} multiline /><ClinicalDrawingModal open={Boolean(activeDrawing)} title={activeDrawing ? `${activeDrawing.segment === "anterior" ? "Anterior" : "Posterior"} segment · ${activeDrawing.eye === "right" ? "Right eye / OD" : "Left eye / OS"}` : "Ocular drawing"} value={drawingValue || null} canvasWidth={1050} canvasHeight={500} outputType="image/webp" onClose={() => setActiveDrawing(null)} onSave={(dataUrl) => { if (activeDrawing) change(["examination", "drawings", activeDrawing.segment, activeDrawing.eye], dataUrl ?? ""); setActiveDrawing(null); }} /></Page>;
}

export function EyeExamModal({ open, value, onClose, onSave, onDraftChange, onContinue, inline = false, sidebar, activePage, onActivePageChange }: Props) {
  const [draft, setDraft] = useState(value);
  const [internalPage, setInternalPage] = useState(0);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const examTopRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const lastEmittedDraftRef = useRef(JSON.stringify(value));
  const hasUnsavedChangesRef = useRef(false);
  const page = Math.min(PAGES.length - 1, Math.max(0, activePage ?? internalPage));
  const selectPage = (nextPage: number) => {
    setInternalPage(nextPage);
    onActivePageChange?.(nextPage);
  };
  useEffect(() => {
    const incoming = JSON.stringify(value);
    const isOpening = open && !wasOpenRef.current;
    if (open && (isOpening || incoming !== lastEmittedDraftRef.current)) {
      setDraft(value);
      lastEmittedDraftRef.current = incoming;
      hasUnsavedChangesRef.current = false;
      setError("");
      setSaveMessage("");
    }
    wasOpenRef.current = open;
  }, [open, value]);
  const change: Setter = (path, nextValue) => {
    setError("");
    setSaveMessage("");
    const next = { ...draft, version: 2 as const, case_sheet: set(draft.case_sheet, path, nextValue) };
    setDraft(next);
    lastEmittedDraftRef.current = JSON.stringify(next);
    hasUnsavedChangesRef.current = true;
    onDraftChange?.(next);
  };
  const data = draft.case_sheet;
  const movePage = (offset: number) => {
    selectPage(Math.min(PAGES.length - 1, Math.max(0, page + offset)));
    examTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const saveExam = async () => {
    if (!hasEyeExamData(draft)) {
      setError("Enter at least one eye exam finding before saving.");
      return false;
    }
    setIsSaving(true);
    setError("");
    try {
      await onSave(draft);
      hasUnsavedChangesRef.current = false;
      setSaveMessage("Eye exam saved.");
      return true;
    } finally {
      setIsSaving(false);
    }
  };
  const continueToConsultation = async () => {
    if (!onContinue) return;
    setIsSaving(true);
    setError("");
    try {
      if (hasEyeExamData(draft) && hasUnsavedChangesRef.current) {
        await onSave(draft);
        hasUnsavedChangesRef.current = false;
      }
      await onContinue(draft);
    } finally {
      setIsSaving(false);
    }
  };
  const footer = (
    <OptometryActionFooter inline={inline} pageLabel={`Page ${page + 1} of ${PAGES.length}`}>
      {!inline && !onContinue ? <button type="button" disabled={isSaving} onClick={onClose} className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb] disabled:opacity-60">
        Cancel
      </button> : null}
      <button type="button" disabled={page === 0 || isSaving} onClick={() => movePage(-1)} className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb] disabled:cursor-not-allowed disabled:opacity-40">
        Back
      </button>
      <button type="button" disabled={page === PAGES.length - 1 || isSaving} onClick={() => movePage(1)} className="rounded-xl bg-slate-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-40">
        Next
      </button>
      <button type="button" disabled={isSaving} onClick={async () => { if (await saveExam()) { if (!onContinue) onClose(); } }} className="rounded-xl border border-slate-900 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 disabled:opacity-60">
        {isSaving ? "Saving..." : "Save"}
      </button>
      {onContinue ? <button type="button" disabled={isSaving} onClick={continueToConsultation} className="rounded-xl bg-[#2f8fd3] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#287fc0] disabled:opacity-60">
        {isSaving ? "Saving..." : "Continue Consultation"}
      </button> : null}
    </OptometryActionFooter>
  );

  return <OptometryModalShell open={open} title="Eye Exam" description="Complete optometrist refraction and ocular examination case sheet." saveLabel="Save" onClose={onClose} onSave={async () => { await saveExam(); }} isSaving={isSaving} footer={footer} inline={inline} sidebar={sidebar}>
    <div ref={examTopRef} />
    <nav className="flex w-full overflow-x-auto border-y border-slate-300" aria-label="Eye exam case-sheet pages">{PAGES.map((label, index) => <button key={label} type="button" onClick={() => selectPage(index)} className={`relative h-11 min-w-[160px] flex-1 whitespace-nowrap px-3 py-2 text-xs font-semibold leading-none ${page === index ? "z-10 bg-[#376f9f] text-white" : "bg-slate-50 text-slate-600"}`} style={{ clipPath: index === PAGES.length - 1 ? undefined : "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)", marginLeft: index ? -8 : 0 }}><span className="mr-1 text-[9px] opacity-70">PAGE {index + 1}</span> {label}</button>)}</nav>
    {page === 0 ? <VisualAcuity data={data} change={change} /> : null}
    {page === 1 ? <Refraction data={data} change={change} /> : null}
    {page === 2 ? <GlassesPrescriptions data={data} change={change} /> : null}
    {page === 3 ? <PmtKeratometry data={data} change={change} /> : null}
    {page === 4 ? <IntraocularPressure data={data} change={change} /> : null}
    {page === 5 ? <OcularExamination data={data} change={change} /> : null}
    {page === 6 ? <AdditionalTests data={data} change={change} /> : null}
    {error ? <p className="text-sm font-semibold text-rose-600" role="alert">{error}</p> : null}
    {saveMessage ? <p className="text-sm font-semibold text-emerald-700" role="status">{saveMessage}</p> : null}
  </OptometryModalShell>;
}
