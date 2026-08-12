"use client";

import { useEffect, useState } from "react";

import { MyopiaMeasurementForm } from "@/components/optometry/myopia/myopia-measurement-form";
import { OptometryModalShell } from "@/components/optometry/optometry-modal-shell";
import { formatLocalDateTimeInput } from "@/lib/optometry/myopia/shared";
import type { MyopiaMeasurementPayload } from "@/lib/types";

function createEmptyMyopiaMeasurement(patientAge: number | null): MyopiaMeasurementPayload {
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

export function HistoricalMyopiaModal({
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
  const [form, setForm] = useState(() => createEmptyMyopiaMeasurement(patientAge));
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(createEmptyMyopiaMeasurement(patientAge));
      setError("");
      setIsSaving(false);
    }
  }, [open, patientAge]);

  async function handleSave() {
    if (!form.measured_at.trim()) {
      setError("Enter the measurement date and time.");
      return;
    }
    if (form.age_years <= 0) {
      setError("Enter the patient age at measurement.");
      return;
    }
    if (form.axial_length_right_mm <= 0 || form.axial_length_left_mm <= 0) {
      setError("Enter axial length for both eyes.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await onSave({ ...form, measured_at: new Date(form.measured_at).toISOString() });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save myopia measurement.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <OptometryModalShell
      open={open}
      title="Myopia Management"
      saveLabel="Save"
      onClose={onClose}
      onSave={() => void handleSave()}
      isSaving={isSaving}
    >
      <MyopiaMeasurementForm value={form} onChange={setForm} />
      {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
    </OptometryModalShell>
  );
}
