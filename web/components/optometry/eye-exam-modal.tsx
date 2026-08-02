"use client";

import { useEffect, useState, type ReactNode } from "react";

import { OptometryModalShell } from "@/components/optometry/optometry-modal-shell";
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
  inline?: boolean;
  sidebar?: ReactNode;
};

const PAGES = ["Visual acuity", "IOP & refraction", "Glasses prescriptions", "Retinoscopy & keratometry", "Additional tests", "Ocular examination"];
const EYES = [["right", "Right eye / OD"], ["left", "Left eye / OS"]] as const;
const DISTANCE_ACUITY = ["PL-", "PL+", "FL", "HM", "CFCF", "FC", "1/60", "2/60", "3/60", "4/60", "5/60", "6/60", "6/36", "6/24", "6/18", "6/12", "6/9", "6/7.5", "6/6", "6/5"];
const NEAR_ACUITY = ["N4", "N5", "N6", "N8", "N10", "N12", "N14", "N18", "N24", "N36", "<N36"];
const CONTRAST_VALUES = ["2.25", "2.10", "1.95", "1.80", "1.65", "1.50", "1.35", "1.20", "1.05", "0.90", "0.75", "0.60"];
const EXAM_STRUCTURES = ["Appearance", "Injury", "Adnexa", "Conjunctiva", "Sclera", "Cornea", "Anterior chamber (AC)", "Pupil", "Iris", "Lens", "Intraocular pressure (IOP)", "Vitreous", "Choroid", "Fundus"];

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

function EyeTable({ title, columns, base, data, change }: { title: string; columns: Array<[string, string]>; base: Path; data: Data; change: Setter }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-sm"><thead><tr><th colSpan={columns.length + 1} className="border border-black bg-slate-100 px-3 py-2 uppercase text-black">{title}</th></tr><tr><th className="border border-black bg-slate-50 px-3 py-2 text-left text-black">Eye</th>{columns.map(([label]) => <th key={label} className="border border-black bg-slate-50 px-3 py-2 text-black">{label}</th>)}</tr></thead><tbody>{EYES.map(([eye, label]) => <tr key={eye}><th className="border border-black bg-slate-50 px-3 py-2 text-left text-black">{label}</th>{columns.map(([column, key]) => <td key={key} className="border border-black p-0"><input aria-label={`${label} ${column}`} value={String(get(data, [...base, eye, key]))} onChange={(event) => change([...base, eye, key], event.target.value)} className="w-full min-w-24 px-3 py-2 outline-none" /></td>)}</tr>)}</tbody></table></div>;
}

function VisualAcuity({ data, change }: { data: Data; change: Setter }) {
  const measurements = [["UCVA", "ucva"], ["Pinhole", "pinhole"], ["With glasses", "glasses"], ["With contact lens", "contact_lens"]] as const;
  return <Page title="Visual Acuity">{EYES.map(([eye, eyeLabel]) => <section key={eye} className="space-y-4"><Title>{eyeLabel}</Title>{measurements.map(([label, key]) => <div key={key} className="grid gap-3 xl:grid-cols-2"><AcuityValue label={`${label} distance`} path={["visual_acuity", eye, `${key}_distance`]} options={DISTANCE_ACUITY} data={data} change={change} /><AcuityValue label={`${label} near`} path={["visual_acuity", eye, `${key}_near`]} options={NEAR_ACUITY} data={data} change={change} /></div>)}<Field label={`${eyeLabel} comments`} path={["visual_acuity", eye, "comments"]} data={data} change={change} multiline /></section>)}<Field label="Refraction comments" path={["visual_acuity", "comments"]} data={data} change={change} multiline /></Page>;
}

const REFRACTION_COLUMNS: Array<[string, string]> = [["Sphere", "sphere"], ["Cylinder", "cylinder"], ["Axis", "axis"], ["Distance vision", "distance_vision"], ["Add", "add"], ["Near vision", "near_vision"]];

