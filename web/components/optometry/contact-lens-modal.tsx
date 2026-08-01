"use client";

import { useEffect, useState, type ReactNode } from "react";

import type { ContactLensEyeEntry, ContactLensPayload } from "@/lib/types";
import { OptometryModalShell } from "@/components/optometry/optometry-modal-shell";

type SheetType = ContactLensPayload["case_sheet_type"];
type SheetData = Record<string, unknown>;
type Path = string[];

type ContactLensModalProps = {
  open: boolean;
  value: ContactLensPayload;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  onChange: (patch: Partial<ContactLensPayload>) => void;
  onEyeChange: (eye: "right" | "left", patch: Partial<ContactLensEyeEntry>) => void;
  inline?: boolean;
  sidebar?: ReactNode;
};

const SHEETS: Array<{ key: SheetType; label: string; pages: string[] }> = [
  { key: "general", label: "General CL", pages: ["Initial work-up", "Clinical assessment", "Tolerance trials", "Dispensing", "Follow-up"] },
  { key: "soft", label: "Soft CL", pages: ["History & evaluation", "Measurements & fitting", "Final assessment"] },
  { key: "rgp", label: "RGP", pages: ["Work-up", "Fitting & final lens"] },
  { key: "scleral", label: "Scleral / Mini-scleral", pages: ["Trial parameters", "Fitting & final lens"] },
];

function getAtPath(data: SheetData, path: Path): unknown {
  let current: unknown = data;
  for (const part of path) {
    if (!current || typeof current !== "object") return "";
    current = (current as SheetData)[part];
  }
  return current ?? "";
}

function setAtPath(data: SheetData, path: Path, nextValue: unknown): SheetData {
  const next = { ...data };
  let current = next;
  path.slice(0, -1).forEach((part) => {
    const child = current[part];
    current[part] = child && typeof child === "object" && !Array.isArray(child) ? { ...(child as SheetData) } : {};
    current = current[part] as SheetData;
  });
  current[path[path.length - 1]] = nextValue;
  return next;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="border border-black bg-slate-100 px-3 py-2 text-center text-sm font-bold uppercase tracking-[0.08em] text-black">{children}</h4>;
}

function SheetPage({ title, children }: { title: string; children: ReactNode }) {
  return <div className="mx-auto max-w-5xl bg-white text-slate-950"><h3 className="mb-5 text-center text-lg font-bold uppercase underline decoration-1 underline-offset-4">{title}</h3><div className="space-y-5">{children}</div></div>;
}

function LineField({ label, path, data, setValue, multiline = false, placeholder = "" }: { label: string; path: Path; data: SheetData; setValue: (path: Path, value: unknown) => void; multiline?: boolean; placeholder?: string }) {
  const value = String(getAtPath(data, path));
  return <label className="grid border border-black sm:grid-cols-[240px_minmax(0,1fr)]"><span className="border-b border-black bg-slate-50 px-3 py-2 text-sm font-semibold sm:border-b-0 sm:border-r">{label}</span>{multiline ? <textarea rows={3} value={value} onChange={(event) => setValue(path, event.target.value)} placeholder={placeholder} className="resize-y bg-white px-3 py-2 text-sm outline-none" /> : <input value={value} onChange={(event) => setValue(path, event.target.value)} placeholder={placeholder} className="min-w-0 bg-white px-3 py-2 text-sm outline-none" />}</label>;
}

function ChoiceField({ label, path, options, data, setValue }: { label: string; path: Path; options: string[]; data: SheetData; setValue: (path: Path, value: unknown) => void }) {
  const value = String(getAtPath(data, path));
  return <div className="grid border border-black sm:grid-cols-[240px_minmax(0,1fr)]"><span className="border-b border-black bg-slate-50 px-3 py-2 text-sm font-semibold sm:border-b-0 sm:border-r">{label}</span><div className="flex flex-wrap gap-2 p-2">{options.map((option) => <button key={option} type="button" onClick={() => setValue(path, option)} className={`border px-3 py-1.5 text-sm font-medium ${value === option ? "border-slate-900 bg-slate-900 text-white" : "border-slate-400 bg-white text-slate-700"}`}>{option}</button>)}</div></div>;
}

