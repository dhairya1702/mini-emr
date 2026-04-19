import { AuthResponse } from "@/lib/types";

const TOKEN_KEY = "clinic_auth_token";
const USER_KEY = "clinic_auth_user";
const SESSION_EXPIRY_KEY = "clinic_session_expires_at";
export const SESSION_EXPIRED_MESSAGE = "Session expired. Please sign in again.";

function isBrowser() {
  return typeof window !== "undefined";
}

export const authStorage = {
  getToken(): string {
    if (!isBrowser()) {
      return "";
    }
    return window.localStorage.getItem(TOKEN_KEY) || "";
  },
  getUser() {
    if (!isBrowser()) {
      return null;
    }
    const raw = window.localStorage.getItem(USER_KEY);
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
    const raw = window.localStorage.getItem(SESSION_EXPIRY_KEY);
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
    if (session.token) {
      window.localStorage.setItem(TOKEN_KEY, session.token);
    }
    window.localStorage.setItem(USER_KEY, JSON.stringify(session.user));
    if (expiresAtMs && Number.isFinite(expiresAtMs)) {
      window.localStorage.setItem(SESSION_EXPIRY_KEY, String(expiresAtMs));
    }
  },
  setToken(token: string) {
    if (!isBrowser()) {
      return;
    }
    if (token) {
      window.localStorage.setItem(TOKEN_KEY, token);
      return;
    }
    window.localStorage.removeItem(TOKEN_KEY);
  },
  setSessionExpiry(expiresAtSeconds: number | null) {
    if (!isBrowser()) {
      return;
    }
    if (expiresAtSeconds && Number.isFinite(expiresAtSeconds)) {
      window.localStorage.setItem(SESSION_EXPIRY_KEY, String(expiresAtSeconds * 1000));
      return;
    }
    window.localStorage.removeItem(SESSION_EXPIRY_KEY);
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
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    window.localStorage.removeItem(SESSION_EXPIRY_KEY);
  },
};
