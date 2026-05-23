import type { AuthUser } from "@/lib/types";

const WORKSPACE_STORAGE_PREFIX = "consultation-workspace:v2";
const WORKSPACE_VERSION = 2;

type WorkspaceScope = {
  orgId: string;
  userId: string;
  patientId: string;
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
  };
}

export function resolveConsultationWorkspaceScope(
  currentUser: AuthUser | null | undefined,
  patientId: string,
): WorkspaceScope | null {
  const orgId = currentUser?.org_id?.trim() || "";
  const userId = currentUser?.id?.trim() || "";
  const normalizedPatientId = patientId.trim();
  if (!orgId || !userId || !normalizedPatientId) {
    return null;
  }
  return { orgId, userId, patientId: normalizedPatientId };
}

export function consultationWorkspaceKey(scope: WorkspaceScope) {
  const normalized = normalizeScope(scope);
  return `${WORKSPACE_STORAGE_PREFIX}:${normalized.orgId}:${normalized.userId}:${normalized.patientId}`;
}

export function readConsultationWorkspace<TSnapshot>(
  scope: WorkspaceScope,
  options?: LegacyWorkspaceOptions,
): TSnapshot | null {
  if (!isBrowser()) {
    return null;
  }

  const primaryKey = consultationWorkspaceKey(scope);
  const raw = window.localStorage.getItem(primaryKey);
  if (!raw) {
    const legacyPatientId = options?.legacyPatientId?.trim() || "";
    if (!legacyPatientId) {
      return null;
    }

    const legacyKey = `consultation-workspace:${legacyPatientId}`;
    const legacyRaw = window.localStorage.getItem(legacyKey);
    if (!legacyRaw) {
      return null;
    }

    try {
      const legacySnapshot = JSON.parse(legacyRaw) as TSnapshot;
      writeConsultationWorkspace(scope, legacySnapshot);
      window.localStorage.removeItem(legacyKey);
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
        window.localStorage.removeItem(primaryKey);
        return null;
      }
      return parsed.snapshot;
    }

    // Drop legacy or malformed snapshots instead of trying to coerce them.
    window.localStorage.removeItem(primaryKey);
    return null;
  } catch {
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
  window.localStorage.setItem(consultationWorkspaceKey(scope), JSON.stringify(persisted));
}

export function clearConsultationWorkspace(scope: WorkspaceScope) {
  if (!isBrowser()) {
    return;
  }
  window.localStorage.removeItem(consultationWorkspaceKey(scope));
}