function CheckField({ label, path, data, setValue }: { label: string; path: Path; data: SheetData; setValue: (path: Path, value: unknown) => void }) {
  return <label className="flex items-center gap-3 border border-black px-3 py-2 text-sm font-semibold"><input type="checkbox" checked={getAtPath(data, path) === true} onChange={(event) => setValue(path, event.target.checked)} className="h-4 w-4" />{label}</label>;
}

function PairTable({ title, rows, base, data, setValue }: { title: string; rows: Array<[string, string]>; base: Path; data: SheetData; setValue: (path: Path, value: unknown) => void }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[620px] border-collapse text-sm"><thead><tr><th colSpan={3} className="border border-black bg-slate-100 px-3 py-2 text-center font-bold uppercase">{title}</th></tr><tr><th className="w-48 border border-black bg-slate-50 px-3 py-2 text-left">Parameter</th><th className="border border-black px-3 py-2">OD</th><th className="border border-black px-3 py-2">OS</th></tr></thead><tbody>{rows.map(([label, key]) => <tr key={key}><th className="border border-black bg-slate-50 px-3 py-2 text-left font-semibold">{label}</th>{["od", "os"].map((eye) => <td key={eye} className="border border-black p-0"><input value={String(getAtPath(data, [...base, key, eye]))} onChange={(event) => setValue([...base, key, eye], event.target.value)} className="w-full bg-white px-3 py-2 outline-none" /></td>)}</tr>)}</tbody></table></div>;
}

function EyeTable({ title, columns, base, data, setValue }: { title: string; columns: Array<[string, string]>; base: Path; data: SheetData; setValue: (path: Path, value: unknown) => void }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[720px] border-collapse text-sm"><thead><tr><th colSpan={columns.length + 1} className="border border-black bg-slate-100 px-3 py-2 text-center font-bold uppercase">{title}</th></tr><tr><th className="border border-black bg-slate-50 px-3 py-2 text-left">Eye</th>{columns.map(([label]) => <th key={label} className="border border-black bg-slate-50 px-3 py-2">{label}</th>)}</tr></thead><tbody>{[["od", "OD"], ["os", "OS"]].map(([eye, eyeLabel]) => <tr key={eye}><th className="border border-black bg-slate-50 px-3 py-2 text-left">{eyeLabel}</th>{columns.map(([label, key]) => <td key={key} className="border border-black p-0"><input value={String(getAtPath(data, [...base, eye, key]))} onChange={(event) => setValue([...base, eye, key], event.target.value)} aria-label={`${eyeLabel} ${label}`} className="w-full min-w-24 bg-white px-3 py-2 outline-none" /></td>)}</tr>)}</tbody></table></div>;
}

