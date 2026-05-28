"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { LazySettingsDrawer } from "@/components/lazy-settings-drawer";
import { DraftInvoiceItem, SettingsDrawerBillingPanel } from "@/components/settings-drawer-billing-panel";
import { api } from "@/lib/api";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { CatalogItem, ConsultationNote, Invoice, Patient, PaymentStatus } from "@/lib/types";

const BILLING_REFRESH_INTERVAL_MS = 5000;

function createId() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function extractMedicineSuggestions(note: ConsultationNote | null, medicineItems: CatalogItem[]) {
  if (!note) {
    return [];
  }

  const noteText = `${note.snapshot_content || note.content || ""}`.trim();
  if (!noteText) {
    return [];
  }

  const normalizedText = noteText.toLowerCase();
  return medicineItems.filter((item) => normalizedText.includes(item.name.toLowerCase()));
}

function extractStructuredPrescriptionItems(
  note: ConsultationNote | null,
  medicineItems: CatalogItem[],
): DraftInvoiceItem[] {
  if (!note) {
    return [];
  }

  const sourceText = `${note.snapshot_content || note.content || ""}`;
  const lines = sourceText.split("\n");
  const headerIndex = lines.findIndex((line) =>
    line.trim().toLowerCase() === "medicine | quantity | schedule | duration | notes",
  );
  if (headerIndex === -1) {
    return [];
  }

  const itemsByName = new Map(medicineItems.map((item) => [item.name.trim().toLowerCase(), item]));
  const structuredItems: DraftInvoiceItem[] = [];

  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const rawLine = lines[index].trim();
    if (!rawLine || !rawLine.includes("|")) {
      break;
    }

    const columns = rawLine.split("|").map((column) => column.trim());
    if (columns.length < 2) {
      continue;
    }

    const label = columns[0];
    const quantityText = columns[1] || "1";
    const matchedMedicine = itemsByName.get(label.toLowerCase());
    if (!matchedMedicine) {
      continue;
    }

    const quantityMatch = quantityText.match(/(\d+(?:\.\d+)?)/);
    const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    structuredItems.push({
      id: createId(),
      catalog_item_id: matchedMedicine.id,
      item_type: matchedMedicine.item_type,
      label: matchedMedicine.name,
      quantity,
      unit_price: matchedMedicine.default_price,
    });
  }

  return structuredItems;
}

function buildAutoDraftInvoiceItems(
  patient: Patient | null,
  note: ConsultationNote | null,
  serviceItems: CatalogItem[],
  medicineItems: CatalogItem[],
) {
  if (!patient) {
    return [];
  }

  const items: DraftInvoiceItem[] = [];
  const structuredMedicineItems = extractStructuredPrescriptionItems(note, medicineItems);
  const consultationService =
    serviceItems.find((item) => /\bconsult/i.test(item.name)) ?? null;

  items.push(
    consultationService
      ? {
          id: createId(),
          catalog_item_id: consultationService.id,
          item_type: consultationService.item_type,
          label: consultationService.name,
          quantity: 1,
          unit_price: consultationService.default_price,
        }
      : {
          id: createId(),
          catalog_item_id: null,
          item_type: "service",
          label: "Consultation",
          quantity: 1,
          unit_price: 0,
        },
  );

  const medicinesToBill = structuredMedicineItems.length
    ? structuredMedicineItems
    : extractMedicineSuggestions(note, medicineItems).map((medicine) => ({
        id: createId(),
        catalog_item_id: medicine.id,
        item_type: medicine.item_type,
        label: medicine.name,
        quantity: 1,
        unit_price: medicine.default_price,
      }));

  for (const medicine of medicinesToBill) {
    items.push({
      ...medicine,
    });
  }

  return items;
}

