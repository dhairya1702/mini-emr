"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";

import type {
  ContactLensEyeEntry,
  ContactLensFollowUp,
  ContactLensPayload,
  ContactLensTrial,
  ContactLensTrialEyeEntry,
  ContactLensWorkup,
} from "@/lib/types";
import { OptometryModalShell } from "@/components/optometry/optometry-modal-shell";

type PageKey = "workup" | "trial" | "final" | "dispensing" | "followup";

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

const PAGES: Array<{ key: PageKey; label: string }> = [
  { key: "workup", label: "Work-up" },
  { key: "trial", label: "Trial & Fit" },
  { key: "final", label: "Final Lens" },
  { key: "dispensing", label: "Dispensing" },
  { key: "followup", label: "Follow-up" },
];

const inputClass = "w-full border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#4f94cf]";

function Input({ label, value, onChange, placeholder = "", type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-900">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={inputClass} /></label>;
}

function Textarea({ label, value, onChange, placeholder = "", rows = 3 }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; rows?: number }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-900">{label}</span><textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={`${inputClass} resize-y`} /></label>;
}

function Heading({ children }: { children: ReactNode }) {
  return <h4 className="mb-4 border-b border-slate-300 pb-2 text-sm font-bold uppercase tracking-[0.16em] text-slate-900">{children}</h4>;
}

function emptyTrialEye(eye: "right" | "left"): ContactLensTrialEyeEntry {
  return {
    eye, sphere: "", cylinder: "", axis: "", base_curve: "", diameter: "", add_power: "",
    visual_acuity: "", over_refraction: "", fit_notes: "", material: "", design: "",
    sagittal_depth: "", landing_zone: "", centration: "", coverage: "", movement: "",
    push_up: "", rotation: "", comfort: "", fluorescein_pattern: "", vault: "",
    limbal_clearance: "", blanching: "", impingement: "",
  };
}

function newTrial(index: number, lensType: string): ContactLensTrial {
  return { id: `trial-${Date.now()}-${index}`, label: `Trial ${index}`, lens_type: lensType, brand: "", assessed_after: "", eyes: [emptyTrialEye("right"), emptyTrialEye("left")], notes: "" };
}

function newFollowUp(): ContactLensFollowUp {
  return { id: `follow-up-${Date.now()}`, followed_up_on: "", wearing_hours: "", vision: "", comfort: "", handling: "", solution_irritation: "", lens_fit_right: "", lens_fit_left: "", slit_lamp_findings: "", care_compliance: "", changes_made: "", next_appointment: "" };
}