function GeneralSheet({ page, data, setValue }: SheetProps) {
  if (page === 0) return <SheetPage title="Contact Lens Initial Work-up">
    <div className="grid gap-3 md:grid-cols-2"><LineField label="Skin" path={["initial", "skin"]} data={data} setValue={setValue} /><LineField label="Lids" path={["initial", "lids"]} data={data} setValue={setValue} /></div>
    <div className="grid gap-5 xl:grid-cols-2"><PairTable title="Visual Acuity" base={["initial", "visual_acuity"]} rows={[["UCVA", "ucva"], ["VA with pinhole", "pinhole"], ["VA with current Rx", "current_rx"]]} data={data} setValue={setValue} /><PairTable title="Ocular Measurements" base={["initial", "measurements"]} rows={[["IPD (B/O)", "ipd"], ["HVID - ruler / AR", "hvid"], ["Pupil diameter", "pupil_diameter"], ["Normal illumination", "normal_illumination"], ["Low illumination", "low_illumination"]]} data={data} setValue={setValue} /></div>
    <ChoiceField label="Objective refraction method" path={["initial", "objective_method"]} options={["Retinoscopy", "AR", "Both"]} data={data} setValue={setValue} />
    <EyeTable title="Objective Refraction" base={["initial", "objective_refraction"]} columns={[["Spherical (DS)", "sphere"], ["Cylinder (DC)", "cylinder"], ["Axis", "axis"]]} data={data} setValue={setValue} />
    <EyeTable title="Current Prescription" base={["initial", "current_prescription"]} columns={[["Spherical (DS)", "sphere"], ["Cylinder (DC)", "cylinder"], ["Axis", "axis"], ["V/A", "va"]]} data={data} setValue={setValue} />
    <EyeTable title="Subjective Refraction" base={["initial", "subjective_refraction"]} columns={[["Spherical (DS)", "sphere"], ["Cylinder (DC)", "cylinder"], ["Axis", "axis"], ["V/A", "va"], ["Prisms", "prisms"]]} data={data} setValue={setValue} />
  </SheetPage>;
  if (page === 1) return <SheetPage title="Clinical Assessment">
    <PairTable title="Slit Lamp Examination" base={["assessment", "slit_lamp"]} rows={[["Lids", "lids"], ["Conjunctiva", "conjunctiva"], ["Sclera", "sclera"], ["Cornea", "cornea"], ["Limbus", "limbus"]]} data={data} setValue={setValue} />
    <LineField label="Slit-lamp comments" path={["assessment", "slit_lamp_comments"]} data={data} setValue={setValue} multiline />
    <PairTable title="Tear Film Assessment" base={["assessment", "tear_film"]} rows={[["Qualitative", "qualitative"], ["Quantitative", "quantitative"]]} data={data} setValue={setValue} />
    <div className="grid gap-3 md:grid-cols-2"><LineField label="Topographer name" path={["assessment", "topographer"]} data={data} setValue={setValue} /><LineField label="Date of examination" path={["assessment", "topography_date"]} data={data} setValue={setValue} /></div>
    <PairTable title="Corneal Topography and Pachymetry" base={["assessment", "cornea"]} rows={[["K1 (mm)", "k1"], ["K2 (mm)", "k2"], ["Average K", "avg_k"], ["Pachymetry apex", "pachy_apex"], ["Thinnest location - X", "thinnest_x"], ["Thinnest location - Y", "thinnest_y"], ["Corneal shape", "shape"], ["Posterior ectasia - present/absent", "posterior_ectasia"], ["Highest point location", "highest_point"]]} data={data} setValue={setValue} />
    <PairTable title="Current Contact Lens" base={["assessment", "current_cl"]} rows={[["Prescription and brand", "prescription_brand"], ["Contact lens examination", "examination"]]} data={data} setValue={setValue} />
  </SheetPage>;
  if (page === 2) return <SheetPage title="Tolerance Trials and Final Parameters">
    {[1, 2, 3].map((trial) => <div key={trial} className="space-y-3"><SectionTitle>Tolerance Trial {trial}</SectionTitle><div className="grid gap-3 md:grid-cols-2"><LineField label="Lens design" path={["trials", String(trial), "lens_design"]} data={data} setValue={setValue} /><LineField label="Date" path={["trials", String(trial), "date"]} data={data} setValue={setValue} /></div><EyeTable title={`Trial ${trial} Lens Parameters`} base={["trials", String(trial), "eyes"]} columns={[["Trial lens parameters", "parameters"], ["C", "c"], ["E", "e"], ["D", "d"], ["Location", "location"], ["Movement", "movement"], ["Over-refraction", "over_refraction"], ["V/A", "va"]]} data={data} setValue={setValue} /></div>)}
    <LineField label="Date ordered" path={["final", "date_ordered"]} data={data} setValue={setValue} />
    <EyeTable title="Final Contact Lens Parameters" base={["final", "eyes"]} columns={[["Lens design", "design"], ["BC", "bc"], ["DIA", "diameter"], ["Power", "power"], ["EL", "edge_lift"], ["ACT", "act"], ["TP", "tp"], ["Tint", "tint"], ["Material", "material"]]} data={data} setValue={setValue} />
  </SheetPage>;
  if (page === 3) return <SheetPage title="Contact Lens Dispensing">
    <PairTable title="Slit-lamp Examination Before Insertion" base={["dispensing", "slit_lamp"]} rows={[["Lids", "lids"], ["Conjunctiva", "conjunctiva"], ["Sclera", "sclera"], ["Cornea", "cornea"], ["Tears (BUT)", "tears_but"]]} data={data} setValue={setValue} />
    <div className="grid gap-3 md:grid-cols-2"><CheckField label="Taught patient to wash hands" path={["dispensing", "hand_washing"]} data={data} setValue={setValue} /><CheckField label="Practitioner inserted lens after rinsing with MPS / saline" path={["dispensing", "practitioner_insertion"]} data={data} setValue={setValue} /></div>
    <PairTable title="Vision with CL After 5 Minutes" base={["dispensing", "vision"]} rows={[["V/A", "va"]]} data={data} setValue={setValue} />
    <EyeTable title="Fitting / Axis Orientation" base={["dispensing", "fitting"]} columns={[["Lens parameters / design", "parameters"], ["C", "c"], ["E", "e"], ["D", "d"], ["Location", "location"], ["Movement", "movement"], ["Over-refraction", "over_refraction"], ["V/A", "va"]]} data={data} setValue={setValue} />
    <div className="grid gap-3 md:grid-cols-2"><CheckField label="Insertion and removal taught - right eye (3 times)" path={["dispensing", "training_od"]} data={data} setValue={setValue} /><CheckField label="Insertion and removal taught - left eye (3 times)" path={["dispensing", "training_os"]} data={data} setValue={setValue} /></div>
    <ChoiceField label="Patient confidence" path={["dispensing", "confidence"]} options={["Satisfactory", "Unsatisfactory - recall"]} data={data} setValue={setValue} />
    <CheckField label="Solution starter pack and instruction leaflet supplied" path={["dispensing", "starter_pack"]} data={data} setValue={setValue} /><CheckField label="Patient instructions booklet supplied" path={["dispensing", "booklet"]} data={data} setValue={setValue} /><LineField label="Follow-up visit date" path={["dispensing", "follow_up_date"]} data={data} setValue={setValue} />
  </SheetPage>;
  return <SheetPage title="Contact Lens Follow-up">
    <div className="grid gap-3 md:grid-cols-2"><LineField label="Visual problem" path={["follow_up", "visual_problem"]} data={data} setValue={setValue} /><LineField label="Comfort problem" path={["follow_up", "comfort_problem"]} data={data} setValue={setValue} /><LineField label="Wearing hours" path={["follow_up", "wearing_hours"]} data={data} setValue={setValue} /><LineField label="Solution irritation" path={["follow_up", "solution_irritation"]} data={data} setValue={setValue} /><LineField label="Burning" path={["follow_up", "burning"]} data={data} setValue={setValue} /><LineField label="Stinging" path={["follow_up", "stinging"]} data={data} setValue={setValue} /><LineField label="Redness" path={["follow_up", "redness"]} data={data} setValue={setValue} /></div>
    <PairTable title="V/A with Contact Lens" base={["follow_up", "vision"]} rows={[["V/A", "va"]]} data={data} setValue={setValue} />
    <EyeTable title="Lens Fitting" base={["follow_up", "fitting"]} columns={[["Lens parameters", "parameters"], ["C", "c"], ["E", "e"], ["D", "d"], ["Location", "location"], ["Movement", "movement"], ["Over-refraction", "over_refraction"], ["V/A", "va"]]} data={data} setValue={setValue} />
    <PairTable title="Slit-lamp Examination" base={["follow_up", "slit_lamp"]} rows={[["Lids", "lids"], ["Conjunctiva", "conjunctiva"], ["Sclera", "sclera"], ["Cornea", "cornea"], ["Tears (BUT)", "tears_but"]]} data={data} setValue={setValue} />
    <LineField label="Review of lens care and insertion / removal" path={["follow_up", "care_review"]} data={data} setValue={setValue} multiline /><LineField label="Next appointment date" path={["follow_up", "next_appointment"]} data={data} setValue={setValue} />
  </SheetPage>;
}

