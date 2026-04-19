"use client";

import { Patient } from "@/lib/types";

const STORAGE_KEY = "clinic_recent_patients";
const MAX_RECENT_PATIENTS = 8;

export function loadRecentPatients(): Patient[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as Patient[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRecentPatient(patient: Patient): Patient[] {
  if (typeof window === "undefined") {
    return [];
  }
  const current = loadRecentPatients().filter((entry) => entry.id !== patient.id);
  const next = [patient, ...current].slice(0, MAX_RECENT_PATIENTS);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
