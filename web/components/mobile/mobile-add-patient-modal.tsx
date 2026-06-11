"use client";

import { FormEvent, useState } from "react";
import { X } from "lucide-react";

import type { PatientInput } from "@/lib/types";

const initialForm = {
  name: "",
  phone: "",
  reason: "",
  age: "",
  weight: "",
  temperature: "98.6",
  email: "",
  address: "",
  height: "",
};

export function MobileAddPatientModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: PatientInput) => Promise<void>;
}) {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  if (!open) {
    return null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const age = Number(form.age);
    const weight = Number(form.weight);
    const temperature = Number(form.temperature);
    const height = form.height.trim() ? Number(form.height) : null;
    if (!form.name.trim() || !form.phone.trim() || !form.reason.trim()) {
      setError("Name, phone, and reason are required.");
      return;
    }
    if (!Number.isFinite(age) || !Number.isFinite(weight) || !Number.isFinite(temperature)) {
      setError("Age, weight, and temperature must be valid numbers.");
      return;
    }

    setIsSaving(true);
    try {
      await onSubmit({
        name: form.name.trim(),
        phone: form.phone.trim(),
        reason: form.reason.trim(),
        age,
        weight,
        temperature,
        height,
        email: form.email.trim(),
        address: form.address.trim(),
      });
      setForm(initialForm);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to add patient.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/35 px-4 py-5">
      <form
        onSubmit={handleSubmit}
        className="mx-auto max-h-full max-w-lg overflow-y-auto rounded-[20px] border border-[#dbe7ef] bg-white p-5 shadow-[0_14px_38px_rgba(64,131,181,0.16)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Queue</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-800">Add patient</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="clinic-icon-button"
            aria-label="Close add patient"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid gap-3">
          {[
            ["name", "Name"],
            ["phone", "Phone"],
            ["reason", "Reason for visit"],
            ["age", "Age"],
            ["weight", "Weight"],
            ["temperature", "Temperature"],
            ["height", "Height optional"],
            ["email", "Email optional"],
            ["address", "Address optional"],
          ].map(([key, label]) => (
            <label key={key} className="grid gap-1.5 text-sm font-medium text-slate-700">
              {label}
              <input
                value={form[key as keyof typeof form]}
                onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                className="clinic-input h-12 rounded-xl text-base"
                inputMode={["age", "weight", "temperature", "height"].includes(key) ? "decimal" : undefined}
              />
            </label>
          ))}
        </div>

        {error ? <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <button
          type="submit"
          disabled={isSaving}
          className="clinic-button-primary mt-5 h-12 w-full"
        >
          {isSaving ? "Adding..." : "Add to queue"}
        </button>
      </form>
    </div>
  );
}
