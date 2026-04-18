"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { SettingsDrawer } from "@/components/settings-drawer";
import { CatalogFormState, SettingsDrawerInventoryPanel } from "@/components/settings-drawer-inventory-panel";
import { api } from "@/lib/api";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { Patient } from "@/lib/types";

export default function InventoryPage() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [catalogForm, setCatalogForm] = useState<CatalogFormState>({
    name: "",
    item_type: "service",
    default_price: "",
    track_inventory: false,
    stock_quantity: "",
    low_stock_threshold: "",
    unit: "",
  });
  const [catalogError, setCatalogError] = useState("");
  const [catalogStatus, setCatalogStatus] = useState("");
  const [isSavingCatalog, setIsSavingCatalog] = useState(false);
  const [stockAdjustments, setStockAdjustments] = useState<Record<string, string>>({});
  const [adjustingStockId, setAdjustingStockId] = useState("");
  const [deletingCatalogId, setDeletingCatalogId] = useState("");
  const canLoadAdminPageData = useCallback((user: { role: "admin" | "staff" }) => user.role === "admin", []);
  const loadPageData = useCallback(() => api.listPatients(), []);
  const onPageData = useCallback((data: Patient[]) => {
    setPatients(data);
  }, []);
  const {
    currentUser,
    users,
    auditEvents,
    loadUsers,
    loadAuditEvents,
    catalogItems,
    loadCatalogItems,
    clinicSettings,
    error,
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
    handleExportPatientsCsv,
    handleExportVisitsCsv,
    handleExportInvoicesCsv,
  } = useClinicShellPage({
    canLoadPageData: canLoadAdminPageData,
    loadPageData,
    onPageData,
  });
  const clinicName = clinicSettings?.clinic_name || "ClinicOS";

  useEffect(() => {
    if (isAuthReady && currentUser?.role === "staff") {
      router.replace("/");
    }
  }, [currentUser, isAuthReady, router]);

  useEffect(() => {
    if (isAuthReady && currentUser?.role === "admin") {
      void loadCatalogItems();
    }
  }, [currentUser, isAuthReady, loadCatalogItems]);

  async function handleSaveCatalogItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCatalogError("");
    setCatalogStatus("");
    const price = Number(catalogForm.default_price);
    const stockQuantity = Number(catalogForm.stock_quantity || "0");
    const lowStockThreshold = Number(catalogForm.low_stock_threshold || "0");
    if (!catalogForm.name.trim()) {
      setCatalogError("Name is required.");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setCatalogError("Enter a valid price.");
      return;
    }
    if (catalogForm.track_inventory && (!Number.isFinite(stockQuantity) || stockQuantity < 0)) {
      setCatalogError("Enter a valid stock quantity.");
      return;
    }
    if (catalogForm.track_inventory && (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0)) {
      setCatalogError("Enter a valid low-stock threshold.");
      return;
    }
    setIsSavingCatalog(true);
    try {
      await handleCreateCatalogItem({
        name: catalogForm.name.trim(),
        item_type: catalogForm.item_type,
        default_price: price,
        track_inventory: catalogForm.track_inventory,
        stock_quantity: catalogForm.track_inventory ? stockQuantity : 0,
        low_stock_threshold: catalogForm.track_inventory ? lowStockThreshold : 0,
        unit: catalogForm.unit.trim(),
      });
      setCatalogStatus(catalogForm.item_type === "service" ? "Service saved." : "Medicine saved.");
      setCatalogForm({
        name: "",
        item_type: catalogForm.item_type,
        default_price: "",
        track_inventory: catalogForm.item_type === "medicine",
        stock_quantity: "",
        low_stock_threshold: "",
        unit: "",
      });
    } catch (saveError) {
      setCatalogError(saveError instanceof Error ? saveError.message : "Failed to save catalog item.");
    } finally {
      setIsSavingCatalog(false);
    }
  }

  async function handleAdjustStock(itemId: string) {
    const raw = stockAdjustments[itemId] ?? "";
    const delta = Number(raw);
    if (!Number.isFinite(delta) || delta === 0) {
      setCatalogError("Enter a stock adjustment other than zero.");
      return;
    }
    setAdjustingStockId(itemId);
    setCatalogError("");
    setCatalogStatus("");
    try {
      await handleAdjustCatalogStock(itemId, delta);
      setStockAdjustments((current) => ({ ...current, [itemId]: "" }));
      setCatalogStatus(delta > 0 ? "Stock increased." : "Stock reduced.");
    } catch (adjustError) {
      setCatalogError(adjustError instanceof Error ? adjustError.message : "Failed to adjust stock.");
    } finally {
      setAdjustingStockId("");
    }
  }

  async function handleDeleteCatalog(itemId: string) {
    setDeletingCatalogId(itemId);
    setCatalogError("");
    setCatalogStatus("");
    try {
      await handleDeleteCatalogItem(itemId);
      setCatalogStatus("Inventory item removed.");
    } catch (deleteError) {
      setCatalogError(deleteError instanceof Error ? deleteError.message : "Failed to remove inventory item.");
    } finally {
      setDeletingCatalogId("");
    }
  }

  if (isRedirectingToLogin) return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_20px_60px_rgba(125,211,252,0.18)]">Redirecting to login...</div></main>;
  if (!isAuthReady) return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_20px_60px_rgba(125,211,252,0.18)]">Loading ClinicOS...</div></main>;
  if (currentUser?.role === "staff") return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_20px_60px_rgba(125,211,252,0.18)]">Redirecting to queue...</div></main>;

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px]">
        <AppHeader clinicName={clinicName} currentUser={currentUser} active="inventory" onOpenSettings={() => setIsSettingsOpen(true)} onLogout={handleLogout} />
        {error ? <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        <SettingsDrawerInventoryPanel
          currentUser={currentUser}
          catalogForm={catalogForm}
          catalogError={catalogError}
          catalogStatus={catalogStatus}
          isSavingCatalog={isSavingCatalog}
          serviceItems={catalogItems.filter((item) => item.item_type === "service")}
          medicineItems={catalogItems.filter((item) => item.item_type === "medicine")}
          stockAdjustments={stockAdjustments}
          adjustingStockId={adjustingStockId}
          deletingCatalogId={deletingCatalogId}
          onSubmit={handleSaveCatalogItem}
          onCatalogFormChange={(patch) => setCatalogForm((current) => ({ ...current, ...patch }))}
          onStockAdjustmentChange={(itemId, value) => setStockAdjustments((current) => ({ ...current, [itemId]: value }))}
          onAdjustStock={handleAdjustStock}
          onDeleteCatalogItem={handleDeleteCatalog}
        />
      </div>
      <SettingsDrawer
        open={isSettingsOpen}
        settings={clinicSettings}
        currentUser={currentUser}
        users={users}
        onLoadUsers={loadUsers}
        auditEvents={auditEvents}
        onLoadAuditEvents={loadAuditEvents}
        patients={patients.filter((patient) => patient.status === "done" && !patient.billed)}
        catalogItems={catalogItems}
        onLoadCatalogItems={loadCatalogItems}
        onClose={() => setIsSettingsOpen(false)}
        onSaveClinic={handleSaveClinicSettings}
        onAddUser={handleAddStaffUser}
        onCreateCatalogItem={handleCreateCatalogItem}
        onAdjustCatalogStock={handleAdjustCatalogStock}
        onDeleteCatalogItem={handleDeleteCatalogItem}
        onGenerateLetter={handleGenerateLetter}
        onGenerateLetterPdf={(payload) => api.generateLetterPdf(payload)}
        onSendLetter={handleSendLetter}
        onCreateInvoice={handleCreateInvoice}
        onGenerateInvoicePdf={(invoiceId) => api.generateInvoicePdf(invoiceId)}
        onSendInvoice={handleSendInvoice}
        onExportPatientsCsv={handleExportPatientsCsv}
        onExportVisitsCsv={handleExportVisitsCsv}
        onExportInvoicesCsv={handleExportInvoicesCsv}
        onCheckInAppointment={async (appointmentId, options) => {
          const checkedInPatient = options?.existingPatientId ? await api.checkInAppointmentWithPatient(appointmentId, options.existingPatientId) : await api.checkInAppointment(appointmentId, { force_new: options?.forceNew });
          setPatients((current) => [checkedInPatient, ...current.filter((patient) => patient.id !== checkedInPatient.id)]);
          return { id: appointmentId, checked_in_at: new Date().toISOString(), checked_in_patient_id: checkedInPatient.id };
        }}
        onUpdateAppointment={(appointmentId, payload) => api.updateAppointment(appointmentId, payload)}
        onUpdateFollowUp={(followUpId, payload) => api.updateFollowUp(followUpId, payload)}
        onBillingComplete={(patientId) => setPatients((current) => current.map((patient) => patient.id === patientId ? { ...patient, billed: true } : patient))}
      />
    </main>
  );
}