export default function BillingPage() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedBillingPatientId, setSelectedBillingPatientId] = useState("");
  const [invoiceItems, setInvoiceItems] = useState<DraftInvoiceItem[]>([]);
  const [billingError, setBillingError] = useState("");
  const [billingStatus, setBillingStatus] = useState("");
  const [savedInvoice, setSavedInvoice] = useState<Invoice | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [amountPaidInput, setAmountPaidInput] = useState("");
  const [isSavingInvoice, setIsSavingInvoice] = useState(false);
  const [isPreparingInvoicePdf, setIsPreparingInvoicePdf] = useState(false);
  const [isSendingInvoice, setIsSendingInvoice] = useState(false);
  const [selectedPatientNotes, setSelectedPatientNotes] = useState<ConsultationNote[]>([]);
  const [customItemLabel, setCustomItemLabel] = useState("");
  const [customItemQuantity, setCustomItemQuantity] = useState("1");
  const [customItemUnitPrice, setCustomItemUnitPrice] = useState("");
  const [historyPatientFilter, setHistoryPatientFilter] = useState("all");
  const [historyStatusFilter, setHistoryStatusFilter] = useState<PaymentStatus | "all">("all");
  const canLoadAdminPageData = useCallback((user: { role: "admin" | "staff" }) => user.role === "admin", []);
  const loadPageData = useCallback(async () => {
    const [loadedPatients, loadedInvoices] = await Promise.all([api.listPatients(), api.listInvoices()]);
    return { patients: loadedPatients, invoices: loadedInvoices };
  }, []);
  const onPageData = useCallback((data: { patients: Patient[]; invoices: Invoice[] }) => {
    setPatients(data.patients);
    setInvoices(data.invoices);
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
    applyClinicSettings,
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
  const normalizedAmountPaid = useMemo(
    () => (paymentStatus === "paid" ? invoiceSubtotal : paymentStatus === "unpaid" ? 0 : Number(amountPaidInput || "0")),
    [amountPaidInput, invoiceSubtotal, paymentStatus],
  );
  const balanceDue = useMemo(() => Math.max(invoiceSubtotal - normalizedAmountPaid, 0), [invoiceSubtotal, normalizedAmountPaid]);
  const filteredInvoiceHistory = useMemo(() => invoices.filter((invoice) => {
    const matchesPatient = historyPatientFilter === "all" || invoice.patient_id === historyPatientFilter;
    const matchesStatus = historyStatusFilter === "all" || invoice.payment_status === historyStatusFilter;
    return matchesPatient && matchesStatus;
  }), [historyPatientFilter, historyStatusFilter, invoices]);

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
    if (!isAuthReady || isRedirectingToLogin || currentUser?.role !== "admin") {
      return;
    }

    let active = true;

    async function refreshBillingData() {
      try {
        const [nextPatients, nextInvoices] = await Promise.all([
          api.listPatients(),
          api.listInvoices(),
        ]);
        if (!active) {
          return;
        }
        setPatients(nextPatients);
        setInvoices(nextInvoices);
      } catch {
        // Keep the current billing workspace stable if a background refresh fails.
      }
    }

    void refreshBillingData();

    const intervalId = window.setInterval(() => {
      void refreshBillingData();
    }, BILLING_REFRESH_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshBillingData();
      }
    };

    const handleFocus = () => {
      void refreshBillingData();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [currentUser, isAuthReady, isRedirectingToLogin]);

  useEffect(() => {
    if (!selectedBillingPatientId && billablePatients[0]) {
      setSelectedBillingPatientId(billablePatients[0].id);
    }
  }, [billablePatients, selectedBillingPatientId]);

  const serviceItems = useMemo(() => catalogItems.filter((item) => item.item_type === "service"), [catalogItems]);
  const medicineItems = useMemo(() => catalogItems.filter((item) => item.item_type === "medicine"), [catalogItems]);
  const latestConsultationNote = useMemo(() => selectedPatientNotes[0] ?? null, [selectedPatientNotes]);
  const autoDraftInvoiceItems = useMemo(
    () => buildAutoDraftInvoiceItems(selectedBillingPatient, latestConsultationNote, serviceItems, medicineItems),
    [latestConsultationNote, medicineItems, selectedBillingPatient, serviceItems],
  );

  useEffect(() => {
    if (!selectedBillingPatientId) {
      setSelectedPatientNotes([]);
      return;
    }

    let active = true;
    void api.listPatientNotes(selectedBillingPatientId)
      .then((notes) => {
        if (!active) {
          return;
        }
        setSelectedPatientNotes(notes);
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setSelectedPatientNotes([]);
        setBillingStatus("");
        setBillingError(error instanceof Error ? error.message : "Failed to load consultation notes.");
      });

    return () => {
      active = false;
    };
  }, [selectedBillingPatientId]);

  useEffect(() => {
    if (!selectedBillingPatientId) {
      return;
    }
    setInvoiceItems(autoDraftInvoiceItems);
    setSavedInvoice(null);
    setBillingError("");
    setBillingStatus(
      autoDraftInvoiceItems.length
        ? `Added consultation and ${Math.max(autoDraftInvoiceItems.length - 1, 0)} medicine item${Math.max(autoDraftInvoiceItems.length - 1, 0) === 1 ? "" : "s"} from the latest consultation.`
        : "",
    );
    setAmountPaidInput("");
  }, [autoDraftInvoiceItems, selectedBillingPatientId]);

  function addCatalogItemToInvoice(item: typeof catalogItems[number]) {
    if (item.track_inventory && item.stock_quantity <= 0) {
      setBillingError(`No stock left for ${item.name}.`);
      return;
    }
    setInvoiceItems((current) => [...current, { id: createId(), catalog_item_id: item.id, item_type: item.item_type, label: item.name, quantity: 1, unit_price: item.default_price }]);
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

  function addCustomInvoiceItem() {
    const label = customItemLabel.trim();
    const quantity = Number(customItemQuantity);
    const unitPrice = Number(customItemUnitPrice);

    if (!label) {
      setBillingError("Enter a label for the custom item.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setBillingError("Custom item quantity must be greater than zero.");
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setBillingError("Custom item price must be zero or more.");
      return;
    }

    setInvoiceItems((current) => [
      ...current,
      {
        id: createId(),
        catalog_item_id: null,
        item_type: "service",
        label,
        quantity,
        unit_price: unitPrice,
      },
    ]);
    setCustomItemLabel("");
    setCustomItemQuantity("1");
    setCustomItemUnitPrice("");
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
        amount_paid: paymentStatus === "partial" ? normalizedAmountPaid : undefined,
      });
      setSavedInvoice(created);
      setInvoices((current) => [created, ...current]);
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
    if (!selectedBillingPatient.email.trim()) {
      setBillingError("This patient does not have an email address saved.");
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
        amount_paid: paymentStatus === "partial" ? normalizedAmountPaid : undefined,
      }));
      if (!savedInvoice) {
        setSavedInvoice(invoice);
        setInvoices((current) => [invoice, ...current.filter((entry) => entry.id !== invoice.id)]);
      }
      const message = await handleSendInvoice({ invoice_id: invoice.id, recipient_email: selectedBillingPatient.email });
      setBillingStatus(message);
      setInvoices((current) =>
        current.map((entry) =>
          entry.id === invoice.id
            ? { ...entry, sent_at: new Date().toISOString(), completed_at: entry.completed_at || new Date().toISOString() }
            : entry,
        ),
      );
      setPatients((current) => current.map((patient) => patient.id === selectedBillingPatient.id ? { ...patient, billed: true } : patient));
    } catch (sendError) {
      setBillingError(sendError instanceof Error ? sendError.message : "Failed to mark invoice as shared.");
    } finally {
      setIsSendingInvoice(false);
    }
  }

  if (isRedirectingToLogin) return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[20px] border border-[#dbe7ef] bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">Redirecting to login...</div></main>;
  if (!isAuthReady) return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[20px] border border-[#dbe7ef] bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">Loading ClinicOS...</div></main>;
  if (currentUser?.role === "staff") return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[20px] border border-[#dbe7ef] bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">Redirecting to queue...</div></main>;

  return (
    <main className="clinic-page">
      <div className="clinic-container">
        <AppHeader clinicName={clinicName} currentUser={currentUser} active="billing" onOpenSettings={() => setIsSettingsOpen(true)} onLogout={handleLogout} />
        {error ? <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        <SettingsDrawerBillingPanel
          patients={billablePatients}
          selectedBillingPatientId={selectedBillingPatientId}
          selectedBillingPatient={selectedBillingPatient}
          serviceItems={serviceItems}
          medicineItems={medicineItems}
          invoiceItems={invoiceItems}
          invoiceSubtotal={invoiceSubtotal}
          amountPaid={normalizedAmountPaid}
          amountPaidInput={amountPaidInput}
          balanceDue={balanceDue}
          paymentStatus={paymentStatus}
          billingError={billingError}
          billingStatus={billingStatus}
          isSavingInvoice={isSavingInvoice}
          isPreparingInvoicePdf={isPreparingInvoicePdf}
          isSendingInvoice={isSendingInvoice}
          savedInvoice={savedInvoice}
          customItemLabel={customItemLabel}
          customItemQuantity={customItemQuantity}
          customItemUnitPrice={customItemUnitPrice}
          onSelectPatient={(patientId) => {
            setSelectedBillingPatientId(patientId);
            setInvoiceItems([]);
            setSavedInvoice(null);
            setBillingError("");
            setBillingStatus("");
            setAmountPaidInput("");
            setSelectedPatientNotes([]);
          }}
          onAddCatalogItem={addCatalogItemToInvoice}
          onCustomItemLabelChange={setCustomItemLabel}
          onCustomItemQuantityChange={setCustomItemQuantity}
          onCustomItemUnitPriceChange={setCustomItemUnitPrice}
          onAddCustomItem={addCustomInvoiceItem}
          onUpdateInvoiceItem={updateInvoiceItem}
          onRemoveInvoiceItem={removeInvoiceItem}
          onCreateBill={handleCreateBill}
          onPaymentStatusChange={(status) => {
            setPaymentStatus(status);
            setAmountPaidInput(status === "partial" ? invoiceSubtotal.toFixed(2) : "");
            setSavedInvoice(null);
            setBillingStatus("");
            setBillingError("");
          }}
          onAmountPaidChange={setAmountPaidInput}
          onPreviewPdf={handleInvoicePdf}
          onSendInvoice={handleShareInvoice}
        />
        <section className="mt-4 rounded-[18px] border border-[#bfd7e8] bg-white p-5 shadow-[0_10px_28px_rgba(64,131,181,0.08)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Invoice history</h2>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <select value={historyPatientFilter} onChange={(event) => setHistoryPatientFilter(event.target.value)} className="rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/50 px-4 py-3 text-sm text-slate-800">
                <option value="all">All patients</option>
                {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}
              </select>
              <select value={historyStatusFilter} onChange={(event) => setHistoryStatusFilter(event.target.value as PaymentStatus | "all")} className="rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/50 px-4 py-3 text-sm text-slate-800">
                <option value="all">All statuses</option>
                <option value="paid">Paid</option>
                <option value="partial">Partial</option>
                <option value="unpaid">Unpaid</option>
              </select>
            </div>
          </div>
          <div className="mt-5 overflow-hidden rounded-[18px] border border-[#bfd7e8] bg-white">
            {filteredInvoiceHistory.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0">
                  <thead className="bg-[#f3f8fb]/95">
                    <tr className="text-left">
                      <th className="border-b border-[#dbe7ef] px-5 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Patient</th>
                      <th className="border-b border-[#dbe7ef] px-5 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Items</th>
                      <th className="border-b border-[#dbe7ef] px-5 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Status</th>
                      <th className="border-b border-[#dbe7ef] px-5 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Created</th>
                      <th className="border-b border-[#dbe7ef] px-5 py-4 text-right text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInvoiceHistory.slice(0, 12).map((invoice) => {
                      const patientName = patients.find((patient) => patient.id === invoice.patient_id)?.name || "Patient";
                      const statusLabel = invoice.payment_status.charAt(0).toUpperCase() + invoice.payment_status.slice(1);
                      return (
                        <tr key={invoice.id} className="transition hover:bg-[#f3f8fb]/60">
                          <td className="border-b border-[#dbe7ef] px-5 py-3.5 text-sm font-semibold text-slate-900">{patientName}</td>
                          <td className="border-b border-[#dbe7ef] px-5 py-3.5 text-sm text-slate-600">
                            {invoice.items.length} item{invoice.items.length === 1 ? "" : "s"}
                          </td>
                          <td className="border-b border-[#dbe7ef] px-5 py-3.5 text-sm text-slate-600">{statusLabel}</td>
                          <td className="border-b border-[#dbe7ef] px-5 py-3.5 text-sm text-slate-500">
                            {new Date(invoice.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                          </td>
                          <td className="border-b border-[#dbe7ef] px-5 py-3.5 text-right text-sm font-semibold tabular-nums text-slate-900">
                            {invoice.total.toFixed(2)}
                            {invoice.balance_due > 0 ? (
                              <div className="mt-1 text-xs font-medium text-amber-700">Due {invoice.balance_due.toFixed(2)}</div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-[18px] border border-dashed border-[#bfd7e8] bg-[#f3f8fb]/20 px-6 py-12 text-center text-sm text-slate-500">No invoices match these filters.</div>
            )}
          </div>
        </section>
      </div>
      {isSettingsOpen ? (
        <LazySettingsDrawer
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
          onClinicSettingsChange={applyClinicSettings}
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
      ) : null}
    </main>
  );
}
