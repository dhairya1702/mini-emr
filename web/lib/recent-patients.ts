"use client";

import type { Patient } from "@/lib/types";

const LEGACY_STORAGE_KEY = "clinic_recent_patients";
const STORAGE_KEY_PREFIX = "clinic_recent_patients:v2";
const MAX_RECENT_PATIENTS = 8;

export type RecentPatientsScope = {
  orgId: string;
  userId: string;
};

function storageKey({ orgId, userId }: RecentPatientsScope) {
  return `${STORAGE_KEY_PREFIX}:${encodeURIComponent(orgId)}:${encodeURIComponent(userId)}`;
}

function readPatientList(key: string): Patient[] {
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw) as Patient[];
  return Array.isArray(parsed) ? parsed : [];
}

export function loadRecentPatients(scope: RecentPatientsScope): Patient[] {
  if (typeof window === "undefined") {
    return [];
  }
  const scopedKey = storageKey(scope);
  try {
    const scopedPatients = readPatientList(scopedKey);
    if (scopedPatients.length) {
      return scopedPatients;
    }
    const legacyPatients = readPatientList(LEGACY_STORAGE_KEY);
    if (legacyPatients.length) {
      const migrated = legacyPatients.slice(0, MAX_RECENT_PATIENTS);
      window.localStorage.setItem(scopedKey, JSON.stringify(migrated));
      return migrated;
    }
    return [];
  } catch {
    return [];
  }
}

export function saveRecentPatient({ orgId, userId, patient }: RecentPatientsScope & { patient: Patient }): Patient[] {
  if (typeof window === "undefined") {
    return [];
  }
  const scopedKey = storageKey({ orgId, userId });
  const current = loadRecentPatients({ orgId, userId }).filter((entry) => entry.id !== patient.id);
  const next = [patient, ...current].slice(0, MAX_RECENT_PATIENTS);
  window.localStorage.setItem(scopedKey, JSON.stringify(next));
  return next;
}