function LensTypeSelector({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div><span className="mb-1.5 block text-sm font-semibold text-slate-900">Lens type</span><div className="flex flex-wrap gap-2">{["Soft", "RGP", "Scleral"].map((option) => <button key={option} type="button" onClick={() => onChange(option)} className={`border px-4 py-2 text-sm font-semibold transition ${value === option ? "border-[#376f9f] bg-[#376f9f] text-white" : "border-slate-300 bg-white text-slate-700 hover:border-[#4f94cf]"}`}>{option}</button>)}</div></div>;
}

export function ContactLensModal({ open, value, onClose, onSave, onChange, onEyeChange, inline = false, sidebar }: ContactLensModalProps) {
  const [page, setPage] = useState<PageKey>("workup");
  useEffect(() => {
    if (open && !inline) setPage("workup");
  }, [inline, open]);
  const setWorkup = (patch: Partial<ContactLensWorkup>) => onChange({ workup: { ...value.workup, ...patch } });
  const setDispensing = (patch: Partial<ContactLensPayload["dispensing"]>) => onChange({ dispensing: { ...value.dispensing, ...patch } });

  function updateTrial(id: string, patch: Partial<ContactLensTrial>) {
    onChange({ trials: value.trials.map((trial) => trial.id === id ? { ...trial, ...patch } : trial) });
  }
  function updateTrialEye(trial: ContactLensTrial, eye: "right" | "left", patch: Partial<ContactLensTrialEyeEntry>) {
    updateTrial(trial.id, { eyes: trial.eyes.map((entry) => entry.eye === eye ? { ...entry, ...patch } : entry) });
  }
  function updateFollowUp(id: string, patch: Partial<ContactLensFollowUp>) {
    onChange({ follow_ups: value.follow_ups.map((entry) => entry.id === id ? { ...entry, ...patch } : entry) });
  }

  return (
    <OptometryModalShell open={open} title="Contact Lens Case Sheet" description="Contact-lens work-up, fitting, dispensing and follow-up." saveLabel="Save Case Sheet" onClose={onClose} onSave={onSave} inline={inline} sidebar={sidebar}>
      <nav aria-label="Contact lens case sheet pages" className="flex max-w-4xl overflow-x-auto border-y border-slate-300">
        {PAGES.map((item, index) => {
          const active = page === item.key;
          return <button key={item.key} type="button" onClick={() => setPage(item.key)} className={`relative min-w-[132px] flex-1 px-5 py-3 text-sm font-semibold transition ${active ? "z-10 bg-[#376f9f] text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`} style={{ clipPath: index === PAGES.length - 1 ? undefined : "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)", marginLeft: index ? -8 : 0 }}>
            <span className="mr-1 text-[10px] uppercase tracking-[0.14em] opacity-75">{index + 1}</span> {item.label}
          </button>;
        })}
      </nav>

      {page === "workup" ? <div className="space-y-8">
        <section><Heading>Contact lens requirements</Heading><div className="grid gap-4 md:grid-cols-2">
          <Textarea label="Reason for contact lens wear" value={value.workup.reason_for_wear} onChange={(reason_for_wear) => setWorkup({ reason_for_wear })} placeholder="Sports, occupational, cosmetic or general use" />
          <Textarea label="Previous lens experience" value={value.workup.previous_lens_experience} onChange={(previous_lens_experience) => setWorkup({ previous_lens_experience })} placeholder="Lens type, brand, duration and problems" />
          <Textarea label="Wearing requirements" value={value.workup.wearing_requirements} onChange={(wearing_requirements) => setWorkup({ wearing_requirements })} placeholder="Expected daily hours, near work, outdoor or occasional use" />
          <Textarea label="Occupation and environment" value={value.workup.occupation_environment} onChange={(occupation_environment) => setWorkup({ occupation_environment })} placeholder="Screen use, dust, air conditioning, water exposure" />
          <Input label="Preferred modality" value={value.workup.preferred_modality} onChange={(preferred_modality) => setWorkup({ preferred_modality })} placeholder="Daily, fortnightly, monthly" />
          <Input label="Brand preference" value={value.workup.preferred_brand} onChange={(preferred_brand) => setWorkup({ preferred_brand })} placeholder="If any" />
        </div></section>
        <section><Heading>Anterior segment and tear film</Heading><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {([['Lids and lashes','lids_lashes'],['Conjunctiva','conjunctiva'],['Cornea','cornea'],['Anterior chamber','anterior_chamber'],['Tear film','tear_film']] as const).map(([label,key]) => <Input key={key} label={label} value={value.workup[key]} onChange={(next) => setWorkup({ [key]: next })} />)}
        </div></section>
        <section><Heading>Contact lens measurements</Heading><div className="overflow-x-auto"><table className="w-full min-w-[720px] border-collapse text-sm"><thead><tr className="bg-slate-100 text-left text-slate-900"><th className="border border-slate-300 p-2">Eye</th>{["Keratometry", "HVID", "TBUT", "Schirmer", "Tear prism", "Pachymetry"].map((label) => <th key={label} className="border border-slate-300 p-2">{label}</th>)}</tr></thead><tbody>{([['right','OD'],['left','OS']] as const).map(([eye,label]) => <tr key={eye}><th className="border border-slate-300 p-2 text-left">{label}</th>{(['keratometry','hvid','tbut','schirmer','tear_prism','pachymetry'] as const).map((field) => { const key = `${field}_${eye}` as keyof ContactLensWorkup; return <td key={field} className="border border-slate-300 p-1"><input value={value.workup[key]} onChange={(event) => setWorkup({ [key]: event.target.value })} className="w-full min-w-24 bg-transparent px-2 py-2 outline-none" /></td>; })}</tr>)}</tbody></table></div><div className="mt-4"><Textarea label="Topography and additional measurement notes" value={value.workup.topography_notes} onChange={(topography_notes) => setWorkup({ topography_notes })} /></div></section>
      </div> : null}

      {page === "trial" ? <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4"><LensTypeSelector value={value.lens_type} onChange={(lens_type) => onChange({ lens_type })} /><button type="button" onClick={() => onChange({ trials: [...value.trials, newTrial(value.trials.length + 1, value.lens_type)] })} className="inline-flex items-center gap-2 border border-[#4f94cf] px-4 py-2.5 text-sm font-semibold text-[#376f9f]"><Plus className="h-4 w-4" /> Add trial</button></div>
        {!value.trials.length ? <div className="border border-dashed border-slate-300 px-5 py-10 text-center text-sm text-slate-500">No trial lenses recorded yet.</div> : value.trials.map((trial, index) => <section key={trial.id} className="border-t border-slate-300 pt-5">
          <div className="mb-4 flex items-center justify-between"><h4 className="font-bold text-slate-900">Trial {index + 1}</h4><button type="button" onClick={() => onChange({ trials: value.trials.filter((entry) => entry.id !== trial.id) })} className="inline-flex items-center gap-1 text-sm font-semibold text-rose-700"><Trash2 className="h-4 w-4" /> Remove</button></div>
          <div className="mb-4 grid gap-4 md:grid-cols-3"><Input label="Lens type" value={trial.lens_type} onChange={(lens_type) => updateTrial(trial.id,{lens_type})} placeholder={value.lens_type || "Soft, RGP or scleral"}/><Input label="Brand / design" value={trial.brand} onChange={(brand) => updateTrial(trial.id,{brand})}/><Input label="Assessed after" value={trial.assessed_after} onChange={(assessed_after) => updateTrial(trial.id,{assessed_after})} placeholder="20 minutes"/></div>
          <TrialTable trial={trial} onChange={(eye,patch) => updateTrialEye(trial,eye,patch)} />
          <div className="mt-4"><Textarea label="Trial notes" value={trial.notes} onChange={(notes) => updateTrial(trial.id,{notes})}/></div>
        </section>)}
      </div> : null}

      {page === "final" ? <div className="space-y-8"><section><Heading>Final lens selection</Heading><div className="mb-4"><LensTypeSelector value={value.lens_type} onChange={(lens_type) => onChange({ lens_type })} /></div><div className="grid gap-4 md:grid-cols-3">
        <Input label="Manufacturer" value={value.manufacturer} onChange={(manufacturer) => onChange({ manufacturer })}/><Input label="Brand" value={value.brand} onChange={(brand) => onChange({ brand })}/><Input label="Wear modality" value={value.wear_modality} onChange={(wear_modality) => onChange({ wear_modality })}/>
      </div></section><FinalLensTable lensType={value.lens_type} eyes={value.eyes} onEyeChange={onEyeChange}/><section><Heading>Order and instructions</Heading><div className="grid gap-4 md:grid-cols-2"><Input label="Vendor" value={value.vendor_name} onChange={(vendor_name) => onChange({vendor_name})}/><Input label="Quantity" value={value.quantity} onChange={(quantity) => onChange({quantity})}/><div className="md:col-span-2"><Textarea label="Special instructions" value={value.special_instructions} onChange={(special_instructions) => onChange({special_instructions})}/></div></div></section></div> : null}

      {page === "dispensing" ? <div className="space-y-8"><section><Heading>Dispensing assessment</Heading><div className="grid gap-4 md:grid-cols-2"><Input type="date" label="Dispensed on" value={value.dispensing.dispensed_on} onChange={(dispensed_on) => setDispensing({dispensed_on})}/><Input label="Patient confidence" value={value.dispensing.patient_confidence} onChange={(patient_confidence) => setDispensing({patient_confidence})} placeholder="Independent, needs assistance"/><div className="md:col-span-2"><Textarea label="Slit-lamp findings before insertion" value={value.dispensing.pre_insertion_findings} onChange={(pre_insertion_findings) => setDispensing({pre_insertion_findings})}/></div></div></section><section><Heading>Training and care</Heading><div className="grid gap-3 md:grid-cols-2">{([['Hygiene explained','hygiene_explained'],['Insertion and removal taught','insertion_removal_taught'],['Care kit given','care_kit_given'],['Instruction booklet given','instruction_booklet_given']] as const).map(([label,key]) => <label key={key} className="flex items-center gap-3 border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900"><input type="checkbox" checked={value.dispensing[key]} onChange={(event) => setDispensing({[key]:event.target.checked})} className="h-4 w-4"/>{label}</label>)}</div><div className="mt-4 grid gap-4 md:grid-cols-2"><Input label="Care solution" value={value.dispensing.care_solution} onChange={(care_solution) => setDispensing({care_solution})}/><Input label="Wearing schedule" value={value.dispensing.wearing_schedule} onChange={(wearing_schedule) => setDispensing({wearing_schedule})}/><Input label="Replacement schedule" value={value.dispensing.replacement_schedule} onChange={(replacement_schedule) => setDispensing({replacement_schedule})}/><Textarea label="Advice" value={value.dispensing.advice} onChange={(advice) => setDispensing({advice})}/></div></section></div> : null}

      {page === "followup" ? <div className="space-y-6"><div className="flex justify-end"><button type="button" onClick={() => onChange({follow_ups:[...value.follow_ups,newFollowUp()]})} className="inline-flex items-center gap-2 border border-[#4f94cf] px-4 py-2.5 text-sm font-semibold text-[#376f9f]"><Plus className="h-4 w-4"/> Add follow-up</button></div>{!value.follow_ups.length ? <div className="border border-dashed border-slate-300 px-5 py-10 text-center text-sm text-slate-500">No follow-ups recorded yet.</div> : value.follow_ups.map((followUp,index) => <section key={followUp.id} className="border-t border-slate-300 pt-5"><div className="mb-4 flex items-center justify-between"><h4 className="font-bold text-slate-900">Follow-up {index+1}</h4><button type="button" onClick={() => onChange({follow_ups:value.follow_ups.filter((entry)=>entry.id!==followUp.id)})} className="inline-flex items-center gap-1 text-sm font-semibold text-rose-700"><Trash2 className="h-4 w-4"/> Remove</button></div><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"><Input type="date" label="Follow-up date" value={followUp.followed_up_on} onChange={(followed_up_on)=>updateFollowUp(followUp.id,{followed_up_on})}/><Input label="Average wearing hours" value={followUp.wearing_hours} onChange={(wearing_hours)=>updateFollowUp(followUp.id,{wearing_hours})}/><Input label="Vision" value={followUp.vision} onChange={(vision)=>updateFollowUp(followUp.id,{vision})}/><Input label="Comfort" value={followUp.comfort} onChange={(comfort)=>updateFollowUp(followUp.id,{comfort})}/><Input label="Handling" value={followUp.handling} onChange={(handling)=>updateFollowUp(followUp.id,{handling})}/><Input label="Solution irritation" value={followUp.solution_irritation} onChange={(solution_irritation)=>updateFollowUp(followUp.id,{solution_irritation})}/><Input label="Lens fit OD" value={followUp.lens_fit_right} onChange={(lens_fit_right)=>updateFollowUp(followUp.id,{lens_fit_right})}/><Input label="Lens fit OS" value={followUp.lens_fit_left} onChange={(lens_fit_left)=>updateFollowUp(followUp.id,{lens_fit_left})}/><Input label="Care compliance" value={followUp.care_compliance} onChange={(care_compliance)=>updateFollowUp(followUp.id,{care_compliance})}/><div className="lg:col-span-3"><Textarea label="Slit-lamp findings" value={followUp.slit_lamp_findings} onChange={(slit_lamp_findings)=>updateFollowUp(followUp.id,{slit_lamp_findings})}/></div><div className="md:col-span-2"><Textarea label="Changes made and advice" value={followUp.changes_made} onChange={(changes_made)=>updateFollowUp(followUp.id,{changes_made})}/></div><Input type="date" label="Next appointment" value={followUp.next_appointment} onChange={(next_appointment)=>updateFollowUp(followUp.id,{next_appointment})}/></div></section>)}</div> : null}
    </OptometryModalShell>
  );
}

function TrialTable({trial,onChange}:{trial:ContactLensTrial;onChange:(eye:"right"|"left",patch:Partial<ContactLensTrialEyeEntry>)=>void}) {
  const isRgp = /rgp|rigid/i.test(trial.lens_type);
  const isScleral = /scleral/i.test(trial.lens_type);
  const fitFields: Array<[string,keyof ContactLensTrialEyeEntry]> = isScleral ? [["Vault","vault"],["Limbal clearance","limbal_clearance"],["Blanching","blanching"],["Impingement","impingement"]] : isRgp ? [["Centration","centration"],["Movement","movement"],["Fluorescein pattern","fluorescein_pattern"],["Comfort","comfort"]] : [["Centration","centration"],["Coverage","coverage"],["Movement","movement"],["Push-up","push_up"],["Rotation","rotation"],["Comfort","comfort"]];
  const fields:Array<[string,keyof ContactLensTrialEyeEntry]> = [["Sphere","sphere"],["Cylinder","cylinder"],["Axis","axis"],["BC","base_curve"],["Diameter","diameter"],...(isScleral ? [["Sag","sagittal_depth"] as [string,keyof ContactLensTrialEyeEntry]]:[]),["Over-refraction","over_refraction"],["VA","visual_acuity"],...fitFields];
  return <div className="overflow-x-auto"><table className="w-full min-w-[900px] border-collapse text-sm"><thead><tr className="bg-slate-100 text-left text-slate-900"><th className="border border-slate-300 p-2">Eye</th>{fields.map(([label])=><th key={label} className="border border-slate-300 p-2">{label}</th>)}</tr></thead><tbody>{trial.eyes.map((eye)=><tr key={eye.eye}><th className="border border-slate-300 p-2 text-left">{eye.eye==='right'?'OD':'OS'}</th>{fields.map(([label,key])=><td key={label} className="border border-slate-300 p-1"><input value={String(eye[key]??'')} onChange={(event)=>onChange(eye.eye,{[key]:event.target.value})} className="w-full min-w-24 bg-transparent px-2 py-2 outline-none"/></td>)}</tr>)}</tbody></table></div>;
}

function FinalLensTable({lensType,eyes,onEyeChange}:{lensType:string;eyes:ContactLensEyeEntry[];onEyeChange:(eye:"right"|"left",patch:Partial<ContactLensEyeEntry>)=>void}) {
  const isScleral = /scleral/i.test(lensType);
  const fields:Array<[string,keyof ContactLensEyeEntry]> = [["Sphere","sphere"],["Cylinder","cylinder"],["Axis","axis"],["BC","base_curve"],["Diameter","diameter"],["Add","add_power"],["Material","material"],["Design","design"],...(isScleral ? [["Sag","sagittal_depth"] as [string,keyof ContactLensEyeEntry],["Landing zone","landing_zone"] as [string,keyof ContactLensEyeEntry]] : []),["VA","visual_acuity"]];
  return <section><Heading>OD / OS parameters</Heading><div className="overflow-x-auto"><table className="w-full min-w-[920px] border-collapse text-sm"><thead><tr className="bg-slate-100 text-left text-slate-900"><th className="border border-slate-300 p-2">Eye</th>{fields.map(([label])=><th key={label} className="border border-slate-300 p-2">{label}</th>)}</tr></thead><tbody>{eyes.map((eye)=><Fragment key={eye.eye}><tr><th className="border border-slate-300 p-2 text-left">{eye.eye==='right'?'OD':'OS'}</th>{fields.map(([label,key])=><td key={label} className="border border-slate-300 p-1"><input value={eye[key]} onChange={(event)=>onEyeChange(eye.eye,{[key]:event.target.value})} className="w-full min-w-20 bg-transparent px-2 py-2 outline-none"/></td>)}</tr><tr><th className="border border-slate-300 p-2 text-left">Fit</th><td colSpan={fields.length} className="border border-slate-300 p-1"><input value={eye.fit_notes} onChange={(event)=>onEyeChange(eye.eye,{fit_notes:event.target.value})} className="w-full bg-transparent px-2 py-2 outline-none" placeholder="Final fit and vision notes"/></td></tr></Fragment>)}</tbody></table></div></section>;
}