function IopRefraction({ data, change }: { data: Data; change: Setter }) {
  return <Page title="IOP and Refraction"><EyeTable title="Intraocular Pressure" columns={[["Value (mmHg)", "value"], ["Method", "method"], ["Time", "time"], ["Comments", "comments"]]} base={["iop"]} data={data} change={change} /><Title>Autorefraction</Title><div className="grid gap-4 xl:grid-cols-2"><EyeTable title="Dry autorefraction" columns={[["Sphere", "sphere"], ["Cylinder", "cylinder"], ["Axis", "axis"]]} base={["autorefraction", "dry"]} data={data} change={change} /><EyeTable title="Dilated autorefraction" columns={[["Sphere", "sphere"], ["Cylinder", "cylinder"], ["Axis", "axis"]]} base={["autorefraction", "dilated"]} data={data} change={change} /></div><p className="text-xs text-slate-500">Autorefractor values are entered manually until a supported machine export format is configured.</p><EyeTable title="Dry Refraction" columns={REFRACTION_COLUMNS} base={["refraction", "dry"]} data={data} change={change} /><div className="grid gap-3 md:grid-cols-2"><Field label="OD retinoscopy notation" path={["refraction", "dry", "right", "retinoscopy"]} data={data} change={change} /><Field label="OS retinoscopy notation" path={["refraction", "dry", "left", "retinoscopy"]} data={data} change={change} /></div><Field label="Dry refraction comments" path={["refraction", "dry", "comments"]} data={data} change={change} multiline /><EyeTable title="Dilated / Cycloplegic Refraction" columns={REFRACTION_COLUMNS} base={["refraction", "dilated"]} data={data} change={change} /><div className="grid gap-3 md:grid-cols-2"><Field label="Drug used" path={["refraction", "dilated", "drug_used"]} data={data} change={change} /><Field label="Dilated refraction comments" path={["refraction", "dilated", "comments"]} data={data} change={change} /></div></Page>;
}

const RX_COLUMNS: Array<[string, string]> = [["Sphere", "sphere"], ["Cylinder", "cylinder"], ["Axis", "axis"], ["Vision", "vision"], ["Add", "add"]];

function PrescriptionDetails({ name, path, data, change }: { name: string; path: string; data: Data; change: Setter }) {
  return <section className="space-y-3"><EyeTable title={name} columns={RX_COLUMNS} base={["prescriptions", path, "eyes"]} data={data} change={change} /><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><Field label="Type of lens" path={["prescriptions", path, "lens_type"]} data={data} change={change} /><Field label="Lens material" path={["prescriptions", path, "lens_material"]} data={data} change={change} /><Field label="Lens tint" path={["prescriptions", path, "lens_tint"]} data={data} change={change} /><Field label="IPD" path={["prescriptions", path, "ipd"]} data={data} change={change} /></div></section>;
}

function GlassesPrescriptions({ data, change }: { data: Data; change: Setter }) {
  return <Page title="Glasses Prescriptions"><PrescriptionDetails name="Present Glasses Prescription 1 (PGP 1)" path="pgp_1" data={data} change={change} /><PrescriptionDetails name="Present Glasses Prescription 2 (PGP 2)" path="pgp_2" data={data} change={change} /><PrescriptionDetails name="Distance Glasses Prescription" path="distance" data={data} change={change} /><PrescriptionDetails name="Near Glasses Prescription" path="near" data={data} change={change} /><PrescriptionDetails name="Intermediate Glasses Prescription" path="intermediate" data={data} change={change} /><Title>Dispensing Details</Title><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><Field label="Frame material" path={["prescriptions", "dispensing", "frame_material"]} data={data} change={change} /><Field label="Frame size" path={["prescriptions", "dispensing", "frame_size"]} data={data} change={change} /><Field label="Diameter" path={["prescriptions", "dispensing", "diameter"]} data={data} change={change} /><Field label="Prism" path={["prescriptions", "dispensing", "prism"]} data={data} change={change} /><Field label="Base" path={["prescriptions", "dispensing", "base"]} data={data} change={change} /><Field label="Fitting height" path={["prescriptions", "dispensing", "fitting_height"]} data={data} change={change} /></div><Field label="Advice" path={["prescriptions", "advice"]} data={data} change={change} multiline /></Page>;
}