type SheetProps = { page: number; data: SheetData; setValue: (path: Path, value: unknown) => void };

function SoftSheet({ page, data, setValue }: SheetProps) {
  if (page === 0) return <SheetPage title="Soft Contact Lens Work-up"><SectionTitle>History</SectionTitle><ChoiceField label="Reason for wanting CL" path={["history", "reason"]} options={["Vision improvement", "Cosmetic", "Vision therapy", "Other"]} data={data} setValue={setValue} /><LineField label="Specify other reason" path={["history", "other_reason"]} data={data} setValue={setValue} /><ChoiceField label="Pros and cons explained" path={["history", "pros_cons"]} options={["Yes", "No"]} data={data} setValue={setValue} /><LineField label="Patient's profession" path={["history", "profession"]} data={data} setValue={setValue} /><LineField label="Patient's CL usage requirements" path={["history", "requirements"]} data={data} setValue={setValue} multiline /><ChoiceField label="Suitable CL type" path={["history", "suitable_type"]} options={["Soft spherical", "Toric"]} data={data} setValue={setValue} /><LineField label="CL brand options" path={["history", "brand_options"]} data={data} setValue={setValue} /><LineField label="Patient's brand preference" path={["history", "brand_preference"]} data={data} setValue={setValue} /><ChoiceField label="Previous CL usage" path={["history", "previous_usage"]} options={["Yes", "No"]} data={data} setValue={setValue} /><ChoiceField label="Previous CL type" path={["history", "previous_type"]} options={["Soft", "Toric", "RGP", "Rose K"]} data={data} setValue={setValue} /><LineField label="Previous brand / company" path={["history", "previous_brand"]} data={data} setValue={setValue} /><ChoiceField label="Replacement schedule" path={["history", "replacement"]} options={["Yearly", "Bi-weekly", "Monthly", "Daily"]} data={data} setValue={setValue} /><ChoiceField label="Continue same brand" path={["history", "continue_brand"]} options={["Yes", "No - wants a better or different brand"]} data={data} setValue={setValue} /><LineField label="Comments" path={["history", "comments"]} data={data} setValue={setValue} multiline /><PairTable title="Slit Lamp Evaluation" base={["evaluation", "slit_lamp"]} rows={[["Findings", "findings"]]} data={data} setValue={setValue} /></SheetPage>;
  if (page === 1) return <SheetPage title="Soft CL Measurements and Fitting"><PairTable title="Keratometry / Topography" base={["measurements", "keratometry"]} rows={[["K1", "k1"], ["K2", "k2"], ["K (Avg)", "avg_k"]]} data={data} setValue={setValue} /><EyeTable title="Tear and Corneal Measurements" base={["measurements", "eyes"]} columns={[["Schirmer's test (mm / 5 minutes)", "schirmer"], ["TBUT (seconds)", "tbut"], ["Tear prism height (mm)", "tear_prism"], ["HVID (mm)", "hvid"]]} data={data} setValue={setValue} /><TrialRows kind="soft" data={data} setValue={setValue} /><PairTable title="Fitting Assessment" base={["fitting"]} rows={[["Centration - horizontal (x)", "centration_x"], ["Centration - vertical (y)", "centration_y"], ["Stability", "stability"], ["Coverage", "coverage"], ["Movement with blink", "movement_blink"], ["Movement type", "movement_type"], ["Push-up test", "push_up"], ["Speed of movement", "speed"]]} data={data} setValue={setValue} /></SheetPage>;
  return <SheetPage title="Soft CL Final Assessment"><PairTable title="Axis Rotation" base={["final_assessment", "axis_rotation"]} rows={[["Rotation", "rotation"]]} data={data} setValue={setValue} /><ChoiceField label="Patient comfort rating" path={["final_assessment", "comfort_rating"]} options={["Tolerable", "Comfortable", "Not comfortable"]} data={data} setValue={setValue} /><LineField label="Impression" path={["final_assessment", "impression"]} data={data} setValue={setValue} multiline /><LineField label="Comments" path={["final_assessment", "comments"]} data={data} setValue={setValue} multiline /><EyeTable title="Over-refraction" base={["final_assessment", "over_refraction"]} columns={[["Over-refraction", "value"], ["BCVA", "bcva"], ["Remarks", "remarks"]]} data={data} setValue={setValue} /><EyeTable title="Final Lens Parameters" base={["final_assessment", "final_lens"]} columns={[["BC", "bc"], ["Power", "power"], ["Diameter", "diameter"], ["Lens name", "lens_name"], ["Company", "company"], ["Wearing modality", "wearing_modality"]]} data={data} setValue={setValue} /><LineField label="Advice and management" path={["final_assessment", "advice"]} data={data} setValue={setValue} multiline /></SheetPage>;
}

