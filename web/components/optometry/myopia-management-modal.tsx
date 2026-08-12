"use client";

import { useEffect, useState } from "react";

import { MyopiaMeasurementForm } from "@/components/optometry/myopia/myopia-measurement-form";
import { OptometryModalShell } from "@/components/optometry/optometry-modal-shell";
import type { MyopiaMeasurementDraft } from "@/lib/optometry/consultation";
import { formatLocalDateTimeInput } from "@/lib/optometry/consultation";

type MyopiaManagementModalProps = {
  open: boolean;
  value: MyopiaMeasurementDraft;
  patientAge: number | null;
  onClose: () => void;
  onSave: (next: MyopiaMeasurementDraft) => Promise<void>;
  inline?: boolean;
};

export function MyopiaManagementModal({
  open,
  value,
  patientAge,
  onClose,
  onSave,
  inline = false,
}: MyopiaManagementModalProps) {
  const [draft, setDraft] = useState<MyopiaMeasurementDraft>(value);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft({
        ...value,
        age_years: value.age_years > 0 ? value.age_years : Number(patientAge || 0),
        measured_at: value.measured_at || formatLocalDateTimeInput(),
      });
      setStatus("");
      setIsSaving(false);
    }
  }, [open, patientAge, value]);

  async function handleSave() {
    if (draft.age_years <= 0) {
      setStatus("Enter the patient age at measurement.");
      return;
    }
    if (draft.axial_length_right_mm <= 0 || draft.axial_length_left_mm <= 0) {
      setStatus("Enter axial length for both eyes.");
      return;
    }
    if (!draft.measured_at.trim()) {
      setStatus("Enter the measurement date and time.");
      return;
    }
    setIsSaving(true);
    setStatus("");
    try {
      await onSave(draft);
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save myopia measurement.");
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
      inline={inline}
    >
      <MyopiaMeasurementForm value={draft} onChange={setDraft} />
      {status ? <p className="text-sm font-medium text-rose-700">{status}</p> : null}
    </OptometryModalShell>
  );
}
