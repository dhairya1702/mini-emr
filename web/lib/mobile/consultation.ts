import type { AuthUser, NoteAsset } from "@/lib/types";

const MOBILE_CONSULTATION_PREFIX = "mobile-consultation:v2";

export type MobileStructuredModuleDraft = {
  module_type: string;
  payload: Record<string, unknown>;
};

export type MobileConsultationDraft = {
  symptoms: string;
  diagnosis: string;
  medications: string;
  treatment: string;
  notes: string;
  bloodPressureSystolic: string;
  bloodPressureDiastolic: string;
  pulse: string;
  spo2: string;
  bloodSugar: string;
  testScores: Array<{ label: string; value: string }>;
  structuredModules: MobileStructuredModuleDraft[];
  generatedNote: string;
  noteId: string;
  assets: NoteAsset[];
  savedAt: string;
};

type MobileConsultationScope = {
  orgId: string;
  userId: string;
  patientId: string;
  visitId: string;
};

function isBrowser() {
  return typeof window !== "undefined";
}

export function resolveMobileConsultationScope(
  currentUser: AuthUser | null | undefined,
  patientId: string,
  visitId: string,
): MobileConsultationScope | null {
  const orgId = currentUser?.org_id?.trim() || "";
  const userId = currentUser?.id?.trim() || "";
  const normalizedPatientId = patientId.trim();
  const normalizedVisitId = visitId.trim();
  if (!orgId || !userId || !normalizedPatientId || !normalizedVisitId) {
    return null;
  }
  return { orgId, userId, patientId: normalizedPatientId, visitId: normalizedVisitId };
}

export function mobileConsultationKey(scope: MobileConsultationScope) {
  return `${MOBILE_CONSULTATION_PREFIX}:${scope.orgId}:${scope.userId}:${scope.patientId}:${scope.visitId}`;
}

export function readMobileConsultationDraft(scope: MobileConsultationScope): MobileConsultationDraft | null {
  if (!isBrowser()) {
    return null;
  }
  const key = mobileConsultationKey(scope);
  const sessionRaw = window.sessionStorage.getItem(key);
  const raw = sessionRaw || window.localStorage.getItem(key);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MobileConsultationDraft>;
    const draft = {
      symptoms: String(parsed.symptoms || ""),
      diagnosis: String(parsed.diagnosis || ""),
      medications: String(parsed.medications || ""),
      treatment: String(parsed.treatment || ""),
      notes: String(parsed.notes || ""),
      bloodPressureSystolic: String(parsed.bloodPressureSystolic || ""),
      bloodPressureDiastolic: String(parsed.bloodPressureDiastolic || ""),
      pulse: String(parsed.pulse || ""),
      spo2: String(parsed.spo2 || ""),
      bloodSugar: String(parsed.bloodSugar || ""),
      testScores: Array.isArray(parsed.testScores)
        ? parsed.testScores.map((entry) => ({
            label: String(entry?.label || ""),
            value: String(entry?.value || ""),
          }))
        : [],
      structuredModules: Array.isArray(parsed.structuredModules)
        ? parsed.structuredModules
            .filter((entry) => entry && typeof entry === "object")
            .map((entry) => ({
              module_type: String(entry.module_type || ""),
              payload: entry.payload && typeof entry.payload === "object" ? entry.payload as Record<string, unknown> : {},
            }))
            .filter((entry) => entry.module_type)
        : [],
      generatedNote: String(parsed.generatedNote || ""),
      noteId: String(parsed.noteId || ""),
      assets: Array.isArray(parsed.assets) ? parsed.assets as NoteAsset[] : [],
      savedAt: String(parsed.savedAt || ""),
    };
    if (!sessionRaw) {
      window.sessionStorage.setItem(key, JSON.stringify(draft));
      window.localStorage.removeItem(key);
    }
    return draft;
  } catch {
    window.sessionStorage.removeItem(key);
    window.localStorage.removeItem(key);
    return null;
  }
}

export function writeMobileConsultationDraft(
  scope: MobileConsultationScope,
  draft: Omit<MobileConsultationDraft, "savedAt">,
) {
  if (!isBrowser()) {
    return;
  }
  window.sessionStorage.setItem(
    mobileConsultationKey(scope),
    JSON.stringify({ ...draft, savedAt: new Date().toISOString() }),
  );
}

export function clearMobileConsultationDraft(scope: MobileConsultationScope) {
  if (!isBrowser()) {
    return;
  }
  window.sessionStorage.removeItem(mobileConsultationKey(scope));
  window.localStorage.removeItem(mobileConsultationKey(scope));
}
