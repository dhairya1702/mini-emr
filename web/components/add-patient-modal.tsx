"use client";

import { FormEvent, useEffect, useState } from "react";
import { X } from "lucide-react";

import { api } from "@/lib/api";
import { PatientMatch } from "@/lib/types";

interface AddPatientModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    entryType: "queue" | "appointment";
    existingPatientId?: string;
    name: string;
    phone: string;
    email: string;
    address: string;
    reason: string;
    age: number | null;
    weight: number | null;
    height: number | null;
    temperature: number | null;
    scheduled_for?: string;
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
    email: "",
    address: "",
    reason: "",
    age: "",
    weight: "",
    height: "",
    temperature: "",
    heightUnit: "cm",
    temperatureUnit: "F",
    entryType: "queue" as "queue" | "appointment",
    appointmentDate: "",
    appointmentTime: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState("");
  const [searchPhone, setSearchPhone] = useState("");
  const [searchFeedback, setSearchFeedback] = useState("");
  const [existingMatches, setExistingMatches] = useState<PatientMatch[]>([]);
  const [selectedExistingMatchId, setSelectedExistingMatchId] = useState("");

  function getPhoneDigits(value: string) {
    return value.replace(/\D/g, "");
  }

  function toFahrenheit(value: number, unit: string) {
    return unit === "C" ? (value * 9) / 5 + 32 : value;
  }

  function toCentimeters(value: number, unit: string) {
    return unit === "m" ? value * 100 : value;
  }

  function resetForm() {
    setForm({
      name: "",
      phone: "",
      email: "",
      address: "",
      reason: "",
      age: "",
      weight: "",
      height: "",
      temperature: "",
      heightUnit: "cm",
      temperatureUnit: "F",
      entryType: "queue",
      appointmentDate: "",
      appointmentTime: "",
    });
    setSelectedExistingMatchId("");
    setSearchPhone("");
    setSearchFeedback("");
  }

  function handleClose() {
    resetForm();
    setExistingMatches([]);
    setError("");
    onClose();
  }

  useEffect(() => {
    if (!open) {
      resetForm();
      setExistingMatches([]);
      setError("");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  function loadExistingRecord(match: PatientMatch) {
    setForm((current) => ({
      ...current,
      name: match.name,
      phone: match.phone,
      email: match.email ?? "",
      address: match.address ?? "",
      reason: match.reason,
      age: "",
      weight: "",
      height: "",
      temperature: "",
      heightUnit: "cm",
      temperatureUnit: "F",
    }));
    setExistingMatches([]);
    setSearchPhone(match.phone);
    setSearchFeedback(`Loaded ${match.name}. You can update the visit reason below before saving.`);
    setSelectedExistingMatchId(match.id);
    setError("");
  }

  async function handleSearchExistingPatient() {
    const digits = getPhoneDigits(searchPhone).slice(0, 10);
    setSearchPhone(digits);
    setError("");
    setSearchFeedback("");
    setSelectedExistingMatchId("");
    setExistingMatches([]);

    if (digits.length !== 10) {
      setSearchFeedback("Enter a 10-digit phone number to search existing patients.");
      setForm((current) => ({ ...current, phone: digits }));
      return;
    }

    setIsSearching(true);
    try {
      const matches = await api.lookupPatientsByPhone(digits);
      setForm((current) => ({ ...current, phone: digits }));
      if (matches.length) {
        setExistingMatches(matches);
        setSearchFeedback("Existing patient records found. Select the right profile or continue as a new entry.");
        return;
      }
      setSearchFeedback("No existing patient found for this number. Continue below to add a new patient.");
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Failed to search patients.");
    } finally {
      setIsSearching(false);
    }
  }

  async function submitPatient(skipExistingCheck = false) {
    const digits = getPhoneDigits(form.phone);
    const isAppointment = form.entryType === "appointment";
    const age = form.age.trim() ? Number(form.age) : null;
    const weight = form.weight.trim() ? Number(form.weight) : null;
    const rawTemperature = form.temperature.trim() ? Number(form.temperature) : null;
    const rawHeight = form.height.trim() ? Number(form.height) : null;
    const normalizedEmail = form.email.trim().toLowerCase();

    if (digits.length !== 10) {
      setError("Phone number must be exactly 10 digits.");
      return;
    }

    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }

    if (!form.reason.trim()) {
      setError("Reason for visit is required.");
      return;
    }

    if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    if (!isAppointment && (age === null || !Number.isFinite(age) || age <= 0)) {
      setError("Enter a valid age.");
      return;
    }

    if (!isAppointment && (weight === null || !Number.isFinite(weight) || weight <= 0)) {
      setError("Enter a valid weight.");
      return;
    }

    if (!isAppointment && (rawTemperature === null || !Number.isFinite(rawTemperature))) {
      setError("Enter a valid temperature.");
      return;
    }

    if (!isAppointment && rawHeight !== null && (!Number.isFinite(rawHeight) || rawHeight <= 0)) {
      setError("Enter a valid height.");
      return;
    }

    const temperature =
      rawTemperature !== null ? toFahrenheit(rawTemperature, form.temperatureUnit) : null;
    const height = rawHeight !== null ? toCentimeters(rawHeight, form.heightUnit) : null;

    if (!isAppointment && temperature !== null && (temperature < 90 || temperature > 110)) {
      setError(
        form.temperatureUnit === "C"
          ? "Enter a valid temperature in C."
          : "Enter a valid temperature in F.",
      );
      return;
    }

    if (isAppointment && !form.appointmentDate) {
      setError("Choose an appointment date.");
      return;
    }

    if (isAppointment && !form.appointmentTime) {
      setError("Choose an appointment time.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      if (!skipExistingCheck && !selectedExistingMatchId) {
        const matches = await api.lookupPatientsByPhone(form.phone);
        if (matches.length) {
          setExistingMatches(matches);
          setError("Existing records found for this phone number. Select one or create a new entry.");
          return;
        }
      }

      await onSubmit({
        entryType: form.entryType,
        existingPatientId: selectedExistingMatchId || undefined,
        name: form.name,
        phone: form.phone,
        email: normalizedEmail,
        address: form.address.trim(),
        reason: form.reason,
        age,
        weight,
        height,
        temperature,
        scheduled_for: isAppointment
          ? new Date(`${form.appointmentDate}T${form.appointmentTime}:00`).toISOString()
          : undefined,
      });
      resetForm();
      setExistingMatches([]);
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitPatient(false);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-sky-100/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[32px] border-2 border-sky-300 bg-white shadow-[0_20px_60px_rgba(125,211,252,0.22)]">
        <div className="flex items-center justify-between border-b border-sky-100 px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Add Patient</h2>
            <p className="mt-1 text-sm text-slate-700">Quick intake for the live queue or a future booking.</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full border border-sky-200 p-2 text-slate-700 transition hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="space-y-4 overflow-y-auto px-6 py-5" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={searchPhone}
                onChange={(event) => {
                  setError("");
                  setSearchFeedback("");
                  setExistingMatches([]);
                  setSelectedExistingMatchId("");
                  const digits = getPhoneDigits(event.target.value).slice(0, 10);
                  setSearchPhone(digits);
                  setForm((current) => ({ ...current, phone: digits }));
                }}
                className="min-w-0 flex-1 rounded-2xl border border-sky-100 bg-white px-4 py-3 text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-sky-400"
                placeholder="Search by 10-digit phone number"
              />
              <button
                type="button"
                onClick={() => void handleSearchExistingPatient()}
                disabled={isSearching}
                className="rounded-2xl bg-sky-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSearching ? "Searching..." : "Search"}
              </button>
          </div>

          {searchFeedback ? (
            <p className="text-sm text-slate-700">{searchFeedback}</p>
          ) : null}

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-800">Add As</span>
            <select
              value={form.entryType}
              onChange={(event) => {
                setError("");
                setForm((current) => ({
                  ...current,
                  entryType: event.target.value as "queue" | "appointment",
                }));
              }}
              className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
            >
              <option value="queue">Queue Patient</option>
              <option value="appointment">Appointment</option>
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-800">Name</span>
              <input
                required
                value={form.name}
                onChange={(event) => {
                  setError("");
                  setSelectedExistingMatchId("");
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
                  setSelectedExistingMatchId("");
                  const digits = getPhoneDigits(event.target.value).slice(0, 10);
                  setSearchPhone(digits);
                  setForm((current) => ({ ...current, phone: digits }));
                }}
                className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-sky-400"
                placeholder="10-digit phone number"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-800">Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => {
                  setError("");
                  setForm((current) => ({ ...current, email: event.target.value }));
                }}
                className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-sky-400"
                placeholder="patient@example.com"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-800">Address</span>
              <input
                value={form.address}
                onChange={(event) => {
                  setError("");
                  setForm((current) => ({ ...current, address: event.target.value }));
                }}
                className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-sky-400"
                placeholder="Street, locality"
              />
            </label>
          </div>

          {existingMatches.length ? (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4">
              <p className="text-sm font-semibold text-amber-900">
                Existing records found for this phone number.
              </p>
              <div className="mt-4 max-h-64 space-y-3 overflow-y-auto pr-1">
                {existingMatches.map((match) => (
                  <div key={match.id} className="rounded-[20px] border border-amber-200 bg-white px-4 py-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{match.name}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {match.phone} · {match.status} · {new Date(match.created_at).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </p>
                        <p className="mt-1 truncate text-sm text-slate-600">{match.reason}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => loadExistingRecord(match)}
                        className="shrink-0 rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600"
                      >
                        Select Existing
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void submitPatient(true)}
                  disabled={isSaving}
                  className="rounded-full border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-sky-50 disabled:opacity-60"
                >
                  Continue As New Patient
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExistingMatches([]);
                    setSearchFeedback("");
                    setError("");
                  }}
                  className="rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-900 transition hover:bg-amber-100"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}

          {form.entryType === "appointment" ? (
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-800">Appointment Date</span>
                <input
                  type="date"
                  value={form.appointmentDate}
                  onChange={(event) => {
                    setError("");
                    setExistingMatches([]);
                    setSelectedExistingMatchId("");
                    setForm((current) => ({ ...current, appointmentDate: event.target.value }));
                  }}
                  className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-800">Appointment Time</span>
                <input
                  type="time"
                  value={form.appointmentTime}
                  onChange={(event) => {
                    setError("");
                    setExistingMatches([]);
                    setSelectedExistingMatchId("");
                    setForm((current) => ({ ...current, appointmentTime: event.target.value }));
                  }}
                  className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>
            </div>
          ) : null}

          {form.entryType === "queue" ? (
            <>
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
            </>
          ) : null}

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
              {isSaving ? "Saving..." : form.entryType === "appointment" ? "Create Appointment" : "Add to Queue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