function RetinoscopyKeratometry({ data, change }: { data: Data; change: Setter }) {
  return <Page title="Retinoscopy and Keratometry"><EyeTable title="Post-mydriatic Test (PMT)" columns={REFRACTION_COLUMNS} base={["pmt"]} data={data} change={change} /><EyeTable title="Retinoscopy" columns={[["Horizontal meridian", "horizontal"], ["Vertical meridian", "vertical"], ["VA", "va"], ["HA", "ha"], ["Working distance", "working_distance"], ["Drug used", "drug_used"]]} base={["retinoscopy"]} data={data} change={change} /><div className="grid gap-3 md:grid-cols-2"><Field label="OD retinoscopy comments" path={["retinoscopy", "right", "comments"]} data={data} change={change} multiline /><Field label="OS retinoscopy comments" path={["retinoscopy", "left", "comments"]} data={data} change={change} multiline /></div><EyeTable title="Keratometry" columns={[["K1", "k1"], ["K1 axis", "k1_axis"], ["K2", "k2"], ["K2 axis", "k2_axis"], ["Average K", "average_k"], ["K cylinder", "k_cylinder"]]} base={["keratometry"]} data={data} change={change} /><Field label="Keratometry comments" path={["keratometry", "comments"]} data={data} change={change} multiline /></Page>;
}

function AdditionalTests({ data, change }: { data: Data; change: Setter }) {
  return <Page title="Additional Tests"><div className="grid gap-4 xl:grid-cols-2">{EYES.map(([eye, label]) => <div key={eye} className="space-y-3"><Choice label={`${label} Amsler`} path={["amsler", eye, "status"]} options={["Normal", "Abnormal"]} data={data} change={change} /><Field label={`${label} Amsler comments`} path={["amsler", eye, "comments"]} data={data} change={change} /></div>)}</div><EyeTable title="Quick Contact Lens Measurements" columns={[["BC", "bc"], ["DIA", "dia"], ["SPH", "sphere"], ["CYL", "cylinder"], ["Axis", "axis"], ["ADD", "add"]]} base={["contact_lens"]} data={data} change={change} /><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><Field label="Contact lens type" path={["contact_lens", "type"]} data={data} change={change} /><Field label="Colour" path={["contact_lens", "colour"]} data={data} change={change} /><Field label="Revisit date" path={["contact_lens", "revisit_date"]} data={data} change={change} /><Field label="Advice" path={["contact_lens", "advice"]} data={data} change={change} /></div><div className="grid gap-4 xl:grid-cols-2">{EYES.map(([eye, label]) => <div key={eye} className="space-y-3"><Field label={`${label} colour vision`} path={["colour_vision", eye, "result"]} data={data} change={change} /><AcuityValue label={`${label} contrast`} path={["contrast_sensitivity", eye, "value"]} options={CONTRAST_VALUES} data={data} change={change} /><Field label={`${label} contrast comments`} path={["contrast_sensitivity", eye, "comments"]} data={data} change={change} /></div>)}</div><Field label="Orthoptic screening" path={["orthoptics", "screening"]} data={data} change={change} multiline /><Field label="Additional test comments" path={["additional_tests", "comments"]} data={data} change={change} multiline /></Page>;
}

