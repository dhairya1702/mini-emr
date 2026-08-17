"use client";

import type { PatientEditorWorkflow } from "@/features/patient-chart/editor/use-patient-editor";
import type { SexAtBirth } from "@/lib/types";

function EditorField({
  label,
  value,
  onChange,
  inputMode,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: "numeric" | "decimal" | "tel";
  type?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-sm font-semibold text-black">{label}</span>
      <input
        value={value}
        type={type}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full rounded-lg border border-[#bfd7e8] bg-[#f7fbfd] px-3 text-sm font-medium text-black outline-none transition focus:border-[#6daed8] focus:bg-white"
      />
    </label>
  );
}

export function PatientEditorForm({ workflow }: { workflow: PatientEditorWorkflow }) {
  const { form } = workflow;
  if (!workflow.isEditing) return null;
  return (
    <div className="mt-4 rounded-xl border border-[#dbe7ef] bg-[#f7fbfd] p-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(180px,1.35fr)_repeat(4,minmax(110px,0.8fr))]">
        <EditorField label="Name" value={form.name} onChange={(value) => workflow.updateField("name", value)} />
        <EditorField label="Phone" value={form.phone} inputMode="tel" onChange={(value) => workflow.updateField("phone", value)} />
        <EditorField label="DOB" value={form.dateOfBirth} type="date" onChange={(value) => workflow.updateField("dateOfBirth", value)} />
        <EditorField label="Reason" value={form.reason} onChange={(value) => workflow.updateField("reason", value)} />
        <EditorField label="Email" value={form.email} type="email" onChange={(value) => workflow.updateField("email", value)} />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(180px,1.35fr)_repeat(4,minmax(110px,0.8fr))]">
        <EditorField label="Address" value={form.address} onChange={(value) => workflow.updateField("address", value)} />
        <EditorField label="Weight" value={form.weight} inputMode="decimal" onChange={(value) => workflow.updateField("weight", value)} />
        <EditorField label="Height" value={form.height} inputMode="decimal" onChange={(value) => workflow.updateField("height", value)} />
        <EditorField label="Temp" value={form.temperature} inputMode="decimal" onChange={(value) => workflow.updateField("temperature", value)} />
      </div>
      <div className="mt-3 max-w-xs">
        <label className="block text-xs font-medium text-black">
          Sex
          <select
            value={form.sexAtBirth}
            onChange={(event) => workflow.updateField("sexAtBirth", event.target.value as "" | SexAtBirth)}
            className="mt-1 w-full rounded-lg border border-[#dbe7ef] bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#6daed8]"
          >
            <option value="">Not recorded</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
    </div>
  );
}

export function PatientEditorFooter({
  workflow,
  profilePhotoError,
  readOnly,
}: {
  workflow: PatientEditorWorkflow;
  profilePhotoError: string;
  readOnly: boolean;
}) {
  const visibleError = workflow.error || profilePhotoError;
  if (!visibleError && (readOnly || !workflow.isEditing)) return null;
  return (
    <div className="border-t border-[#dbe7ef] px-5 py-4 sm:px-7">
      {visibleError ? <p className="mb-3 text-sm font-medium text-rose-600">{visibleError}</p> : null}
      <div className="flex justify-end gap-3">
        {!readOnly && workflow.isEditing ? (
          <button
            type="button"
            disabled={workflow.isSaving}
            onClick={() => { void workflow.save(); }}
            className="rounded-xl bg-[#2f8fd3] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
          >
            {workflow.isSaving ? "Saving..." : "Save Changes"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