function TrialRows({ kind, data, setValue }: { kind: "soft" | "rgp"; data: SheetData; setValue: (path: Path, value: unknown) => void }) {
  return <>{[1, 2].map((trial) => <EyeTable key={trial} title={`Trial ${trial} Contact Lens Parameters`} base={["trials", String(trial)]} columns={[["BC", "bc"], ["Power", "power"], ["Diameter", "diameter"], ...(kind === "soft" ? [["Brand", "brand"] as [string, string]] : [])]} data={data} setValue={setValue} />)}</>;
}

function RgpSheet({ page, data, setValue }: SheetProps) {
  if (page === 0) return <SheetPage title="RGP Work-up"><SectionTitle>History</SectionTitle><ChoiceField label="Reason for wanting RGP" path={["history", "reason"]} options={["Vision improvement", "Cosmetic", "Vision therapy", "Other"]} data={data} setValue={setValue} /><LineField label="Specify other reason" path={["history", "other_reason"]} data={data} setValue={setValue} /><ChoiceField label="Pros and cons explained" path={["history", "pros_cons"]} options={["Yes", "No"]} data={data} setValue={setValue} /><LineField label="Patient's profession" path={["history", "profession"]} data={data} setValue={setValue} /><LineField label="Patient's usage requirements" path={["history", "requirements"]} data={data} setValue={setValue} /><LineField label="RGP brand options" path={["history", "brand_options"]} data={data} setValue={setValue} /><ChoiceField label="Previous CL usage" path={["history", "previous_usage"]} options={["Yes", "No"]} data={data} setValue={setValue} /><LineField label="Previous type" path={["history", "previous_type"]} data={data} setValue={setValue} /><LineField label="Previous brand" path={["history", "previous_brand"]} data={data} setValue={setValue} /><LineField label="Replacement schedule" path={["history", "replacement"]} data={data} setValue={setValue} /><ChoiceField label="Continue same brand" path={["history", "continue_brand"]} options={["Yes", "No - wants different brand"]} data={data} setValue={setValue} /><LineField label="Comments" path={["history", "comments"]} data={data} setValue={setValue} multiline /><PairTable title="Corneal Measurements" base={["measurements"]} rows={[["BGC", "bgc"], ["Average K", "avg_k"]]} data={data} setValue={setValue} /><PairTable title="Slit Lamp Evaluation" base={["slit_lamp"]} rows={[["Lids", "lids"], ["Conjunctiva", "conjunctiva"], ["Sclera", "sclera"], ["Cornea", "cornea"], ["Limbus", "limbus"]]} data={data} setValue={setValue} /><PairTable title="Tear Film Assessment" base={["tear_film"]} rows={[["Qualitative", "qualitative"], ["Quantitative", "quantitative"]]} data={data} setValue={setValue} /><TrialRows kind="rgp" data={data} setValue={setValue} /></SheetPage>;
  return <SheetPage title="RGP Fitting and Final Lens"><PairTable title="Fitting Assessment" base={["fitting"]} rows={[["Centration - horizontal (x), mm", "centration_x"], ["Centration - vertical (y), mm", "centration_y"], ["Stability", "stability"], ["Coverage", "coverage"], ["Movement with blink, mm", "movement_blink"], ["Movement type - smooth / jerky / apical rotation", "movement_type"], ["Speed - fast / average / slow", "speed"]]} data={data} setValue={setValue} /><PairTable title="Fluorescein Pattern" base={["fitting", "fluorescein"]} rows={[["Pattern / drawing notes", "pattern"]]} data={data} setValue={setValue} /><PairTable title="Lens Assessment" base={["assessment"]} rows={[["Impression", "impression"], ["Comments", "comments"], ["Comfort", "comfort"]]} data={data} setValue={setValue} /><EyeTable title="Over-refraction" base={["over_refraction"]} columns={[["Over-refraction", "value"], ["Acceptance", "acceptance"], ["Vision", "vision"]]} data={data} setValue={setValue} /><EyeTable title="Final Lens Parameters" base={["final_lens"]} columns={[["BC", "bc"], ["Power", "power"], ["Diameter", "diameter"]]} data={data} setValue={setValue} /><LineField label="Recommended hours of CL usage" path={["management", "recommended_hours"]} data={data} setValue={setValue} /><LineField label="Solution to be used" path={["management", "solution"]} data={data} setValue={setValue} /><LineField label="Comments" path={["management", "comments"]} data={data} setValue={setValue} multiline /></SheetPage>;
}