function OcularExamination({ data, change }: { data: Data; change: Setter }) {
  const markAllNormal = () => EYES.forEach(([eye]) => EXAM_STRUCTURES.forEach((structure) => change(["examination", "eyes", eye, structure, "status"], "Normal")));
  return <Page title="Ocular Examination"><div className="grid gap-3 md:grid-cols-3"><Choice label="General examination" path={["examination", "general"]} options={["Normal", "Abnormal"]} data={data} change={change} /><Choice label="One eyed" path={["examination", "one_eyed"]} options={["Yes", "No"]} data={data} change={change} /><Choice label="Squint evaluation" path={["examination", "squint"]} options={["Yes", "No"]} data={data} change={change} /></div><div className="flex justify-end"><button type="button" onClick={markAllNormal} className="border border-slate-900 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100">Mark all structures normal</button></div><div className="overflow-x-auto"><table className="w-full min-w-[980px] border-collapse text-sm"><thead><tr><th className="border border-black bg-slate-100 px-3 py-2 text-left text-black">Structure</th>{EYES.map(([eye, label]) => <th key={eye} colSpan={2} className="border border-black bg-slate-100 px-3 py-2 text-black">{label}</th>)}</tr><tr><th className="border border-black bg-slate-50" />{EYES.flatMap(([eye]) => [<th key={`${eye}-status`} className="border border-black bg-slate-50 px-3 py-2 text-black">Status</th>, <th key={`${eye}-finding`} className="border border-black bg-slate-50 px-3 py-2 text-black">Finding / comments</th>])}</tr></thead><tbody>{EXAM_STRUCTURES.map((structure) => <tr key={structure}><th className="border border-black bg-slate-50 px-3 py-2 text-left text-black">{structure}</th>{EYES.flatMap(([eye]) => [<td key={`${eye}-status`} className="border border-black p-0"><select aria-label={`${eye} ${structure} status`} value={String(get(data, ["examination", "eyes", eye, structure, "status"]))} onChange={(event) => change(["examination", "eyes", eye, structure, "status"], event.target.value)} className="w-full bg-white px-2 py-2 outline-none"><option value="">Not examined</option><option>Normal</option><option>Abnormal</option></select></td>, <td key={`${eye}-finding`} className="border border-black p-0"><input aria-label={`${eye} ${structure} finding`} value={String(get(data, ["examination", "eyes", eye, structure, "finding"]))} onChange={(event) => change(["examination", "eyes", eye, structure, "finding"], event.target.value)} className="w-full min-w-48 px-3 py-2 outline-none" /></td>])}</tr>)}</tbody></table></div><Field label="Examination comments" path={["examination", "comments"]} data={data} change={change} multiline /></Page>;
}

export function EyeExamModal({ open, value, onClose, onSave, inline = false, sidebar }: Props) {
  const [draft, setDraft] = useState(value);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setDraft(value); setPage(0); setError(""); } }, [open, value]);
  const change: Setter = (path, nextValue) => { setError(""); setDraft((current) => ({ ...current, version: 2, case_sheet: set(current.case_sheet, path, nextValue) })); };
  const data = draft.case_sheet;

  return <OptometryModalShell open={open} title="Eye Exam" description="Complete optometrist refraction and ocular examination case sheet." saveLabel="Save Eye Exam" onClose={onClose} onSave={async () => { if (!hasEyeExamData(draft)) { setError("Enter at least one eye exam finding before saving."); return; } await onSave(draft); onClose(); }} inline={inline} sidebar={sidebar}>
    <nav className="flex w-full overflow-x-auto border-y border-slate-300" aria-label="Eye exam case-sheet pages">{PAGES.map((label, index) => <button key={label} type="button" onClick={() => setPage(index)} className={`relative min-w-[174px] flex-1 px-5 py-3 text-sm font-semibold ${page === index ? "z-10 bg-[#376f9f] text-white" : "bg-slate-50 text-slate-600"}`} style={{ clipPath: index === PAGES.length - 1 ? undefined : "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)", marginLeft: index ? -8 : 0 }}><span className="mr-1 text-[10px] opacity-70">PAGE {index + 1}</span> {label}</button>)}</nav>
    {page === 0 ? <VisualAcuity data={data} change={change} /> : null}
    {page === 1 ? <IopRefraction data={data} change={change} /> : null}
    {page === 2 ? <GlassesPrescriptions data={data} change={change} /> : null}
    {page === 3 ? <RetinoscopyKeratometry data={data} change={change} /> : null}
    {page === 4 ? <AdditionalTests data={data} change={change} /> : null}
    {page === 5 ? <OcularExamination data={data} change={change} /> : null}
    {error ? <p className="text-sm font-semibold text-rose-600" role="alert">{error}</p> : null}
  </OptometryModalShell>;
}
