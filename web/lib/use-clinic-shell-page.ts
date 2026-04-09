"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { authStorage } from "@/lib/auth";
import { AuditEvent, AuthUser, CatalogItem, ClinicSettings, Invoice } from "@/lib/types";

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
  payment_status: "paid";
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
  const router = useRouter();
  const canLoadPageDataRef = useRef(canLoadPageData);
  const loadPageDataRef = useRef(loadPageData);
  const onPageDataRef = useRef(onPageData);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [clinicSettings, setClinicSettings] = useState<ClinicSettings | null>(null);
  const [error, setError] = useState("");
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isRedirectingToLogin, setIsRedirectingToLogin] = useState(false);

  useEffect(() => {
    canLoadPageDataRef.current = canLoadPageData;
    loadPageDataRef.current = loadPageData;
    onPageDataRef.current = onPageData;
  }, [canLoadPageData, loadPageData, onPageData]);

  useEffect(() => {
    let active = true;

    async function loadApp() {
      const token = authStorage.getToken();
      if (!token) {
        if (active) {
          setIsRedirectingToLogin(true);
          setIsAuthReady(true);
        }
        router.replace("/login");
        return;
      }

      try {
        const [user, settings] = await Promise.all([
          api.getCurrentUser(),
          api.getClinicSettings(),
        ]);
        if (active) {
          setCurrentUser(user);
          setClinicSettings(settings);
        }

        if (canLoadPageDataRef.current && !canLoadPageDataRef.current(user)) {
          if (active) {
            setIsAuthReady(true);
          }
          return;
        }

        const pageData = await loadPageDataRef.current();
        if (active) {
          onPageDataRef.current(pageData);
          setIsAuthReady(true);
        }
      } catch (loadError) {
        if (active) {
          const message = loadError instanceof Error ? loadError.message : "Failed to load page.";
          const shouldRedirect =
            message === "Authentication required." ||
            message === "Invalid token." ||
            message === "Token expired." ||
            message === "Session expired.";
          if (shouldRedirect) {
            authStorage.clear();
            setError(message);
            setIsRedirectingToLogin(true);
            setIsAuthReady(true);
            router.replace("/login");
            return;
          }
          setError(message);
          setIsAuthReady(true);
        }
      }
    }

    loadApp();
    return () => {
      active = false;
    };
  }, [router]);

  const handleSaveClinicSettings = useCallback(async (
    payload: Omit<ClinicSettings, "id" | "org_id" | "updated_at">,
  ) => {
    const saved = await api.updateClinicSettings(payload);
    setClinicSettings(saved);
  }, []);

  const loadUsers = useCallback(async () => {
    const loadedUsers = await api.listUsers();
    setUsers(loadedUsers);
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

  const handleSendLetter = useCallback(async (payload: { recipient: string; content: string }) => {
    const response = await api.sendLetter(payload);
    return response.message;
  }, []);

  const handleSendInvoice = useCallback(async (payload: { invoice_id: string; recipient: string }) => {
    const response = await api.sendInvoice(payload);
    return response.message;
  }, []);

  const handleLogout = useCallback(() => {
    authStorage.clear();
    setIsRedirectingToLogin(true);
    router.replace("/login");
  }, [router]);

  return {
    currentUser,
    users,
    auditEvents,
    loadUsers,
    loadAuditEvents,
    catalogItems,
    loadCatalogItems,
    clinicSettings,
    error,
    setError,
    isAuthReady,
    isRedirectingToLogin,
    handleLogout,
    handleSaveClinicSettings,
    handleAddStaffUser,
    handleCreateCatalogItem,
    handleAdjustCatalogStock,
    handleDeleteCatalogItem,
    handleCreateInvoice,
    handleGenerateLetter,
    handleSendLetter,
    handleSendInvoice,
  };
}
