import { AuthResponse } from "@/lib/types";

const TOKEN_KEY = "clinic_auth_token";
const USER_KEY = "clinic_auth_user";

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
  setSession(session: AuthResponse) {
    if (!isBrowser()) {
      return;
    }
    window.localStorage.setItem(TOKEN_KEY, session.token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(session.user));
  },
  clear() {
    if (!isBrowser()) {
      return;
    }
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  },
};
