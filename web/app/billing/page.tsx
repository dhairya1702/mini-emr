"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { DraftInvoiceItem, SettingsDrawerBillingPanel } from "@/components/settings-drawer-billing-panel";
import { SettingsDrawer } from "@/components/settings-drawer";
import { api } from "@/lib/api";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { Invoice, Patient, PaymentStatus } from "@/lib/types";

export default function BillingPage() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedBillingPatientId, setSelectedBillingPatientId] = useState("");
  const [invoiceItems, setInvoiceItems] = useState<DraftInvoiceItem[]>([]);
  const [billingError, setBillingError] = useState("");
  const [billingStatus, setBillingStatus] = useState("");
  const [savedInvoice, setSavedInvoice] = useState<Invoice | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [isSavingInvoice, setIsSavingInvoice] = useState(false);
  const [isPreparingInvoicePdf, setIsPreparingInvoicePdf] = useState(false);
  const [isSendingInvoice, setIsSendingInvoice] = useState(false);
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
  const billablePatients = useMemo(() => patients.filter((patient) => patient.status === "done" && !patient.billed), [patients]);
  const selectedBillingPatient = useMemo(() => billablePatients.find((patient) => patient.id === selectedBillingPatientId) ?? null, [billablePatients, selectedBillingPatientId]);
  const invoiceSubtotal = useMemo(() => invoiceItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0), [invoiceItems]);

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

  useEffect(() => {
    if (!selectedBillingPatientId && billablePatients[0]) {
      setSelectedBillingPatientId(billablePatients[0].id);
    }
  }, [billablePatients, selectedBillingPatientId]);

  function addCatalogItemToInvoice(item: typeof catalogItems[number]) {
    if (item.track_inventory && item.stock_quantity <= 0) {
      setBillingError(`No stock left for ${item.name}.`);
      return;
    }
    setInvoiceItems((current) => [...current, { id: crypto.randomUUID(), catalog_item_id: item.id, item_type: item.item_type, label: item.name, quantity: 1, unit_price: item.default_price }]);
    setBillingStatus("");
    setBillingError("");
    setSavedInvoice(null);
  }

  function updateInvoiceItem(itemId: string, patch: Partial<DraftInvoiceItem>) {
    setInvoiceItems((current) => current.map((item) => item.id === itemId ? { ...item, ...patch } : item));
    setBillingStatus("");
    setBillingError("");
    setSavedInvoice(null);
  }

  function removeInvoiceItem(itemId: string) {
    setInvoiceItems((current) => current.filter((item) => item.id !== itemId));
    setBillingStatus("");
    setBillingError("");
    setSavedInvoice(null);
  }

  async function handleCreateBill() {
    if (!selectedBillingPatient) {
      setBillingError("Select a done patient to bill.");
      return;
    }
    if (!invoiceItems.length) {
      setBillingError("Add at least one service or medicine.");
      return;
    }
    setIsSavingInvoice(true);
    setBillingError("");
    setBillingStatus("");
    try {
      const created = await handleCreateInvoice({
        patient_id: selectedBillingPatient.id,
        items: invoiceItems.map((item) => ({
          catalog_item_id: item.catalog_item_id ?? null,
          item_type: item.item_type,
          label: item.label,
          quantity: item.quantity,
          unit_price: item.unit_price,
        })),
        payment_status: paymentStatus,
      });
      setSavedInvoice(created);
      setBillingStatus("Invoice created.");
    } catch (createError) {
      setBillingError(createError instanceof Error ? createError.message : "Failed to create bill.");
    } finally {
      setIsSavingInvoice(false);
    }
  }

  async function handleInvoicePdf() {
    if (!savedInvoice) {
      setBillingError("Send the bill first to save it, then preview the PDF.");
      return;
    }
    setIsPreparingInvoicePdf(true);
    setBillingError("");
    setBillingStatus("");
    try {
      const blob = await api.generateInvoicePdf(savedInvoice.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setBillingStatus("Invoice PDF ready.");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (pdfError) {
      setBillingError(pdfError instanceof Error ? pdfError.message : "Failed to prepare invoice PDF.");
    } finally {
      setIsPreparingInvoicePdf(false);
    }
  }

  async function handleShareInvoice() {
    if (!selectedBillingPatient) {
      setBillingError("Select a done patient to bill.");
      return;
    }
    if (!invoiceItems.length) {
      setBillingError("Add at least one service or medicine.");
      return;
    }
    setIsSendingInvoice(true);
    setBillingError("");
    setBillingStatus("");
    try {
      const invoice = savedInvoice ?? (await handleCreateInvoice({
        patient_id: selectedBillingPatient.id,
        items: invoiceItems.map((item) => ({
          catalog_item_id: item.catalog_item_id ?? null,
          item_type: item.item_type,
          label: item.label,
          quantity: item.quantity,
          unit_price: item.unit_price,
        })),
        payment_status: paymentStatus,
      }));
      if (!savedInvoice) {
        setSavedInvoice(invoice);
      }
      const message = await handleSendInvoice({ invoice_id: invoice.id, recipient: selectedBillingPatient.phone });
      setBillingStatus(message);
      setPatients((current) => current.map((patient) => patient.id === selectedBillingPatient.id ? { ...patient, billed: true } : patient));
    } catch (sendError) {
      setBillingError(sendError instanceof Error ? sendError.message : "Failed to mark invoice as shared.");
    } finally {
      setIsSendingInvoice(false);
    }
  }

  if (isRedirectingToLogin) return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_20px_60px_rgba(125,211,252,0.18)]">Redirecting to login...</div></main>;
  if (!isAuthReady) return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_20px_60px_rgba(125,211,252,0.18)]">Loading ClinicOS...</div></main>;
  if (currentUser?.role === "staff") return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_20px_60px_rgba(125,211,252,0.18)]">Redirecting to queue...</div></main>;

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px]">
        <AppHeader clinicName={clinicName} currentUser={currentUser} active="billing" onOpenSettings={() => setIsSettingsOpen(true)} onLogout={handleLogout} />
        {error ? <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        <SettingsDrawerBillingPanel
          patients={billablePatients}
          selectedBillingPatientId={selectedBillingPatientId}
          selectedBillingPatient={selectedBillingPatient}
          serviceItems={catalogItems.filter((item) => item.item_type === "service")}
          medicineItems={catalogItems.filter((item) => item.item_type === "medicine")}
          invoiceItems={invoiceItems}
          invoiceSubtotal={invoiceSubtotal}
          paymentStatus={paymentStatus}
          billingError={billingError}
          billingStatus={billingStatus}
          isSavingInvoice={isSavingInvoice}
          isPreparingInvoicePdf={isPreparingInvoicePdf}
          isSendingInvoice={isSendingInvoice}
          savedInvoice={savedInvoice}
          onSelectPatient={(patientId) => {
            setSelectedBillingPatientId(patientId);
            setInvoiceItems([]);
            setSavedInvoice(null);
            setBillingError("");
            setBillingStatus("");
          }}
          onAddCatalogItem={addCatalogItemToInvoice}
          onUpdateInvoiceItem={updateInvoiceItem}
          onRemoveInvoiceItem={removeInvoiceItem}
          onCreateBill={handleCreateBill}
          onPaymentStatusChange={(status) => {
            setPaymentStatus(status);
            setSavedInvoice(null);
            setBillingStatus("");
            setBillingError("");
          }}
          onPreviewPdf={handleInvoicePdf}
          onSendInvoice={handleShareInvoice}
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
        patients={billablePatients}
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
