"use client";

import { FormEvent, useEffect, useState } from "react";
import { Camera, X } from "lucide-react";
import Image from "next/image";

import { api } from "@/lib/api";
import type { PatientMatch } from "@/lib/types";

const initialForm = {
  name: "",
  phone: "",
  reason: "",
  dateOfBirth: "",
  weight: "",
  temperature: "",
  height: "",
  email: "",
};

export type MobileQueuePatientPayload = {
  existingPatientId?: string;
  name: string;
  phone: string;
  reason: string;
  date_of_birth?: string | null;
  age: number | null;
  weight: number | null;
  temperature: number | null;
  height: number | null;
  email: string;
  address: string;
  photo?: File | null;
};

function phoneDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 10);
}

export function MobileAddPatientModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: MobileQueuePatientPayload) => Promise<void>;
}) {
  const [form, setForm] = useState(initialForm);
  const [searchPhone, setSearchPhone] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [matches, setMatches] = useState<PatientMatch[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");

  function resetAndClose() {
    setForm(initialForm);
    setSearchPhone("");
    setError("");
    setFeedback("");
    setMatches([]);
    setSelectedMatchId("");
    setPhotoFile(null);
    onClose();
  }

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl("");
      return;
    }

    const objectUrl = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [photoFile]);

  function selectPhotoFile(file: File | null | undefined) {
    setError("");
    setPhotoFile(file ?? null);
  }

  if (!open) {
    return null;
  }

  function loadExisting(match: PatientMatch) {
    setForm((current) => ({
      ...current,
      name: match.name,
      phone: phoneDigits(match.phone),
      email: match.email ?? "",
      reason: "",
      dateOfBirth: match.date_of_birth ?? "",
      weight: "",
      temperature: "",
      height: "",
    }));
    setSelectedMatchId(match.id);
    setMatches([]);
    setFeedback(`Loaded ${match.name}. Add today's reason and vitals.`);
    setError("");
  }

  async function searchExisting() {
    const digits = phoneDigits(searchPhone);
    setSearchPhone(digits);
    setError("");
    setFeedback("");
    setMatches([]);
    setSelectedMatchId("");

    if (digits.length !== 10) {
      setFeedback("Enter a 10-digit phone number to search existing patients.");
      return;
    }

    setIsSearching(true);
    try {
      const found = await api.lookupPatientsByPhone(digits);
      if (found.length) {
        setMatches(found);
        setFeedback("Existing patient found. Select the right record or continue as new.");
        return;
      }
      setFeedback("No existing patient found. Continue as a new patient.");
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Failed to search patients.");
    } finally {
      setIsSearching(false);
    }
  }

  async function submitPatient(event: FormEvent) {
    event.preventDefault();
    setError("");

    const weight = form.weight.trim() ? Number(form.weight) : null;
    const temperature = form.temperature.trim() ? Number(form.temperature) : null;
    const height = form.height.trim() ? Number(form.height) : null;

    if (!form.name.trim() || phoneDigits(form.phone).length !== 10 || !form.reason.trim()) {
      setError("Name, 10-digit phone, and reason are required.");
      return;
    }
    if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) {
      setError("Weight must be valid.");
      return;
    }
    if (temperature !== null && !Number.isFinite(temperature)) {
      setError("Temperature must be valid.");
      return;
    }
    if (height !== null && (!Number.isFinite(height) || height <= 0)) {
      setError("Height must be valid.");
      return;
    }
    if (photoFile && !["image/jpeg", "image/png", "image/webp"].includes(photoFile.type)) {
      setError("Only JPG, PNG, and WEBP patient photos are supported.");
      return;
    }
    if (photoFile && photoFile.size > 5 * 1024 * 1024) {
      setError("Patient photo must be 5 MB or smaller.");
      return;
    }

    setIsSaving(true);
    try {
      await onSubmit({
        existingPatientId: selectedMatchId || undefined,
        name: form.name.trim(),
        phone: phoneDigits(form.phone),
        reason: form.reason.trim(),
        date_of_birth: form.dateOfBirth || null,
        age: null,
        weight,
        temperature,
        height,
        email: form.email.trim().toLowerCase(),
        address: "",
        photo: photoFile,
      });
      resetAndClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to add patient.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/35 p-3">
      <form
        onSubmit={submitPatient}
        className="mx-auto mt-3 w-full max-w-md rounded-[22px] border border-[#bfd7e8] bg-white p-4 shadow-[0_18px_50px_rgba(64,131,181,0.18)] max-h-[calc(100dvh-1.5rem)] overflow-y-auto sm:mt-6 sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Add patient</h2>
          </div>
          <button type="button" onClick={resetAndClose} className="clinic-icon-button" aria-label="Close add patient">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          <input
            value={searchPhone}
            onChange={(event) => {
              setError("");
              setFeedback("");
              setMatches([]);
              setSelectedMatchId("");
              setSearchPhone(phoneDigits(event.target.value));
            }}
            className="clinic-input h-11 min-w-0 flex-1 rounded-xl text-base"
            inputMode="tel"
            placeholder="Search 10-digit phone"
          />
          <button type="button" onClick={() => void searchExisting()} disabled={isSearching} className="clinic-button-primary h-11 px-4 text-sm">
            {isSearching ? "..." : "Search"}
          </button>
        </div>

        {feedback ? <p className="mt-2 text-xs text-slate-600">{feedback}</p> : null}

        {matches.length ? (
          <div className="mt-3 grid gap-2">
            {matches.slice(0, 2).map((match) => (
              <button
                key={match.id}
                type="button"
                onClick={() => loadExisting(match)}
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left"
              >
                <p className="text-sm font-semibold text-slate-900">{match.name}</p>
                <p className="mt-0.5 text-xs text-slate-600">{match.phone} · {match.reason || "No reason"}</p>
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-3">
          <div className="flex items-center gap-3 rounded-[16px] border border-[#dbe7ef] bg-[#f7fbfd] px-3 py-2.5 text-sm font-semibold text-slate-700">
            <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[14px] border border-[#bfd7e8] bg-white text-[#2f8fd3]">
              {photoPreviewUrl ? (
                <Image unoptimized src={photoPreviewUrl} alt="Patient photo preview" width={48} height={48} className="h-full w-full object-cover" />
              ) : (
                <Camera className="h-5 w-5" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block">{photoFile ? "Photo selected" : "Photo"}</span>
              <span className="block text-xs font-normal text-slate-400">JPG, PNG, or WEBP</span>
            </span>
            <div className="flex shrink-0 gap-2">
              <label className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-2 text-xs font-semibold text-[#2a6fa8]">
                Upload
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    selectPhotoFile(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
              <label className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-2 text-xs font-semibold text-[#2a6fa8]">
                Camera
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(event) => {
                    selectPhotoFile(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Name
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="clinic-input h-11 min-w-0 rounded-xl text-base" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Phone
            <input
              value={form.phone}
              onChange={(event) => {
                setError("");
                setSelectedMatchId("");
                setForm((current) => ({ ...current, phone: phoneDigits(event.target.value) }));
              }}
              className="clinic-input h-11 min-w-0 rounded-xl text-base"
              inputMode="tel"
              placeholder="10-digit phone number"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Reason
            <input value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} className="clinic-input h-11 min-w-0 rounded-xl text-base" />
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
              DOB
              <input type="date" value={form.dateOfBirth} onChange={(event) => setForm((current) => ({ ...current, dateOfBirth: event.target.value }))} className="clinic-input h-11 min-w-0 rounded-xl text-base" />
            </label>
            <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
              Temp
              <input value={form.temperature} onChange={(event) => setForm((current) => ({ ...current, temperature: event.target.value }))} className="clinic-input h-11 min-w-0 rounded-xl text-base" inputMode="decimal" />
            </label>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
              Height
              <input value={form.height} onChange={(event) => setForm((current) => ({ ...current, height: event.target.value }))} className="clinic-input h-11 min-w-0 rounded-xl text-base" inputMode="decimal" />
            </label>
            <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
              Weight
              <input value={form.weight} onChange={(event) => setForm((current) => ({ ...current, weight: event.target.value }))} className="clinic-input h-11 min-w-0 rounded-xl text-base" inputMode="decimal" />
            </label>
          </div>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Email
            <input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className="clinic-input h-11 min-w-0 rounded-xl text-base" type="email" />
          </label>
        </div>

        {error ? <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <button type="submit" disabled={isSaving} className="clinic-button-primary mt-4 h-11 w-full">
          {isSaving ? "Adding..." : selectedMatchId ? "Add existing to queue" : "Add to queue"}
        </button>
      </form>
    </div>
  );
}
