import type { AuthUser, NoteAsset } from "@/lib/types";

const MOBILE_CONSULTATION_PREFIX = "mobile-consultation:v1";

export type MobileConsultationDraft = {
  symptoms: string;
  diagnosis: string;
  medications: string;
  notes: string;
  generatedNote: string;
  noteId: string;
  assets: NoteAsset[];
  savedAt: string;
};

type MobileConsultationScope = {
  orgId: string;
  userId: string;
  patientId: string;
};

function isBrowser() {
  return typeof window !== "undefined";
}

export function resolveMobileConsultationScope(
  currentUser: AuthUser | null | undefined,
  patientId: string,
): MobileConsultationScope | null {
  const orgId = currentUser?.org_id?.trim() || "";
  const userId = currentUser?.id?.trim() || "";
  const normalizedPatientId = patientId.trim();
  if (!orgId || !userId || !normalizedPatientId) {
    return null;
  }
  return { orgId, userId, patientId: normalizedPatientId };
}

export function mobileConsultationKey(scope: MobileConsultationScope) {
  return `${MOBILE_CONSULTATION_PREFIX}:${scope.orgId}:${scope.userId}:${scope.patientId}`;
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
      notes: String(parsed.notes || ""),
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