function ScleralSheet({ page, data, setValue }: SheetProps) {
  if (page === 0) return <SheetPage title="Scleral / Mini-scleral Trial"><LineField label="Ocular history" path={["workup", "ocular_history"]} data={data} setValue={setValue} multiline /><PairTable title="Refractive Power and Vision" base={["workup", "refraction"]} rows={[["Refraction / vision", "value"]]} data={data} setValue={setValue} /><PairTable title="Topography" base={["workup", "topography"]} rows={[["Average K", "avg_k"]]} data={data} setValue={setValue} /><PairTable title="Diagnosis" base={["workup", "diagnosis"]} rows={[["Diagnosis", "value"]]} data={data} setValue={setValue} /><LineField label="Brand name" path={["trial", "brand"]} data={data} setValue={setValue} /><PairTable title="CSL / Rose K XL / Mini-scleral / Scleral Trial Parameters" base={["trial", "parameters"]} rows={[["Landing zone", "landing_zone"], ["Base curve", "base_curve"], ["Power", "power"], ["Sagittal value", "sagittal_value"], ["Lens diameter", "diameter"], ["Over-refraction", "over_refraction"], ["Vision", "vision"]]} data={data} setValue={setValue} /></SheetPage>;
  return <SheetPage title="Scleral Fitting and Final Parameters"><PairTable title="Fitting Assessment" base={["fitting"]} rows={[["Centration", "centration"], ["Movement", "movement"], ["Vault - central", "vault_central"], ["Vault - peripheral", "vault_peripheral"], ["360 degree landing", "landing_360"], ["Blanching", "blanching"], ["360 degree impingement", "impingement_360"], ["Impression", "impression"], ["Comments / changes required", "changes"]]} data={data} setValue={setValue} /><EyeTable title="Final Parameters" base={["final"]} columns={[["BC", "bc"], ["Diameter", "diameter"], ["Power", "power"], ["Sag value", "sag"], ["Edge lift / landing zone", "landing_zone"], ["Brand name", "brand"]]} data={data} setValue={setValue} /><LineField label="Advice and management" path={["advice"]} data={data} setValue={setValue} multiline /></SheetPage>;
}

