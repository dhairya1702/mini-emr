"use client";

import { useEffect, useState } from "react";
import { Clock3, Phone, UserRound, X } from "lucide-react";

import { Patient } from "@/lib/types";

interface PatientDetailsDrawerProps {
  patient: Patient | null;
  onClose: () => void;
  onSave: (patientId: string, payload: {
    name: string;
    phone: string;
    reason: string;
    age: number;
    weight: number;
    height: number | null;
    temperature: number;
  }) => Promise<void>;
}

export function PatientDetailsDrawer({
  patient,
  onClose,
  onSave,
}: PatientDetailsDrawerProps) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    reason: "",
    age: "",
    weight: "",
    height: "",
    temperature: "",
  });
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!patient) {
      return;
    }

    setForm({
      name: patient.name,
      phone: patient.phone,
      reason: patient.reason,
      age: patient.age?.toString() ?? "",
      weight: patient.weight?.toString() ?? "",
      height: patient.height?.toString() ?? "",
      temperature: patient.temperature?.toString() ?? "",
    });
    setError("");
  }, [patient]);

  if (!patient) {
    return null;
  }

  const createdAt = new Date(patient.created_at).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  function getPhoneDigits(value: string) {
    return value.replace(/\D/g, "");
  }

  async function handleSave() {
    const digits = getPhoneDigits(form.phone);
    const age = Number(form.age);
    const weight = Number(form.weight);
    const temperature = Number(form.temperature);
    const height = form.height.trim() ? Number(form.height) : null;

    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }

    if (digits.length !== 10) {
      setError("Phone number must be exactly 10 digits.");
      return;
    }

    if (!form.reason.trim()) {
      setError("Reason for visit is required.");
      return;
    }

    if (!Number.isFinite(age) || age <= 0) {
      setError("Enter a valid age.");
      return;
    }

    if (!Number.isFinite(weight) || weight <= 0) {
      setError("Enter a valid weight.");
      return;
    }

    if (!Number.isFinite(temperature) || temperature < 90 || temperature > 110) {
      setError("Enter a valid temperature in F.");
      return;
    }

    if (height !== null && (!Number.isFinite(height) || height <= 0)) {
      setError("Enter a valid height.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await onSave(patient.id, {
        name: form.name.trim(),
        phone: form.phone.trim(),
        reason: form.reason.trim(),
        age,
        weight,
        height,
        temperature,
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update patient.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-30 w-full max-w-xl border-l border-sky-100 bg-white p-5 shadow-[0_20px_60px_rgba(125,211,252,0.2)] sm:p-6">
      <div className="flex h-full flex-col">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Patient Details</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-800">{patient.name}</h2>
            <p className="mt-2 text-sm text-slate-500">Current status: {patient.status}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setError("");
              onClose();
            }}
            className="rounded-full border border-sky-100 p-2 text-slate-500 transition hover:text-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto pr-1">
          <div className="rounded-[24px] border border-sky-100 bg-sky-50/50 p-4">
            <div className="flex items-center gap-3 text-slate-700">
              <UserRound className="h-4 w-4 text-sky-600" />
              <span className="text-sm font-medium">Name</span>
            </div>
            <input
              value={form.name}
              onChange={(event) => {
                setError("");
                setForm((current) => ({ ...current, name: event.target.value }));
              }}
              className="mt-2 w-full rounded-2xl border border-sky-200 bg-white px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
            />
          </div>

          <div className="rounded-[24px] border border-sky-100 bg-sky-50/50 p-4">
            <div className="flex items-center gap-3 text-slate-700">
              <Phone className="h-4 w-4 text-sky-600" />
              <span className="text-sm font-medium">Phone</span>
            </div>
            <input
              value={form.phone}
              onChange={(event) => {
                setError("");
                setForm((current) => ({ ...current, phone: event.target.value }));
              }}
              className="mt-2 w-full rounded-2xl border border-sky-200 bg-white px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-[24px] border border-sky-100 bg-sky-50/50 p-4">
              <p className="text-sm font-medium text-slate-700">Age</p>
              <input
                value={form.age}
                inputMode="numeric"
                onChange={(event) => {
                  setError("");
                  setForm((current) => ({ ...current, age: event.target.value }));
                }}
                className="mt-2 w-full rounded-2xl border border-sky-200 bg-white px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
              />
            </div>
            <div className="rounded-[24px] border border-sky-100 bg-sky-50/50 p-4">
              <p className="text-sm font-medium text-slate-700">Temperature</p>
              <input
                value={form.temperature}
                inputMode="decimal"
                onChange={(event) => {
                  setError("");
                  setForm((current) => ({ ...current, temperature: event.target.value }));
                }}
                className="mt-2 w-full rounded-2xl border border-sky-200 bg-white px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-[24px] border border-sky-100 bg-sky-50/50 p-4">
              <p className="text-sm font-medium text-slate-700">Weight</p>
              <input
                value={form.weight}
                inputMode="decimal"
                onChange={(event) => {
                  setError("");
                  setForm((current) => ({ ...current, weight: event.target.value }));
                }}
                className="mt-2 w-full rounded-2xl border border-sky-200 bg-white px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
              />
            </div>
            <div className="rounded-[24px] border border-sky-100 bg-sky-50/50 p-4">
              <p className="text-sm font-medium text-slate-700">Height</p>
              <input
                value={form.height}
                inputMode="decimal"
                onChange={(event) => {
                  setError("");
                  setForm((current) => ({ ...current, height: event.target.value }));
                }}
                className="mt-2 w-full rounded-2xl border border-sky-200 bg-white px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
              />
            </div>
          </div>

          <div className="rounded-[24px] border border-sky-100 bg-sky-50/50 p-4">
            <div className="flex items-center gap-3 text-slate-700">
              <Clock3 className="h-4 w-4 text-sky-600" />
              <span className="text-sm font-medium">Created</span>
            </div>
            <p className="mt-2 text-base text-slate-800">{createdAt}</p>
          </div>

          <div className="rounded-[24px] border border-sky-100 bg-sky-50/50 p-4">
            <p className="text-sm font-medium text-slate-700">Reason for Visit</p>
            <textarea
              rows={4}
              value={form.reason}
              onChange={(event) => {
                setError("");
                setForm((current) => ({ ...current, reason: event.target.value }));
              }}
              className="mt-2 w-full rounded-2xl border border-sky-200 bg-white px-4 py-3 text-base leading-7 text-slate-800 outline-none transition focus:border-sky-400"
            />
          </div>
        </div>

        <div className="mt-5 border-t border-sky-100 pt-4">
          {error ? <p className="mb-3 text-sm font-medium text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setError("");
                onClose();
              }}
              className="rounded-full border border-sky-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:text-slate-900"
            >
              Close
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
