"use client";

import { FormEvent, useState } from "react";
import { X } from "lucide-react";

interface AddPatientModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    phone: string;
    reason: string;
    age: number;
    weight: number;
    height: number | null;
    temperature: number;
  }) => Promise<void>;
}

export function AddPatientModal({
  open,
  onClose,
  onSubmit,
}: AddPatientModalProps) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    reason: "",
    age: "",
    weight: "",
    height: "",
    temperature: "",
    heightUnit: "cm",
    temperatureUnit: "F",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  if (!open) {
    return null;
  }

  function getPhoneDigits(value: string) {
    return value.replace(/\D/g, "");
  }

  function toFahrenheit(value: number, unit: string) {
    return unit === "C" ? (value * 9) / 5 + 32 : value;
  }

  function toCentimeters(value: number, unit: string) {
    return unit === "m" ? value * 100 : value;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const digits = getPhoneDigits(form.phone);
    const age = Number(form.age);
    const weight = Number(form.weight);
    const rawTemperature = Number(form.temperature);
    const rawHeight = form.height.trim() ? Number(form.height) : null;

    if (digits.length !== 10) {
      setError("Phone number must be exactly 10 digits.");
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

    if (!Number.isFinite(rawTemperature)) {
      setError("Enter a valid temperature.");
      return;
    }

    if (rawHeight !== null && (!Number.isFinite(rawHeight) || rawHeight <= 0)) {
      setError("Enter a valid height.");
      return;
    }

    const temperature = toFahrenheit(rawTemperature, form.temperatureUnit);
    const height = rawHeight !== null ? toCentimeters(rawHeight, form.heightUnit) : null;

    if (temperature < 90 || temperature > 110) {
      setError(
        form.temperatureUnit === "C"
          ? "Enter a valid temperature in C."
          : "Enter a valid temperature in F.",
      );
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await onSubmit({
        name: form.name,
        phone: form.phone,
        reason: form.reason,
        age,
        weight,
        height,
        temperature,
      });
      setForm({
        name: "",
        phone: "",
        reason: "",
        age: "",
        weight: "",
        height: "",
        temperature: "",
        heightUnit: "cm",
        temperatureUnit: "F",
      });
      setError("");
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Failed to add patient.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-sky-100/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-[32px] border-2 border-sky-300 bg-white p-6 shadow-[0_20px_60px_rgba(125,211,252,0.22)]">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Add Patient</h2>
            <p className="mt-1 text-sm text-slate-700">Quick intake for the live queue.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setError("");
              onClose();
            }}
            className="rounded-full border border-sky-200 p-2 text-slate-700 transition hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-800">Name</span>
            <input
              required
              value={form.name}
              onChange={(event) => {
                setError("");
                setForm((current) => ({ ...current, name: event.target.value }));
              }}
              className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-sky-400"
              placeholder="Patient full name"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-800">Phone</span>
            <input
              required
              value={form.phone}
              onChange={(event) => {
                setError("");
                setForm((current) => ({ ...current, phone: event.target.value }));
              }}
              className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-sky-400"
              placeholder="10-digit phone number"
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-800">Age</span>
              <input
                required
                inputMode="numeric"
                value={form.age}
                onChange={(event) => {
                  setError("");
                  setForm((current) => ({ ...current, age: event.target.value }));
                }}
                className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-sky-400"
                placeholder="Years"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-800">Temperature</span>
              <div className="flex gap-2">
                <input
                  required
                  inputMode="decimal"
                  value={form.temperature}
                  onChange={(event) => {
                    setError("");
                    setForm((current) => ({ ...current, temperature: event.target.value }));
                  }}
                  className="min-w-0 flex-1 rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-sky-400"
                  placeholder={form.temperatureUnit === "C" ? "37" : "98.6"}
                />
                <select
                  value={form.temperatureUnit}
                  onChange={(event) => {
                    setError("");
                    setForm((current) => ({
                      ...current,
                      temperatureUnit: event.target.value as "C" | "F",
                    }));
                  }}
                  className="rounded-2xl border border-sky-100 bg-sky-50/50 px-3 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                >
                  <option value="F">F</option>
                  <option value="C">C</option>
                </select>
              </div>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-800">Weight</span>
              <input
                required
                inputMode="decimal"
                value={form.weight}
                onChange={(event) => {
                  setError("");
                  setForm((current) => ({ ...current, weight: event.target.value }));
                }}
                className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-sky-400"
                placeholder="kg"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-800">Height</span>
              <div className="flex gap-2">
                <input
                  inputMode="decimal"
                  value={form.height}
                  onChange={(event) => {
                    setError("");
                    setForm((current) => ({ ...current, height: event.target.value }));
                  }}
                  className="min-w-0 flex-1 rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-sky-400"
                  placeholder={form.heightUnit === "m" ? "1.72" : "172"}
                />
                <select
                  value={form.heightUnit}
                  onChange={(event) => {
                    setError("");
                    setForm((current) => ({
                      ...current,
                      heightUnit: event.target.value as "m" | "cm",
                    }));
                  }}
                  className="rounded-2xl border border-sky-100 bg-sky-50/50 px-3 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                >
                  <option value="cm">cm</option>
                  <option value="m">m</option>
                </select>
              </div>
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-800">Reason for Visit</span>
            <textarea
              required
              rows={4}
              value={form.reason}
              onChange={(event) => {
                setError("");
                setForm((current) => ({ ...current, reason: event.target.value }));
              }}
              className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-sky-400"
              placeholder="Short reason for visit"
            />
          </label>

          {error ? (
            <p className="text-sm font-medium text-rose-600">{error}</p>
          ) : null}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setError("");
                onClose();
              }}
              className="rounded-full border border-sky-200 px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Add to Queue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