export function ContactLensModal({ open, value, onClose, onSave, onChange, inline = false, sidebar }: ContactLensModalProps) {
  const [page, setPage] = useState(0);
  const activeConfig = SHEETS.find((sheet) => sheet.key === value.case_sheet_type) ?? SHEETS[0];
  const data = value.case_sheets[value.case_sheet_type] ?? {};
  useEffect(() => { setPage(0); }, [value.case_sheet_type]);
  useEffect(() => { if (open && !inline) setPage(0); }, [inline, open]);
  const setValue = (path: Path, nextValue: unknown) => onChange({ case_sheets: { ...value.case_sheets, [value.case_sheet_type]: setAtPath(data, path, nextValue) } });

  return <OptometryModalShell open={open} title="Contact Lens Case Sheets" description="Digital versions of the General, Soft, RGP and Scleral contact lens case sheets." saveLabel="Save Case Sheet" onClose={onClose} onSave={onSave} inline={inline} sidebar={sidebar}>
    <div className="flex flex-wrap gap-2 border-b border-slate-300 pb-4">{SHEETS.map((sheet) => <button key={sheet.key} type="button" onClick={() => onChange({ case_sheet_type: sheet.key })} className={`border px-4 py-2 text-sm font-semibold ${value.case_sheet_type === sheet.key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{sheet.label}</button>)}</div>
    <nav className="flex max-w-5xl overflow-x-auto border-y border-slate-300" aria-label={`${activeConfig.label} pages`}>{activeConfig.pages.map((label, index) => <button key={label} type="button" onClick={() => setPage(index)} className={`relative min-w-[150px] flex-1 px-5 py-3 text-sm font-semibold ${page === index ? "z-10 bg-[#376f9f] text-white" : "bg-slate-50 text-slate-600"}`} style={{ clipPath: index === activeConfig.pages.length - 1 ? undefined : "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)", marginLeft: index ? -8 : 0 }}><span className="mr-1 text-[10px] opacity-70">PAGE {index + 1}</span> {label}</button>)}</nav>
    {value.case_sheet_type === "general" ? <GeneralSheet page={page} data={data} setValue={setValue} /> : null}
    {value.case_sheet_type === "soft" ? <SoftSheet page={page} data={data} setValue={setValue} /> : null}
    {value.case_sheet_type === "rgp" ? <RgpSheet page={page} data={data} setValue={setValue} /> : null}
    {value.case_sheet_type === "scleral" ? <ScleralSheet page={page} data={data} setValue={setValue} /> : null}
  </OptometryModalShell>;
}
