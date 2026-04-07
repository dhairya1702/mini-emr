"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { authStorage } from "@/lib/auth";
import { AuthUser, CatalogItem, ClinicSettings, Invoice } from "@/lib/types";

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
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [clinicSettings, setClinicSettings] = useState<ClinicSettings | null>(null);
  const [error, setError] = useState("");
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isRedirectingToLogin, setIsRedirectingToLogin] = useState(false);

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

        if (canLoadPageData && !canLoadPageData(user)) {
          if (active) {
            setIsAuthReady(true);
          }
          return;
        }

        const pageData = await loadPageData();
        if (active) {
          onPageData(pageData);
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
  }, [canLoadPageData, loadPageData, onPageData, router]);

  async function handleSaveClinicSettings(
    payload: Omit<ClinicSettings, "id" | "org_id" | "updated_at">,
  ) {
    const saved = await api.updateClinicSettings(payload);
    setClinicSettings(saved);
  }

  async function loadUsers() {
    const loadedUsers = await api.listUsers();
    setUsers(loadedUsers);
    return loadedUsers;
  }

  async function handleAddStaffUser(payload: { identifier: string; password: string }) {
    const created = await api.createStaffUser(payload);
    setUsers((current) => [...current, created]);
  }

  async function loadCatalogItems() {
    const loadedCatalogItems = await api.listCatalogItems();
    setCatalogItems(loadedCatalogItems);
    return loadedCatalogItems;
  }

  async function handleCreateCatalogItem(payload: ClinicCatalogItemPayload) {
    const created = await api.createCatalogItem(payload);
    setCatalogItems((current) =>
      [...current, created].sort((left, right) => left.name.localeCompare(right.name)),
    );
  }

  async function handleAdjustCatalogStock(itemId: string, delta: number) {
    const updated = await api.updateCatalogStock(itemId, { delta });
    setCatalogItems((current) =>
      current.map((item) => (item.id === itemId ? updated : item)),
    );
  }

  async function handleDeleteCatalogItem(itemId: string) {
    await api.deleteCatalogItem(itemId);
    setCatalogItems((current) => current.filter((item) => item.id !== itemId));
  }

  async function handleCreateInvoice(payload: ClinicInvoicePayload): Promise<Invoice> {
    return api.createInvoice(payload);
  }

  async function handleGenerateLetter(payload: {
    to: string;
    subject: string;
    content: string;
  }) {
    const response = await api.generateLetter(payload);
    return response.content;
  }

  async function handleSendLetter(payload: { recipient: string; content: string }) {
    const response = await api.sendLetter(payload);
    return response.message;
  }

  async function handleSendInvoice(payload: { invoice_id: string; recipient: string }) {
    const response = await api.sendInvoice(payload);
    return response.message;
  }

  function handleLogout() {
    authStorage.clear();
    setIsRedirectingToLogin(true);
    router.replace("/login");
  }

  return {
    currentUser,
    users,
    loadUsers,
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
