"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { api } from "@/lib/api";
import { AuditEvent, AuthUser, ClinicSettings, ClinicSettingsUpdatePayload, Invoice, InvoiceActionResult, StaffUserCreatePayload, UserRole } from "@/lib/types";

const PAGE_LOAD_RETRY_DELAY_MS = 400;
const PAGE_LOAD_MAX_ATTEMPTS = 2;

export type ClinicCatalogItemPayload = {
  name: string;
  item_type: "service" | "medicine" | "program";
  default_price: number;
  track_inventory: boolean;
  stock_quantity: number;
  low_stock_threshold: number;
  unit: string;
  hsn_sac_code?: string;
  gst_rate?: number | null;
  aliases?: string[];
};

export type ClinicInvoicePayload = {
  invoice_id?: string | null;
  patient_id: string;
  items: Array<{
    catalog_item_id?: string | null;
    item_type: "service" | "medicine" | "program";
    label: string;
    quantity: number;
    unit_price: number;
  }>;
  payment_status: "unpaid" | "paid" | "partial";
  amount_paid?: number | null;
};

type UseClinicShellPageOptions<T> = {
  canLoadPageData?: (currentUser: AuthUser) => boolean;
  loadPageData: (context: {
    currentUser: AuthUser;
    isTrainingMode: boolean;
    trainingScope: string | null;
  }) => Promise<T>;
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
    isTrainingMode,
    users,
    catalogItems,
    loadUsers,
    loadCatalogItems,
    isUsersLoaded,
    isUsersLoading,
    usersError,
    isCatalogLoaded,
    isCatalogLoading,
    catalogError,
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
    refreshShell,
    redirectToLogin,
    trainingScope,
  } = shell;
  const canLoadPageDataRef = useRef(canLoadPageData);
  const loadPageDataRef = useRef(loadPageData);
  const onPageDataRef = useRef(onPageData);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [pageError, setPageError] = useState("");
  const [isPageDataLoaded, setIsPageDataLoaded] = useState(false);

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
            const pageData = await loadPageDataRef.current({
              currentUser,
              isTrainingMode,
              trainingScope,
            });
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
  }, [currentUser, isAuthReady, isRedirectingToLogin, isTrainingMode, redirectToLogin, refreshShell, trainingScope]);

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

  const loadAuditEvents = useCallback(async () => {
    const loadedAuditEvents = await api.listAuditEvents();
    setAuditEvents(loadedAuditEvents);
    return loadedAuditEvents;
  }, []);

  const handleAddStaffUser = useCallback(async (payload: StaffUserCreatePayload) => {
    await createStaffUser(payload);
    const refreshedSettings = await api.getClinicSettings();
    applyShellClinicSettings(refreshedSettings);
  }, [applyShellClinicSettings, createStaffUser]);

  const handleUpdateUserRole = useCallback(async (userId: string, role: UserRole) => {
    return updateUserRole(userId, role);
  }, [updateUserRole]);

  const handleDeleteUser = useCallback(async (userId: string) => {
    await deleteUser(userId);
  }, [deleteUser]);

  const handleUploadUserSignature = useCallback(async (userId: string, file: File) => {
    return uploadUserSignature(userId, file);
  }, [uploadUserSignature]);

  const handleRemoveUserSignature = useCallback(async (userId: string) => {
    return removeUserSignature(userId);
  }, [removeUserSignature]);

  const handleCreateCatalogItem = useCallback(async (payload: ClinicCatalogItemPayload) => {
    await createCatalogItem(payload);
  }, [createCatalogItem]);

  const handleAdjustCatalogStock = useCallback(async (itemId: string, delta: number) => {
    await adjustCatalogStock(itemId, delta);
  }, [adjustCatalogStock]);

  const handleUpdateCatalogItem = useCallback(async (
    itemId: string,
    payload: Omit<ClinicCatalogItemPayload, "stock_quantity">,
  ) => {
    return updateCatalogItem(itemId, payload);
  }, [updateCatalogItem]);

  const handleDeleteCatalogItem = useCallback(async (itemId: string) => {
    await deleteCatalogItem(itemId);
  }, [deleteCatalogItem]);

  const handleCreateInvoice = useCallback(async (payload: ClinicInvoicePayload): Promise<Invoice> => {
    return api.createInvoice(payload);
  }, []);

  const handleFinalizeInvoice = useCallback(async (payload: { invoice_id: string }): Promise<InvoiceActionResult> => {
    const result = await api.finalizeInvoice(payload);
    invalidateCatalog(true);
    return result;
  }, [invalidateCatalog]);

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

  const handleSendLetterWhatsApp = useCallback(
    async (payload: { recipient_phone: string; recipient_name: string; subject: string; content: string }) =>
      api.sendLetterWhatsApp(payload),
    [],
  );

  const handleSendInvoice = useCallback(async (payload: { invoice_id: string; recipient_email: string }): Promise<InvoiceActionResult> => {
    return api.sendInvoice(payload);
  }, []);

  const handleSendInvoiceWhatsApp = useCallback(async (payload: { invoice_id: string; recipient_phone?: string | null }): Promise<InvoiceActionResult> => {
    return api.sendInvoiceWhatsApp(payload);
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
    isUsersLoading,
    usersError,
    isCatalogLoaded,
    isCatalogLoading,
    catalogError,
    isTrainingMode,
    trainingScope,
    enterTrainingMode: shell.enterTrainingMode,
    exitTrainingMode: shell.exitTrainingMode,
    resetTrainingMode: shell.resetTrainingMode,
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
    handleUpdateCatalogItem,
    handleAdjustCatalogStock,
    handleDeleteCatalogItem,
    handleCreateInvoice,
    handleFinalizeInvoice,
    handleGenerateLetter,
    handleSendLetter,
    handleSendLetterWhatsApp,
    handleSendInvoice,
    handleSendInvoiceWhatsApp,
    handleExportPatientsCsv,
    handleExportVisitsCsv,
    handleExportInvoicesCsv,
  };
}
