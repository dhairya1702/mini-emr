"use client";

import { useEffect, useRef, useState } from "react";

import {
  buildPatientEditPayload,
  createPatientEditForm,
  type PatientEditForm,
  type PatientEditSavePayload,
} from "@/features/patient-chart/editor/patient-editor-model";
import type { Patient } from "@/lib/types";

type UsePatientEditorOptions = {
  patient: Patient | null;
  readOnly: boolean;
  onSave: (patientId: string, payload: PatientEditSavePayload) => Promise<void>;
  onSaved: () => void;
};

export function usePatientEditor({ patient, readOnly, onSave, onSaved }: UsePatientEditorOptions) {
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<PatientEditForm>(() => createPatientEditForm(patient));
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const patientId = patient?.id ?? "";
  const patientRef = useRef(patient);
  patientRef.current = patient;

  useEffect(() => {
    setForm(createPatientEditForm(patientRef.current));
    setIsEditing(false);
    setError("");
    setIsSaving(false);
  }, [patientId]);

  function updateField<Key extends keyof PatientEditForm>(field: Key, value: PatientEditForm[Key]) {
    setError("");
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    if (readOnly || !patient) return;
    const result = buildPatientEditPayload(form);
    if (!result.payload) {
      setError(result.error);
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      await onSave(patient.id, result.payload);
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update patient.");
    } finally {
      setIsSaving(false);
    }
  }

  return {
    form,
    isEditing,
    isSaving,
    error,
    updateField,
    toggleEditing: () => setIsEditing((current) => !current),
    clearError: () => setError(""),
    save,
  };
}

export type PatientEditorWorkflow = ReturnType<typeof usePatientEditor>;
