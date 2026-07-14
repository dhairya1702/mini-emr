import { AuthResponse } from "@/lib/types";

const TOKEN_KEY = "clinic_auth_token";
const USER_KEY = "clinic_auth_user";
const SESSION_EXPIRY_KEY = "clinic_session_expires_at";
const SPECIALTY_ONBOARDING_KEY = "clinic_specialty_onboarding_pending";
export const SESSION_EXPIRED_MESSAGE = "Session expired. Please sign in again.";

function isBrowser() {
  return typeof window !== "undefined";
}

function getSessionStorage() {
  if (!isBrowser()) {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const SENSITIVE_STORAGE_PREFIXES = [
  "consultation-workspace:",
  "consultation-workspace:v2:",
  "mobile-consultation:",
  "mobile-consultation:v1:",
  "clinic_recent_patients",
  "clinic_queue_order_",
];

function removeKeysWithPrefixes(storage: Storage | null, prefixes: string[]) {
  if (!storage) {
    return;
  }
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
      keys.push(key);
    }
  }
  keys.forEach((key) => storage.removeItem(key));
}

export const authStorage = {
  getToken(): string {
    // Browser authentication is cookie-first. Clear tokens left by older
    // builds so JavaScript never retains a reusable bearer credential.
    getSessionStorage()?.removeItem(TOKEN_KEY);
    return "";
  },
  getUser() {
    if (!isBrowser()) {
      return null;
    }
    const raw = getSessionStorage()?.getItem(USER_KEY);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  getTokenExpiryMs(): number | null {
    if (!isBrowser()) {
      return null;
    }
    const raw = getSessionStorage()?.getItem(SESSION_EXPIRY_KEY);
    if (!raw) {
      return null;
    }
    const expiresAt = Number(raw);
    return Number.isFinite(expiresAt) ? expiresAt : null;
  },
  isSessionExpired(bufferMs = 0): boolean {
    const expiresAt = this.getTokenExpiryMs();
    if (!expiresAt) {
      return false;
    }
    return expiresAt <= Date.now() + bufferMs;
  },
  setSession(session: AuthResponse, expiresAtMs?: number | null) {
    if (!isBrowser()) {
      return;
    }
    getSessionStorage()?.removeItem(TOKEN_KEY);
    getSessionStorage()?.setItem(USER_KEY, JSON.stringify(session.user));
    if (expiresAtMs && Number.isFinite(expiresAtMs)) {
      getSessionStorage()?.setItem(SESSION_EXPIRY_KEY, String(expiresAtMs));
    }
  },
  setToken(token: string) {
    void token;
    getSessionStorage()?.removeItem(TOKEN_KEY);
  },
  setUser(user: AuthResponse["user"] | null) {
    if (!isBrowser()) {
      return;
    }
    if (user) {
      getSessionStorage()?.setItem(USER_KEY, JSON.stringify(user));
      return;
    }
    getSessionStorage()?.removeItem(USER_KEY);
  },
  setSessionExpiry(expiresAtSeconds: number | null) {
    if (!isBrowser()) {
      return;
    }
    if (expiresAtSeconds && Number.isFinite(expiresAtSeconds)) {
      getSessionStorage()?.setItem(SESSION_EXPIRY_KEY, String(expiresAtSeconds * 1000));
      return;
    }
    getSessionStorage()?.removeItem(SESSION_EXPIRY_KEY);
  },
  clearExpiredSession(): boolean {
    if (!this.getTokenExpiryMs()) {
      return false;
    }
    if (!this.isSessionExpired()) {
      return false;
    }
    this.clear();
    return true;
  },
  clear() {
    if (!isBrowser()) {
      return;
    }
    const sessionStorage = getSessionStorage();
    sessionStorage?.removeItem(TOKEN_KEY);
    sessionStorage?.removeItem(USER_KEY);
    sessionStorage?.removeItem(SESSION_EXPIRY_KEY);
    sessionStorage?.removeItem(SPECIALTY_ONBOARDING_KEY);
    removeKeysWithPrefixes(sessionStorage, SENSITIVE_STORAGE_PREFIXES);
    removeKeysWithPrefixes(window.localStorage, SENSITIVE_STORAGE_PREFIXES);
    // Remove auth values left by versions that persisted them across browser sessions.
    window.localStorage.removeItem(USER_KEY);
    window.localStorage.removeItem(SESSION_EXPIRY_KEY);
    window.localStorage.removeItem(SPECIALTY_ONBOARDING_KEY);
  },
  isSpecialtyOnboardingPending() {
    if (!isBrowser()) {
      return false;
    }
    return getSessionStorage()?.getItem(SPECIALTY_ONBOARDING_KEY) === "1";
  },
  setSpecialtyOnboardingPending(isPending: boolean) {
    if (!isBrowser()) {
      return;
    }
    if (isPending) {
      getSessionStorage()?.setItem(SPECIALTY_ONBOARDING_KEY, "1");
      return;
    }
    getSessionStorage()?.removeItem(SPECIALTY_ONBOARDING_KEY);
  },
};
