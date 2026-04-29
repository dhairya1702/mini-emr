"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { authStorage, SESSION_EXPIRED_MESSAGE } from "@/lib/auth";
import { AuthUser, ClinicSettings } from "@/lib/types";

const SESSION_EXPIRED_REDIRECT = "/login?reason=session-expired";
const PUBLIC_PATHS = new Set(["/login", "/follow-up"]);

type ClinicShellContextValue = {
  currentUser: AuthUser | null;
  clinicSettings: ClinicSettings | null;
  error: string;
  isAuthReady: boolean;
  isRedirectingToLogin: boolean;
  refreshShell: () => Promise<void>;
  applyClinicSettings: (settings: ClinicSettings) => void;
  applyCurrentUser: (user: AuthUser | null) => void;
  redirectToLogin: (message: string) => void;
  handleLogout: () => void;
};

const ClinicShellContext = createContext<ClinicShellContextValue | null>(null);

function isSessionErrorMessage(message: string) {
  return (
    message === "Authentication required." ||
    message === "Invalid token." ||
    message === "Token expired." ||
    message === "Session expired." ||
    message === SESSION_EXPIRED_MESSAGE
  );
}

export function ClinicShellProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => authStorage.getUser());
  const [clinicSettings, setClinicSettings] = useState<ClinicSettings | null>(null);
  const [error, setError] = useState("");
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isRedirectingToLogin, setIsRedirectingToLogin] = useState(false);
  const hasBootstrappedRef = useRef(false);
  const bootstrapPromiseRef = useRef<Promise<void> | null>(null);

  const redirectToLogin = useCallback((message: string) => {
    authStorage.clear();
    setCurrentUser(null);
    setClinicSettings(null);
    setError(
      message === "Token expired." || message === "Session expired."
        ? SESSION_EXPIRED_MESSAGE
        : message,
    );
    setIsRedirectingToLogin(true);
    setIsAuthReady(true);
    router.replace(
      message === "Token expired." ||
      message === "Session expired." ||
      message === SESSION_EXPIRED_MESSAGE
        ? SESSION_EXPIRED_REDIRECT
        : "/login",
    );
  }, [router]);

  const loadShell = useCallback(async (force = false) => {
    const isPublicPath = PUBLIC_PATHS.has(pathname);
    if (isPublicPath) {
      hasBootstrappedRef.current = false;
      setError("");
      setIsRedirectingToLogin(false);
      setIsAuthReady(true);
      return;
    }

    if (
      !force &&
      hasBootstrappedRef.current &&
      currentUser &&
      clinicSettings
    ) {
      setError("");
      setIsRedirectingToLogin(false);
      setIsAuthReady(true);
      return;
    }

    if (bootstrapPromiseRef.current && !force) {
      return bootstrapPromiseRef.current;
    }

    const task = (async () => {
      setError("");
      setIsRedirectingToLogin(false);
      setIsAuthReady(false);

      if (authStorage.clearExpiredSession()) {
        redirectToLogin(SESSION_EXPIRED_MESSAGE);
        return;
      }

      if (!authStorage.getToken()) {
        redirectToLogin("Authentication required.");
        return;
      }

      try {
        const [user, settings] = await Promise.all([
          api.getCurrentUser(),
          api.getClinicSettings(),
        ]);
        authStorage.setUser(user);
        setCurrentUser(user);
        setClinicSettings(settings);
        setError("");
        setIsRedirectingToLogin(false);
        setIsAuthReady(true);
        hasBootstrappedRef.current = true;
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "Failed to load page.";
        if (isSessionErrorMessage(message)) {
          redirectToLogin(message);
          return;
        }
        setError(message);
        setIsAuthReady(true);
      }
    })();

    bootstrapPromiseRef.current = task;
    try {
      await task;
    } finally {
      bootstrapPromiseRef.current = null;
    }
  }, [clinicSettings, currentUser, pathname, redirectToLogin]);

  useEffect(() => {
    void loadShell(false);
  }, [loadShell]);

  const refreshShell = useCallback(async () => {
    await loadShell(true);
  }, [loadShell]);

  const applyClinicSettings = useCallback((settings: ClinicSettings) => {
    setClinicSettings(settings);
  }, []);

  const applyCurrentUser = useCallback((user: AuthUser | null) => {
    authStorage.setUser(user);
    setCurrentUser(user);
  }, []);

  const handleLogout = useCallback(() => {
    setIsRedirectingToLogin(true);
    void api.logout()
      .catch(() => undefined)
      .finally(() => {
        authStorage.clear();
        setCurrentUser(null);
        setClinicSettings(null);
        hasBootstrappedRef.current = false;
        router.replace("/login");
      });
  }, [router]);

  const value = useMemo<ClinicShellContextValue>(() => ({
    currentUser,
    clinicSettings,
    error,
    isAuthReady,
    isRedirectingToLogin,
    refreshShell,
    applyClinicSettings,
    applyCurrentUser,
    redirectToLogin,
    handleLogout,
  }), [
    applyClinicSettings,
    applyCurrentUser,
    clinicSettings,
    currentUser,
    error,
    handleLogout,
    isAuthReady,
    isRedirectingToLogin,
    redirectToLogin,
    refreshShell,
  ]);

  return (
    <ClinicShellContext.Provider value={value}>
      {children}
    </ClinicShellContext.Provider>
  );
}

export function useClinicShell() {
  const context = useContext(ClinicShellContext);
  if (!context) {
    throw new Error("useClinicShell must be used within ClinicShellProvider.");
  }
  return context;
}
