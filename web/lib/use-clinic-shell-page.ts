"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { api } from "@/lib/api";
import { AuditEvent, AuthUser, CatalogItem, ClinicSettings, ClinicSettingsUpdatePayload, Invoice } from "@/lib/types";

const PAGE_LOAD_RETRY_DELAY_MS = 400;
const PAGE_LOAD_MAX_ATTEMPTS = 2;

export type ClinicCatalogItemPayload = {
  name: string;
  item_type: "service" | "medicine";
  default_price: number;
  track_inventory: boolean;
  stock_quantity: number;
  low_stock_threshold: number;
  unit: string;
};

export type ClinicInvoicePayload = {
  patient_id: string;
  items: Array<{
    catalog_item_id?: string | null;
    item_type: "service" | "medicine";
    label: string;
    quantity: number;
    unit_price: number;
  }>;
  payment_status: "unpaid" | "paid" | "partial";
  amount_paid?: number | null;
};

type UseClinicShellPageOptions<T> = {
  canLoadPageData?: (currentUser: AuthUser) => boolean;
  loadPageData: () => Promise<T>;
  onPageData: (data: T) => void;
};

export function useClinicShellPage<T>({
  canLoadPageData,
  loadPageData,
  onPageData,
}: UseClinicShellPageOptions<T>) {
  const shell = useClinicShell();
  const {
    applyClinicSettings: applyShellClinicSettings,
    applyCurrentUser: applyShellCurrentUser,
    clinicSettings,
    currentUser,
    error: shellError,
    handleLogout: handleShellLogout,
    isAuthReady,
    isRedirectingToLogin,
    refreshShell,
    redirectToLogin,
  } = shell;
  const canLoadPageDataRef = useRef(canLoadPageData);
  const loadPageDataRef = useRef(loadPageData);
  const onPageDataRef = useRef(onPageData);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [pageError, setPageError] = useState("");
  const [isPageDataLoaded, setIsPageDataLoaded] = useState(false);
  const [isUsersLoaded, setIsUsersLoaded] = useState(false);

  useEffect(() => {
    canLoadPageDataRef.current = canLoadPageData;
    loadPageDataRef.current = loadPageData;
    onPageDataRef.current = onPageData;
  }, [canLoadPageData, loadPageData, onPageData]);

  useEffect(() => {
    let active = true;

    async function delay(ms: number) {
      await new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    async function loadApp() {
      if (!isAuthReady || isRedirectingToLogin || !currentUser) {
        return;
      }

      if (canLoadPageDataRef.current && !canLoadPageDataRef.current(currentUser)) {
        return;
      }

      if (active) {
        setPageError("");
        setIsPageDataLoaded(false);
      }

      try {
        for (let attempt = 1; attempt <= PAGE_LOAD_MAX_ATTEMPTS; attempt += 1) {
          try {
            const pageData = await loadPageDataRef.current();
            if (active) {
              onPageDataRef.current(pageData);
              setIsPageDataLoaded(true);
            }
            return;
          } catch (loadError) {
            const message = loadError instanceof Error ? loadError.message : "Failed to load page.";
            const shouldRedirect =
              message === "Invalid token." ||
              message === "Token expired." ||
              message === "Session expired.";
            if (shouldRedirect) {
              redirectToLogin(message);
              return;
            }

            const isRetryable =
              attempt < PAGE_LOAD_MAX_ATTEMPTS &&
              (message === "Request timed out. Check the backend and refresh." ||
                message === "Failed to fetch" ||
                message === "Server disconnected. Please try again." ||
                message === "Authentication required.");
            if (!isRetryable) {
              throw loadError;
            }

            if (message === "Authentication required.") {
              await refreshShell();
            }
            await delay(PAGE_LOAD_RETRY_DELAY_MS);
          }
        }
      } catch (loadError) {
        if (active) {
          const message = loadError instanceof Error ? loadError.message : "Failed to load page.";
          const shouldRedirect =
            message === "Invalid token." ||
            message === "Token expired." ||
            message === "Session expired.";
          if (shouldRedirect) {
            redirectToLogin(message);
            return;
          }
          setPageError(message);
        }
      }
    }

    void loadApp();
    return () => {
      active = false;
    };
  }, [currentUser, isAuthReady, isRedirectingToLogin, redirectToLogin, refreshShell]);

  const handleSaveClinicSettings = useCallback(async (
    payload: ClinicSettingsUpdatePayload,
  ) => {
    const saved = await api.updateClinicSettings(payload);
    applyShellClinicSettings(saved);
    return saved;
  }, [applyShellClinicSettings]);

  const applyClinicSettings = useCallback((settings: ClinicSettings) => {
    applyShellClinicSettings(settings);
  }, [applyShellClinicSettings]);

  const applyCurrentUser = useCallback((user: AuthUser | null) => {
    applyShellCurrentUser(user);
  }, [applyShellCurrentUser]);

  const loadUsers = useCallback(async () => {
    const loadedUsers = await api.listUsers();
    setUsers(loadedUsers);
    setIsUsersLoaded(true);
    return loadedUsers;
  }, []);

  const loadAuditEvents = useCallback(async () => {
    const loadedAuditEvents = await api.listAuditEvents();
    setAuditEvents(loadedAuditEvents);
    return loadedAuditEvents;
  }, []);

  const handleAddStaffUser = useCallback(async (payload: { identifier: string; password: string }) => {
    const created = await api.createStaffUser(payload);
    setUsers((current) => [...current, created]);
    setIsUsersLoaded(true);
  }, []);

  const handleUpdateUserRole = useCallback(async (userId: string, role: "admin" | "staff") => {
    const updated = await api.updateUserRole(userId, { role });
    setUsers((current) => current.map((user) => (user.id === userId ? updated : user)));
    setIsUsersLoaded(true);
    return updated;
  }, []);

  const handleDeleteUser = useCallback(async (userId: string) => {
    await api.deleteUser(userId);
    setUsers((current) => current.filter((user) => user.id !== userId));
    setIsUsersLoaded(true);
  }, []);

  const handleUploadUserSignature = useCallback(async (userId: string, file: File) => {
    const updated = await api.uploadUserSignature(userId, file);
    setUsers((current) => current.map((user) => (user.id === userId ? updated : user)));
    setIsUsersLoaded(true);
    return updated;
  }, []);

  const handleRemoveUserSignature = useCallback(async (userId: string) => {
    const updated = await api.removeUserSignature(userId);
    setUsers((current) => current.map((user) => (user.id === userId ? updated : user)));
    setIsUsersLoaded(true);
    return updated;
  }, []);

  const loadCatalogItems = useCallback(async () => {
    const loadedCatalogItems = await api.listCatalogItems();
    setCatalogItems(loadedCatalogItems);
    return loadedCatalogItems;
  }, []);

  const handleCreateCatalogItem = useCallback(async (payload: ClinicCatalogItemPayload) => {
    const created = await api.createCatalogItem(payload);
    setCatalogItems((current) =>
      [...current, created].sort((left, right) => left.name.localeCompare(right.name)),
    );
  }, []);

  const handleAdjustCatalogStock = useCallback(async (itemId: string, delta: number) => {
    const updated = await api.updateCatalogStock(itemId, { delta });
    setCatalogItems((current) =>
      current.map((item) => (item.id === itemId ? updated : item)),
    );
  }, []);

  const handleDeleteCatalogItem = useCallback(async (itemId: string) => {
    await api.deleteCatalogItem(itemId);
    setCatalogItems((current) => current.filter((item) => item.id !== itemId));
  }, []);

  const handleCreateInvoice = useCallback(async (payload: ClinicInvoicePayload): Promise<Invoice> => {
    return api.createInvoice(payload);
  }, []);

  const handleGenerateLetter = useCallback(async (payload: {
    to: string;
    subject: string;
    content: string;
  }) => {
    const response = await api.generateLetter(payload);
    return response.content;
  }, []);

  const handleSendLetter = useCallback(async (payload: { recipient_email: string; subject: string; content: string }) => {
    const response = await api.sendLetter(payload);
    return response.message;
  }, []);

  const handleSendInvoice = useCallback(async (payload: { invoice_id: string; recipient_email: string }) => {
    const response = await api.sendInvoice(payload);
    return response.message;
  }, []);

  const handleExportPatientsCsv = useCallback(async () => api.exportPatientsCsv(), []);
  const handleExportVisitsCsv = useCallback(async (
    params?: { range?: "today" | "7d" | "30d" | "month" | "all" },
  ) => api.exportVisitsCsv(params), []);
  const handleExportInvoicesCsv = useCallback(async () => api.exportInvoicesCsv(), []);

  const handleLogout = useCallback(() => {
    handleShellLogout();
  }, [handleShellLogout]);

  return {
    currentUser,
    users,
    auditEvents,
    loadUsers,
    loadAuditEvents,
    catalogItems,
    loadCatalogItems,
    clinicSettings,
    error: shellError || pageError,
    setError: setPageError,
    isAuthReady,
    isRedirectingToLogin,
    isPageDataLoaded,
    isUsersLoaded,
    handleLogout,
    handleSaveClinicSettings,
    applyClinicSettings,
    applyCurrentUser,
    handleAddStaffUser,
    handleUpdateUserRole,
    handleDeleteUser,
    handleUploadUserSignature,
    handleRemoveUserSignature,
    handleCreateCatalogItem,
    handleAdjustCatalogStock,
    handleDeleteCatalogItem,
    handleCreateInvoice,
    handleGenerateLetter,
    handleSendLetter,
    handleSendInvoice,
    handleExportPatientsCsv,
    handleExportVisitsCsv,
    handleExportInvoicesCsv,
  };
}
