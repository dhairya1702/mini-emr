"use client";

import {
  createContext,
  Dispatch,
  ReactNode,
  SetStateAction,
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
import { requiresOnboarding } from "@/lib/onboarding";
import { createTrainingScope, readTrainingMode, resetTrainingData, writeTrainingMode } from "@/lib/training-mode";
import {
  AuthUser,
  CatalogItem,
  CatalogItemCreatePayload,
  CatalogItemUpdatePayload,
  ClinicSettings,
  DashboardStatus,
  MedicineCatalogItem,
  Patient,
  QueueSnapshot,
  QueueProvider,
  StaffUserCreatePayload,
  UserRole,
} from "@/lib/types";

const SESSION_EXPIRED_REDIRECT = "/login?reason=session-expired";
const PUBLIC_PATHS = new Set(["/login", "/follow-up", "/check-in", "/reset-password"]);
const SETUP_ONBOARDING_PATH = "/onboarding/setup";
const MOBILE_SETUP_ONBOARDING_PATH = "/m/onboarding/setup";
const SHELL_LOAD_MAX_ATTEMPTS = 2;
const SHELL_LOAD_RETRY_DELAY_MS = 350;
const SHARED_RESOURCE_TTL_MS = 5 * 60 * 1000;
const QUEUE_RESOURCE_TTL_MS = 30 * 1000;
const DASHBOARD_STATUS_TTL_MS = 15 * 1000;
const IDLE_WARNING_MS = 9 * 60 * 1000;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

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
  users: AuthUser[];
  catalogItems: CatalogItem[];
  activeMedicines: MedicineCatalogItem[];
  isUsersLoaded: boolean;
  isUsersLoading: boolean;
  usersError: string;
  isCatalogLoaded: boolean;
  isCatalogLoading: boolean;
  catalogError: string;
  isActiveMedicinesLoaded: boolean;
  isActiveMedicinesLoading: boolean;
  activeMedicinesError: string;
  loadUsers: (force?: boolean) => Promise<AuthUser[]>;
  loadCatalogItems: (force?: boolean) => Promise<CatalogItem[]>;
  loadActiveMedicines: (force?: boolean) => Promise<MedicineCatalogItem[]>;
  createStaffUser: (payload: StaffUserCreatePayload) => Promise<AuthUser>;
  updateUserRole: (userId: string, role: UserRole) => Promise<AuthUser>;
  deleteUser: (userId: string) => Promise<void>;
  uploadUserSignature: (userId: string, file: File) => Promise<AuthUser>;
  removeUserSignature: (userId: string) => Promise<AuthUser>;
  createCatalogItem: (payload: CatalogItemCreatePayload) => Promise<CatalogItem>;
  updateCatalogItem: (itemId: string, payload: CatalogItemUpdatePayload) => Promise<CatalogItem>;
  adjustCatalogStock: (itemId: string, delta: number) => Promise<CatalogItem>;
  deleteCatalogItem: (itemId: string) => Promise<void>;
  invalidateCatalog: (refresh?: boolean) => void;
  queuePatients: Patient[];
  queueProviders: QueueProvider[];
  queueRevision: string;
  isQueueLoaded: boolean;
  isQueueRefreshing: boolean;
  setQueuePatients: Dispatch<SetStateAction<Patient[]>>;
  applyQueueSnapshot: (snapshot: QueueSnapshot) => void;
  loadQueueSnapshot: (force?: boolean) => Promise<QueueSnapshot>;
  loadDashboardStatus: (force?: boolean) => Promise<DashboardStatus>;
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

function isPublicShellPath(pathname: string) {
  return (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/login/") ||
    pathname === "/superdashboard" ||
    pathname.startsWith("/superdashboard/") ||
    pathname === "/superuser" ||
    pathname.startsWith("/attachment-view")
  );
}

function toActiveMedicine(item: CatalogItem): MedicineCatalogItem | null {
  if (item.item_type !== "medicine" || item.is_active === false) return null;
  return {
    id: item.id,
    name: item.name,
    unit: item.unit,
    default_price: item.default_price,
    track_inventory: item.track_inventory,
    stock_quantity: item.stock_quantity,
  };
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
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [activeMedicines, setActiveMedicines] = useState<MedicineCatalogItem[]>([]);
  const [isUsersLoaded, setIsUsersLoaded] = useState(false);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [isCatalogLoaded, setIsCatalogLoaded] = useState(false);
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [isActiveMedicinesLoaded, setIsActiveMedicinesLoaded] = useState(false);
  const [isActiveMedicinesLoading, setIsActiveMedicinesLoading] = useState(false);
  const [activeMedicinesError, setActiveMedicinesError] = useState("");
  const [queuePatients, setQueuePatientsState] = useState<Patient[]>([]);
  const [queueProviders, setQueueProviders] = useState<QueueProvider[]>([]);
  const [queueRevision, setQueueRevision] = useState("");
  const [isQueueLoaded, setIsQueueLoaded] = useState(false);
  const [isQueueRefreshing, setIsQueueRefreshing] = useState(false);
  const [isIdleWarningOpen, setIsIdleWarningOpen] = useState(false);
  const hasBootstrappedRef = useRef(false);
  const bootstrapPromiseRef = useRef<Promise<void> | null>(null);
  const usersRef = useRef<AuthUser[]>([]);
  const catalogItemsRef = useRef<CatalogItem[]>([]);
  const activeMedicinesRef = useRef<MedicineCatalogItem[]>([]);
  const usersLoadedAtRef = useRef(0);
  const catalogLoadedAtRef = useRef(0);
  const activeMedicinesLoadedAtRef = useRef(0);
  const usersLoadPromiseRef = useRef<Promise<AuthUser[]> | null>(null);
  const catalogLoadPromiseRef = useRef<Promise<CatalogItem[]> | null>(null);
  const activeMedicinesLoadPromiseRef = useRef<Promise<MedicineCatalogItem[]> | null>(null);
  const resourceGenerationRef = useRef(0);
  const resourceOrgIdRef = useRef(currentUser?.org_id ?? "");
  const currentUserRef = useRef(currentUser);
  const queuePatientsRef = useRef<Patient[]>([]);
  const queueProvidersRef = useRef<QueueProvider[]>([]);
  const queueRevisionRef = useRef("");
  const queueLoadedAtRef = useRef(0);
  const queueGenerationRef = useRef(0);
  const queueLoadPromiseRef = useRef<Promise<QueueSnapshot> | null>(null);
  const dashboardStatusRef = useRef<DashboardStatus | null>(null);
  const dashboardStatusLoadedAtRef = useRef(0);
  const dashboardStatusPromiseRef = useRef<Promise<DashboardStatus> | null>(null);
  const idleWarningTimeoutRef = useRef<number | null>(null);
  const idleLogoutTimeoutRef = useRef<number | null>(null);
  const trainingScope = useMemo(() => createTrainingScope(currentUser), [currentUser]);
  const queueScopeRef = useRef("");

  const setQueuePatients: Dispatch<SetStateAction<Patient[]>> = useCallback((updater) => {
    setQueuePatientsState((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      queuePatientsRef.current = next;
      return next;
    });
  }, []);

  const applyQueueSnapshot = useCallback((snapshot: QueueSnapshot) => {
    queuePatientsRef.current = snapshot.patients;
    queueProvidersRef.current = snapshot.providers ?? [];
    queueRevisionRef.current = snapshot.revision;
    queueLoadedAtRef.current = Date.now();
    setQueuePatientsState(snapshot.patients);
    setQueueProviders(queueProvidersRef.current);
    setQueueRevision(snapshot.revision);
    setIsQueueLoaded(true);
  }, []);

  const clearQueueResource = useCallback(() => {
    queueGenerationRef.current += 1;
    queuePatientsRef.current = [];
    queueProvidersRef.current = [];
    setQueueProviders([]);
    queueRevisionRef.current = "";
    queueLoadedAtRef.current = 0;
    queueLoadPromiseRef.current = null;
    dashboardStatusRef.current = null;
    dashboardStatusLoadedAtRef.current = 0;
    dashboardStatusPromiseRef.current = null;
    setQueuePatientsState([]);
    setQueueRevision("");
    setIsQueueLoaded(false);
    setIsQueueRefreshing(false);
  }, []);

  const clearSharedResources = useCallback(() => {
    resourceGenerationRef.current += 1;
    clearQueueResource();
    usersRef.current = [];
    catalogItemsRef.current = [];
    activeMedicinesRef.current = [];
    usersLoadedAtRef.current = 0;
    catalogLoadedAtRef.current = 0;
    activeMedicinesLoadedAtRef.current = 0;
    usersLoadPromiseRef.current = null;
    catalogLoadPromiseRef.current = null;
    activeMedicinesLoadPromiseRef.current = null;
    setUsers([]);
    setCatalogItems([]);
    setActiveMedicines([]);
    setIsUsersLoaded(false);
    setIsCatalogLoaded(false);
    setIsActiveMedicinesLoaded(false);
    setIsUsersLoading(false);
    setIsCatalogLoading(false);
    setIsActiveMedicinesLoading(false);
    setUsersError("");
    setCatalogError("");
    setActiveMedicinesError("");
  }, [clearQueueResource]);

  useEffect(() => {
    currentUserRef.current = currentUser;
    const orgId = currentUser?.org_id ?? "";
    if (resourceOrgIdRef.current !== orgId) {
      resourceOrgIdRef.current = orgId;
      clearSharedResources();
    }
  }, [clearSharedResources, currentUser]);

  useEffect(() => {
    const scope = `${currentUser?.org_id ?? ""}:${isTrainingMode ? `training:${trainingScope ?? ""}` : "live"}`;
    if (queueScopeRef.current && queueScopeRef.current !== scope) clearQueueResource();
    queueScopeRef.current = scope;
  }, [clearQueueResource, currentUser?.org_id, isTrainingMode, trainingScope]);

  const delay = useCallback(async (ms: number) => {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  }, []);

  const redirectToLogin = useCallback((message: string) => {
    authStorage.clear();
    clearSharedResources();
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
  }, [clearSharedResources, router]);

  useEffect(() => {
    setIsTrainingMode(readTrainingMode(trainingScope));
  }, [trainingScope]);

  const loadShell = useCallback(async (force = false) => {
    if (isPublicShellPath(pathname)) {
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
          if (settings.clinic_specialty) {
            authStorage.setSpecialtyOnboardingPending(false);
          }
          setError("");
          setIsRedirectingToLogin(false);
          setIsAuthReady(true);
          hasBootstrappedRef.current = true;
          const shouldRunOnboarding = requiresOnboarding(settings);
          const isOnboardingPath = pathname.startsWith("/onboarding") || pathname.startsWith("/m/onboarding");
          const setupOnboardingPath = pathname.startsWith("/m") ? MOBILE_SETUP_ONBOARDING_PATH : SETUP_ONBOARDING_PATH;
          if (shouldRunOnboarding && pathname !== setupOnboardingPath) {
            router.replace(setupOnboardingPath);
            return;
          }
          if (!shouldRunOnboarding && isOnboardingPath) {
            router.replace(pathname.startsWith("/m") ? "/m" : "/");
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

  const loadQueueSnapshot = useCallback((force = false) => {
    const hasCachedSnapshot = Boolean(queueLoadedAtRef.current);
    if (
      !force
      && hasCachedSnapshot
      && Date.now() - queueLoadedAtRef.current < QUEUE_RESOURCE_TTL_MS
    ) {
      return Promise.resolve({
        revision: queueRevisionRef.current,
        patients: queuePatientsRef.current,
        providers: queueProvidersRef.current,
      });
    }
    if (queueLoadPromiseRef.current) return queueLoadPromiseRef.current;

    const generation = queueGenerationRef.current;
    setIsQueueRefreshing(true);
    const request = api.listQueuePatients()
      .then((snapshot) => {
        if (generation === queueGenerationRef.current) applyQueueSnapshot(snapshot);
        return snapshot;
      })
      .finally(() => {
        if (generation === queueGenerationRef.current) setIsQueueRefreshing(false);
        if (queueLoadPromiseRef.current === request) queueLoadPromiseRef.current = null;
      });
    queueLoadPromiseRef.current = request;
    return request;
  }, [applyQueueSnapshot]);

  const loadDashboardStatus = useCallback((force = false) => {
    const cached = dashboardStatusRef.current;
    if (
      !force
      && cached
      && Date.now() - dashboardStatusLoadedAtRef.current < DASHBOARD_STATUS_TTL_MS
    ) {
      return Promise.resolve(cached);
    }
    if (dashboardStatusPromiseRef.current) return dashboardStatusPromiseRef.current;

    const generation = queueGenerationRef.current;
    const request = api.getDashboardStatus()
      .then((status) => {
        if (generation === queueGenerationRef.current) {
          dashboardStatusRef.current = status;
          dashboardStatusLoadedAtRef.current = Date.now();
        }
        return status;
      })
      .finally(() => {
        if (dashboardStatusPromiseRef.current === request) dashboardStatusPromiseRef.current = null;
      });
    dashboardStatusPromiseRef.current = request;
    return request;
  }, []);

  const loadUsers = useCallback((force = false) => {
    if (!force && usersLoadedAtRef.current && Date.now() - usersLoadedAtRef.current < SHARED_RESOURCE_TTL_MS) {
      return Promise.resolve(usersRef.current);
    }
    if (usersLoadPromiseRef.current) return usersLoadPromiseRef.current;

    const generation = resourceGenerationRef.current;
    setIsUsersLoading(true);
    setUsersError("");
    const request = api.listUsers()
      .then((rows) => {
        if (generation === resourceGenerationRef.current) {
          usersRef.current = rows;
          usersLoadedAtRef.current = Date.now();
          setUsers(rows);
          setIsUsersLoaded(true);
        }
        return rows;
      })
      .catch((loadError) => {
        if (generation === resourceGenerationRef.current) {
          setUsersError(loadError instanceof Error ? loadError.message : "Failed to load users.");
        }
        throw loadError;
      })
      .finally(() => {
        if (generation === resourceGenerationRef.current) setIsUsersLoading(false);
        if (usersLoadPromiseRef.current === request) usersLoadPromiseRef.current = null;
      });
    usersLoadPromiseRef.current = request;
    return request;
  }, []);

  const loadCatalogItems = useCallback((force = false) => {
    if (!force && catalogLoadedAtRef.current && Date.now() - catalogLoadedAtRef.current < SHARED_RESOURCE_TTL_MS) {
      return Promise.resolve(catalogItemsRef.current);
    }
    if (catalogLoadPromiseRef.current) return catalogLoadPromiseRef.current;

    const generation = resourceGenerationRef.current;
    setIsCatalogLoading(true);
    setCatalogError("");
    const request = api.listCatalogItems()
      .then((rows) => {
        if (generation === resourceGenerationRef.current) {
          const medicines = rows.map(toActiveMedicine).filter((item): item is MedicineCatalogItem => item !== null);
          const now = Date.now();
          catalogItemsRef.current = rows;
          activeMedicinesRef.current = medicines;
          catalogLoadedAtRef.current = now;
          activeMedicinesLoadedAtRef.current = now;
          setCatalogItems(rows);
          setActiveMedicines(medicines);
          setIsCatalogLoaded(true);
          setIsActiveMedicinesLoaded(true);
          setActiveMedicinesError("");
        }
        return rows;
      })
      .catch((loadError) => {
        if (generation === resourceGenerationRef.current) {
          setCatalogError(loadError instanceof Error ? loadError.message : "Failed to load catalog.");
        }
        throw loadError;
      })
      .finally(() => {
        if (generation === resourceGenerationRef.current) setIsCatalogLoading(false);
        if (catalogLoadPromiseRef.current === request) catalogLoadPromiseRef.current = null;
      });
    catalogLoadPromiseRef.current = request;
    return request;
  }, []);

  const loadActiveMedicines = useCallback((force = false) => {
    const now = Date.now();
    if (!force && catalogLoadedAtRef.current && now - catalogLoadedAtRef.current < SHARED_RESOURCE_TTL_MS) {
      return Promise.resolve(activeMedicinesRef.current);
    }
    if (!force && activeMedicinesLoadedAtRef.current && now - activeMedicinesLoadedAtRef.current < SHARED_RESOURCE_TTL_MS) {
      return Promise.resolve(activeMedicinesRef.current);
    }
    if (activeMedicinesLoadPromiseRef.current) return activeMedicinesLoadPromiseRef.current;

    const generation = resourceGenerationRef.current;
    setIsActiveMedicinesLoading(true);
    setActiveMedicinesError("");
    const request = api.listActiveMedicines()
      .then((rows) => {
        if (generation === resourceGenerationRef.current) {
          activeMedicinesRef.current = rows;
          activeMedicinesLoadedAtRef.current = Date.now();
          setActiveMedicines(rows);
          setIsActiveMedicinesLoaded(true);
        }
        return rows;
      })
      .catch((loadError) => {
        if (generation === resourceGenerationRef.current) {
          setActiveMedicinesError(loadError instanceof Error ? loadError.message : "Failed to load medicines.");
        }
        throw loadError;
      })
      .finally(() => {
        if (generation === resourceGenerationRef.current) setIsActiveMedicinesLoading(false);
        if (activeMedicinesLoadPromiseRef.current === request) activeMedicinesLoadPromiseRef.current = null;
      });
    activeMedicinesLoadPromiseRef.current = request;
    return request;
  }, []);

  const patchLoadedUser = useCallback((updated: AuthUser) => {
    if (currentUserRef.current?.id === updated.id) {
      currentUserRef.current = updated;
      authStorage.setUser(updated);
      setCurrentUser(updated);
    }
    if (!usersLoadedAtRef.current) return;
    const next = usersRef.current.some((user) => user.id === updated.id)
      ? usersRef.current.map((user) => (user.id === updated.id ? updated : user))
      : [...usersRef.current, updated];
    usersRef.current = next;
    usersLoadedAtRef.current = Date.now();
    setUsers(next);
  }, []);

  const patchLoadedCatalogItem = useCallback((updated: CatalogItem) => {
    const now = Date.now();
    if (catalogLoadedAtRef.current) {
      const next = catalogItemsRef.current.some((item) => item.id === updated.id)
        ? catalogItemsRef.current.map((item) => (item.id === updated.id ? updated : item))
        : [...catalogItemsRef.current, updated];
      next.sort((left, right) => left.item_type.localeCompare(right.item_type) || left.name.localeCompare(right.name));
      catalogItemsRef.current = next;
      catalogLoadedAtRef.current = now;
      setCatalogItems(next);
    }
    if (activeMedicinesLoadedAtRef.current) {
      const medicine = toActiveMedicine(updated);
      const withoutUpdated = activeMedicinesRef.current.filter((item) => item.id !== updated.id);
      const next = medicine ? [...withoutUpdated, medicine].sort((left, right) => left.name.localeCompare(right.name)) : withoutUpdated;
      activeMedicinesRef.current = next;
      activeMedicinesLoadedAtRef.current = now;
      setActiveMedicines(next);
    }
  }, []);

  const createStaffUser = useCallback(async (payload: StaffUserCreatePayload) => {
    const created = await api.createStaffUser(payload);
    patchLoadedUser(created);
    return created;
  }, [patchLoadedUser]);

  const updateUserRole = useCallback(async (userId: string, role: UserRole) => {
    const updated = await api.updateUserRole(userId, { role });
    patchLoadedUser(updated);
    return updated;
  }, [patchLoadedUser]);

  const deleteUser = useCallback(async (userId: string) => {
    await api.deleteUser(userId);
    if (usersLoadedAtRef.current) {
      const next = usersRef.current.filter((user) => user.id !== userId);
      usersRef.current = next;
      usersLoadedAtRef.current = Date.now();
      setUsers(next);
    }
  }, []);

  const uploadUserSignature = useCallback(async (userId: string, file: File) => {
    const updated = await api.uploadUserSignature(userId, file);
    patchLoadedUser(updated);
    return updated;
  }, [patchLoadedUser]);

  const removeUserSignature = useCallback(async (userId: string) => {
    const updated = await api.removeUserSignature(userId);
    patchLoadedUser(updated);
    return updated;
  }, [patchLoadedUser]);

  const createCatalogItem = useCallback(async (payload: CatalogItemCreatePayload) => {
    const created = await api.createCatalogItem(payload);
    patchLoadedCatalogItem(created);
    return created;
  }, [patchLoadedCatalogItem]);

  const updateCatalogItem = useCallback(async (itemId: string, payload: CatalogItemUpdatePayload) => {
    const updated = await api.updateCatalogItem(itemId, payload);
    patchLoadedCatalogItem(updated);
    return updated;
  }, [patchLoadedCatalogItem]);

  const adjustCatalogStock = useCallback(async (itemId: string, delta: number) => {
    const updated = await api.updateCatalogStock(itemId, { delta });
    patchLoadedCatalogItem(updated);
    return updated;
  }, [patchLoadedCatalogItem]);

  const deleteCatalogItem = useCallback(async (itemId: string) => {
    await api.deleteCatalogItem(itemId);
    const now = Date.now();
    if (catalogLoadedAtRef.current) {
      const next = catalogItemsRef.current.filter((item) => item.id !== itemId);
      catalogItemsRef.current = next;
      catalogLoadedAtRef.current = now;
      setCatalogItems(next);
    }
    if (activeMedicinesLoadedAtRef.current) {
      const next = activeMedicinesRef.current.filter((item) => item.id !== itemId);
      activeMedicinesRef.current = next;
      activeMedicinesLoadedAtRef.current = now;
      setActiveMedicines(next);
    }
  }, []);

  const invalidateCatalog = useCallback((refresh = false) => {
    const hadFullCatalog = Boolean(catalogLoadedAtRef.current);
    catalogLoadedAtRef.current = 0;
    activeMedicinesLoadedAtRef.current = 0;
    if (refresh && hadFullCatalog) void loadCatalogItems(true).catch(() => undefined);
  }, [loadCatalogItems]);

  const applyClinicSettings = useCallback((settings: ClinicSettings) => {
    if (settings.clinic_specialty) {
      authStorage.setSpecialtyOnboardingPending(false);
    }
    setClinicSettings(settings);
  }, []);

  const applyCurrentUser = useCallback((user: AuthUser | null) => {
    authStorage.setUser(user);
    setCurrentUser(user);
    if (user) patchLoadedUser(user);
  }, [patchLoadedUser]);

  const handleLogout = useCallback(() => {
    setIsRedirectingToLogin(true);
    const loginPath = pathname.startsWith("/m") ? "/login/m" : "/login";
    void api.logout().catch(() => undefined);
    authStorage.clear();
    clearSharedResources();
    setCurrentUser(null);
    setClinicSettings(null);
    setIsTrainingMode(false);
    hasBootstrappedRef.current = false;
    window.location.replace(loginPath);
  }, [clearSharedResources, pathname]);

  useEffect(() => {
    if (!currentUser || isRedirectingToLogin || isPublicShellPath(pathname)) {
      setIsIdleWarningOpen(false);
      if (idleWarningTimeoutRef.current !== null) {
        window.clearTimeout(idleWarningTimeoutRef.current);
        idleWarningTimeoutRef.current = null;
      }
      if (idleLogoutTimeoutRef.current !== null) {
        window.clearTimeout(idleLogoutTimeoutRef.current);
        idleLogoutTimeoutRef.current = null;
      }
      return;
    }

    function clearIdleTimers() {
      if (idleWarningTimeoutRef.current !== null) {
        window.clearTimeout(idleWarningTimeoutRef.current);
        idleWarningTimeoutRef.current = null;
      }
      if (idleLogoutTimeoutRef.current !== null) {
        window.clearTimeout(idleLogoutTimeoutRef.current);
        idleLogoutTimeoutRef.current = null;
      }
    }

    function scheduleIdleTimers() {
      clearIdleTimers();
      idleWarningTimeoutRef.current = window.setTimeout(() => {
        setIsIdleWarningOpen(true);
      }, IDLE_WARNING_MS);
      idleLogoutTimeoutRef.current = window.setTimeout(() => {
        handleLogout();
      }, IDLE_TIMEOUT_MS);
    }

    function recordActivity() {
      if (document.visibilityState === "hidden") {
        return;
      }
      setIsIdleWarningOpen(false);
      scheduleIdleTimers();
    }

    const activityEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
      "focus",
    ];

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, recordActivity, { passive: true });
    });
    document.addEventListener("visibilitychange", recordActivity);
    scheduleIdleTimers();

    return () => {
      clearIdleTimers();
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, recordActivity);
      });
      document.removeEventListener("visibilitychange", recordActivity);
    };
  }, [currentUser, handleLogout, isRedirectingToLogin, pathname]);

  const staySignedIn = useCallback(() => {
    setIsIdleWarningOpen(false);
    window.dispatchEvent(new Event("focus"));
  }, []);

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
    users,
    catalogItems,
    activeMedicines,
    isUsersLoaded,
    isUsersLoading,
    usersError,
    isCatalogLoaded,
    isCatalogLoading,
    catalogError,
    isActiveMedicinesLoaded,
    isActiveMedicinesLoading,
    activeMedicinesError,
    loadUsers,
    loadCatalogItems,
    loadActiveMedicines,
    createStaffUser,
    updateUserRole,
    deleteUser,
    uploadUserSignature,
    removeUserSignature,
    createCatalogItem,
    updateCatalogItem,
    adjustCatalogStock,
    deleteCatalogItem,
    invalidateCatalog,
    queuePatients,
    queueProviders,
    queueRevision,
    isQueueLoaded,
    isQueueRefreshing,
    setQueuePatients,
    applyQueueSnapshot,
    loadQueueSnapshot,
    loadDashboardStatus,
  }), [
    activeMedicines,
    activeMedicinesError,
    adjustCatalogStock,
    applyClinicSettings,
    applyCurrentUser,
    applyQueueSnapshot,
    catalogError,
    catalogItems,
    clinicSettings,
    createCatalogItem,
    createStaffUser,
    currentUser,
    deleteCatalogItem,
    deleteUser,
    error,
    enterTrainingMode,
    exitTrainingMode,
    handleLogout,
    isAuthReady,
    isActiveMedicinesLoaded,
    isActiveMedicinesLoading,
    isCatalogLoaded,
    isCatalogLoading,
    isRedirectingToLogin,
    isQueueLoaded,
    isQueueRefreshing,
    isTrainingMode,
    isUsersLoaded,
    isUsersLoading,
    invalidateCatalog,
    loadActiveMedicines,
    loadCatalogItems,
    loadDashboardStatus,
    loadQueueSnapshot,
    loadUsers,
    removeUserSignature,
    redirectToLogin,
    refreshShell,
    resetTrainingMode,
    queuePatients,
    queueProviders,
    queueRevision,
    setQueuePatients,
    trainingScope,
    updateCatalogItem,
    updateUserRole,
    uploadUserSignature,
    users,
    usersError,
  ]);

  return (
    <ClinicShellContext.Provider value={value}>
      {children}
      {isIdleWarningOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="idle-timeout-title"
            className="w-full max-w-sm rounded-[20px] border border-[#dbe7ef] bg-white p-5 text-slate-900 shadow-[0_30px_90px_rgba(15,23,42,0.24)]"
          >
            <h2 id="idle-timeout-title" className="text-lg font-bold text-[#1f2b3d]">You&apos;ll be signed out in 1 minute.</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              For patient privacy, ClinicOS signs out after 10 minutes without activity.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center justify-center rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
              >
                Sign out
              </button>
              <button
                type="button"
                onClick={staySignedIn}
                autoFocus
                className="inline-flex items-center justify-center rounded-xl bg-[#2f8fd3] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#287fc0]"
              >
                Stay signed in
              </button>
            </div>
          </section>
        </div>
      ) : null}
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
