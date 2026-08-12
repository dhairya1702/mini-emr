import type { AuthUser } from "@/lib/types";

const WORKSPACE_STORAGE_PREFIX = "consultation-workspace:v3";
const WORKSPACE_VERSION = 3;

type WorkspaceScope = {
  orgId: string;
  userId: string;
  patientId: string;
  visitId: string;
};

type PersistedWorkspaceSnapshot<TSnapshot> = {
  version: number;
  saved_at: string;
  snapshot: TSnapshot;
};

type LegacyWorkspaceOptions = {
  legacyPatientId?: string | null;
};

function isBrowser() {
  return typeof window !== "undefined";
}

function normalizeScope(scope: WorkspaceScope) {
  return {
    orgId: scope.orgId.trim(),
    userId: scope.userId.trim(),
    patientId: scope.patientId.trim(),
    visitId: scope.visitId.trim(),
  };
}

export function resolveConsultationWorkspaceScope(
  currentUser: AuthUser | null | undefined,
  patientId: string,
  visitId: string,
): WorkspaceScope | null {
  const orgId = currentUser?.org_id?.trim() || "";
  const userId = currentUser?.id?.trim() || "";
  const normalizedPatientId = patientId.trim();
  const normalizedVisitId = visitId.trim();
  if (!orgId || !userId || !normalizedPatientId || !normalizedVisitId) {
    return null;
  }
  return { orgId, userId, patientId: normalizedPatientId, visitId: normalizedVisitId };
}

export function consultationWorkspaceKey(scope: WorkspaceScope) {
  const normalized = normalizeScope(scope);
  return `${WORKSPACE_STORAGE_PREFIX}:${normalized.orgId}:${normalized.userId}:${normalized.patientId}:${normalized.visitId}`;
}

export function readConsultationWorkspace<TSnapshot>(
  scope: WorkspaceScope,
  options?: LegacyWorkspaceOptions,
): TSnapshot | null {
  if (!isBrowser()) {
    return null;
  }

  const primaryKey = consultationWorkspaceKey(scope);
  const sessionRaw = window.sessionStorage.getItem(primaryKey);
  const localPrimaryRaw = window.localStorage.getItem(primaryKey);
  const raw = sessionRaw || localPrimaryRaw;
  if (!raw) {
    const legacyPatientId = options?.legacyPatientId?.trim() || "";
    if (!legacyPatientId) {
      return null;
    }

    const legacyKey = `consultation-workspace:${legacyPatientId}`;
    const legacyRaw =
      window.sessionStorage.getItem(legacyKey) ||
      window.localStorage.getItem(legacyKey);
    if (!legacyRaw) {
      return null;
    }

    try {
      const legacySnapshot = JSON.parse(legacyRaw) as TSnapshot;
      writeConsultationWorkspace(scope, legacySnapshot);
      window.sessionStorage.removeItem(legacyKey);
      window.localStorage.removeItem(legacyKey);
      window.localStorage.removeItem(primaryKey);
      return legacySnapshot;
    } catch {
      window.localStorage.removeItem(legacyKey);
      return null;
    }
  }

  try {
    const parsed = JSON.parse(raw) as PersistedWorkspaceSnapshot<TSnapshot> | TSnapshot;
    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in parsed &&
      "snapshot" in parsed
    ) {
      if (parsed.version !== WORKSPACE_VERSION) {
        window.sessionStorage.removeItem(primaryKey);
        window.localStorage.removeItem(primaryKey);
        return null;
      }
      if (!sessionRaw && localPrimaryRaw) {
        writeConsultationWorkspace(scope, parsed.snapshot);
      }
      return parsed.snapshot;
    }

    // Drop legacy or malformed snapshots instead of trying to coerce them.
    window.sessionStorage.removeItem(primaryKey);
    window.localStorage.removeItem(primaryKey);
    return null;
  } catch {
    window.sessionStorage.removeItem(primaryKey);
    window.localStorage.removeItem(primaryKey);
    return null;
  }
}

export function writeConsultationWorkspace<TSnapshot>(
  scope: WorkspaceScope,
  snapshot: TSnapshot,
) {
  if (!isBrowser()) {
    return;
  }

  const persisted: PersistedWorkspaceSnapshot<TSnapshot> = {
    version: WORKSPACE_VERSION,
    saved_at: new Date().toISOString(),
    snapshot,
  };
  const key = consultationWorkspaceKey(scope);
  const serialized = JSON.stringify(persisted);
  window.sessionStorage.setItem(key, serialized);
  try {
    window.localStorage.setItem(key, serialized);
  } catch {
    // Session recovery remains available if persistent browser storage is full.
  }
}

export function clearConsultationWorkspace(scope: WorkspaceScope) {
  if (!isBrowser()) {
    return;
  }
  window.sessionStorage.removeItem(consultationWorkspaceKey(scope));
  window.localStorage.removeItem(consultationWorkspaceKey(scope));
}
