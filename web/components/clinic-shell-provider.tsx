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
import { createTrainingScope, readTrainingMode, resetTrainingData, writeTrainingMode } from "@/lib/training-mode";
import { AuthUser, ClinicSettings } from "@/lib/types";

const SESSION_EXPIRED_REDIRECT = "/login?reason=session-expired";
const PUBLIC_PATHS = new Set(["/login", "/follow-up"]);
const SPECIALTY_ONBOARDING_PATH = "/onboarding/specialty";
const SHELL_LOAD_MAX_ATTEMPTS = 2;
const SHELL_LOAD_RETRY_DELAY_MS = 350;

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
  isTrainingMode: boolean;
  trainingScope: string | null;
  enterTrainingMode: () => void;
  exitTrainingMode: () => void;
  resetTrainingMode: () => void;
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
  const [isTrainingMode, setIsTrainingMode] = useState(false);
  const hasBootstrappedRef = useRef(false);
  const bootstrapPromiseRef = useRef<Promise<void> | null>(null);
  const trainingScope = useMemo(() => createTrainingScope(currentUser), [currentUser]);

  const delay = useCallback(async (ms: number) => {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  }, []);

  const redirectToLogin = useCallback((message: string) => {
    authStorage.clear();
    setCurrentUser(null);
    setClinicSettings(null);
    setIsTrainingMode(false);
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

  useEffect(() => {
    setIsTrainingMode(readTrainingMode(trainingScope));
  }, [trainingScope]);

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

      authStorage.clearExpiredSession();

      for (let attempt = 1; attempt <= SHELL_LOAD_MAX_ATTEMPTS; attempt += 1) {
        try {
          const [user, settings] = await Promise.all([
            api.getCurrentUser(),
            api.getClinicSettings(),
          ]);
          authStorage.setUser(user);
          setCurrentUser(user);
          setClinicSettings(settings);
          const requiresSpecialtyOnboarding =
            authStorage.isSpecialtyOnboardingPending() &&
            !settings.clinic_specialty;
          if (settings.clinic_specialty) {
            authStorage.setSpecialtyOnboardingPending(false);
          }
          setError("");
          setIsRedirectingToLogin(false);
          setIsAuthReady(true);
          hasBootstrappedRef.current = true;
          if (requiresSpecialtyOnboarding && pathname !== SPECIALTY_ONBOARDING_PATH) {
            router.replace(SPECIALTY_ONBOARDING_PATH);
            return;
          }
          if (!requiresSpecialtyOnboarding && pathname === SPECIALTY_ONBOARDING_PATH) {
            router.replace("/");
            return;
          }
          return;
        } catch (loadError) {
          const message = loadError instanceof Error ? loadError.message : "Failed to load page.";
          const isRetryable =
            attempt < SHELL_LOAD_MAX_ATTEMPTS &&
            (
              message === "Authentication required." ||
              message === "Failed to fetch" ||
              message === "Server disconnected. Please try again." ||
              message === "Request timed out. Check the backend and refresh."
            );
          if (isRetryable) {
            await delay(SHELL_LOAD_RETRY_DELAY_MS);
            continue;
          }
          if (isSessionErrorMessage(message)) {
            redirectToLogin(message);
            return;
          }
          setError(message);
          setIsAuthReady(true);
          return;
        }
      }
    })();

    bootstrapPromiseRef.current = task;
    try {
      await task;
    } finally {
      bootstrapPromiseRef.current = null;
    }
  }, [clinicSettings, currentUser, delay, pathname, redirectToLogin, router]);

  useEffect(() => {
    void loadShell(false);
  }, [loadShell]);

  const refreshShell = useCallback(async () => {
    await loadShell(true);
  }, [loadShell]);

  const applyClinicSettings = useCallback((settings: ClinicSettings) => {
    if (settings.clinic_specialty) {
      authStorage.setSpecialtyOnboardingPending(false);
    }
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
        setIsTrainingMode(false);
        hasBootstrappedRef.current = false;
        router.replace("/login");
      });
  }, [router]);

  const enterTrainingMode = useCallback(() => {
    writeTrainingMode(trainingScope, true);
    setIsTrainingMode(true);
    router.replace("/");
  }, [router, trainingScope]);

  const exitTrainingMode = useCallback(() => {
    writeTrainingMode(trainingScope, false);
    setIsTrainingMode(false);
  }, [trainingScope]);

  const resetTrainingMode = useCallback(() => {
    resetTrainingData(trainingScope);
  }, [trainingScope]);

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
    isTrainingMode,
    trainingScope,
    enterTrainingMode,
    exitTrainingMode,
    resetTrainingMode,
  }), [
    applyClinicSettings,
    applyCurrentUser,
    clinicSettings,
    currentUser,
    error,
    enterTrainingMode,
    exitTrainingMode,
    handleLogout,
    isAuthReady,
    isRedirectingToLogin,
    isTrainingMode,
    redirectToLogin,
    refreshShell,
    resetTrainingMode,
    trainingScope,
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
