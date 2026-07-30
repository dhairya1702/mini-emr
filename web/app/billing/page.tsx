"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { LazySettingsDrawer } from "@/components/lazy-settings-drawer";
import { DraftInvoiceItem, SettingsDrawerBillingPanel } from "@/components/settings-drawer-billing-panel";
import { api } from "@/lib/api";
import { calculateDraftInvoiceTaxTotals } from "@/lib/billing-tax";
import { trackWhatsAppDelivery } from "@/lib/whatsapp-delivery";
import { printBlob } from "@/lib/print";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { BillingSuggestionsResponse, CatalogItem, ConsultationNote, Invoice, Patient, PaymentStatus } from "@/lib/types";

const BILLING_REFRESH_INTERVAL_MS = 30_000;
const BILLABLE_PATIENT_LIMIT = 50;
const RECENT_INVOICE_LIMIT = 5;

function createId() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function upsertInvoice(current: Invoice[], incoming: Invoice) {
  return [incoming, ...current.filter((invoice) => invoice.id !== incoming.id)]
    .slice(0, RECENT_INVOICE_LIMIT);
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
  suggestions: BillingSuggestionsResponse | null,
) {
  if (!patient) {
    return [];
  }

  if (suggestions) {
    return suggestions.suggestions
      .filter((suggestion) => suggestion.status === "auto_add")
      .map((suggestion) => suggestion.catalog_match
        ? {
            id: createId(),
            catalog_item_id: suggestion.catalog_match.catalog_item_id,
            item_type: suggestion.catalog_match.item_type,
            label: suggestion.catalog_match.label,
            quantity: suggestion.catalog_match.quantity,
            unit_price: suggestion.catalog_match.unit_price,
          }
        : {
            id: createId(),
            catalog_item_id: null,
            item_type: "service" as const,
            label: "Consultation",
            quantity: 1,
            unit_price: 0,
          });
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
  const [isFinalizingInvoice, setIsFinalizingInvoice] = useState(false);
  const [isPreparingInvoicePdf, setIsPreparingInvoicePdf] = useState(false);
  const [isSendingInvoice, setIsSendingInvoice] = useState(false);
  const [isSendingInvoiceWhatsApp, setIsSendingInvoiceWhatsApp] = useState(false);
  const [isInvoiceDirty, setIsInvoiceDirty] = useState(false);
  const [selectedPatientNotes, setSelectedPatientNotes] = useState<ConsultationNote[]>([]);
  const [isBillingNotesLoading, setIsBillingNotesLoading] = useState(false);
  const [billingSuggestions, setBillingSuggestions] = useState<BillingSuggestionsResponse | null>(null);
  const [isBillingSuggestionsLoading, setIsBillingSuggestionsLoading] = useState(false);
  const [hasSeededBillingDraft, setHasSeededBillingDraft] = useState(false);
  const [customItemLabel, setCustomItemLabel] = useState("");
  const [customItemQuantity, setCustomItemQuantity] = useState("1");
  const [customItemUnitPrice, setCustomItemUnitPrice] = useState("");
  const canLoadAdminPageData = useCallback((user: { role: "admin" | "staff" }) => user.role === "admin", []);
  const loadPageData = useCallback(async () => {
    const [loadedPatients, loadedInvoices] = await Promise.all([
      api.listPatients({ status: "done", billed: false, limit: BILLABLE_PATIENT_LIMIT }),
      api.listInvoices({ limit: RECENT_INVOICE_LIMIT }),
    ]);
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
    handleFinalizeInvoice,
    handleGenerateLetter,
    handleSendLetter,
    handleSendLetterWhatsApp,
    handleSendInvoice,
    handleSendInvoiceWhatsApp,
    handleExportPatientsCsv,
    handleExportVisitsCsv,
    handleExportInvoicesCsv,
  } = useClinicShellPage({
    canLoadPageData: canLoadAdminPageData,
    loadPageData,
    onPageData,
  });
  const clinicName = clinicSettings?.clinic_name || "ClinicOS";
  const workspaceMode = clinicSettings?.workspace_mode ?? "team";
  const isSoloWorkspace = workspaceMode === "solo";
  const billablePatients = useMemo(() => patients.filter((patient) => patient.status === "done" && !patient.billed), [patients]);
  const selectedBillingPatient = useMemo(() => billablePatients.find((patient) => patient.id === selectedBillingPatientId) ?? null, [billablePatients, selectedBillingPatientId]);
  const invoiceTaxTotals = useMemo(
    () => calculateDraftInvoiceTaxTotals(invoiceItems, catalogItems),
    [catalogItems, invoiceItems],
  );
  const invoiceSubtotal = invoiceTaxTotals.subtotal;
  const invoiceTotal = invoiceTaxTotals.total;
  const normalizedAmountPaid = useMemo(
    () => (paymentStatus === "paid" ? invoiceTotal : paymentStatus === "unpaid" ? 0 : Number(amountPaidInput || "0")),
    [amountPaidInput, invoiceTotal, paymentStatus],
  );
  const balanceDue = useMemo(() => Math.max(invoiceTotal - normalizedAmountPaid, 0), [invoiceTotal, normalizedAmountPaid]);
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
      if (document.visibilityState !== "visible") {
        return;
      }
      try {
        const [nextPatients, nextInvoices] = await Promise.all([
          api.listPatients({ status: "done", billed: false, limit: BILLABLE_PATIENT_LIMIT }),
          api.listInvoices({ limit: RECENT_INVOICE_LIMIT }),
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

    const intervalId = isSoloWorkspace
      ? null
      : window.setInterval(() => {
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
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [currentUser, isAuthReady, isRedirectingToLogin, isSoloWorkspace]);

  useEffect(() => {
    if (!selectedBillingPatientId && billablePatients[0]) {
      setSelectedBillingPatientId(billablePatients[0].id);
    }
  }, [billablePatients, selectedBillingPatientId]);

  const serviceItems = useMemo(() => catalogItems.filter((item) => item.item_type === "service" || (item.item_type === "program" && item.is_active !== false)), [catalogItems]);
  const medicineItems = useMemo(() => catalogItems.filter((item) => item.item_type === "medicine"), [catalogItems]);
  const latestConsultationNote = useMemo(() => selectedPatientNotes[0] ?? null, [selectedPatientNotes]);
  const autoDraftInvoiceItems = useMemo(
    () => buildAutoDraftInvoiceItems(selectedBillingPatient, latestConsultationNote, serviceItems, medicineItems, billingSuggestions),
    [billingSuggestions, latestConsultationNote, medicineItems, selectedBillingPatient, serviceItems],
  );

  useEffect(() => {
    if (!latestConsultationNote) {
      setBillingSuggestions(null);
      setIsBillingSuggestionsLoading(false);
      return;
    }
    let active = true;
    setIsBillingSuggestionsLoading(true);
    void api.getNoteBillingSuggestions(latestConsultationNote.id)
      .then((response) => {
        if (active) setBillingSuggestions(response);
      })
      .catch((error) => {
        if (active) {
          setBillingSuggestions(null);
          setBillingError(error instanceof Error ? error.message : "Failed to load billing suggestions.");
        }
      })
      .finally(() => {
        if (active) setIsBillingSuggestionsLoading(false);
      });
    return () => { active = false; };
  }, [latestConsultationNote]);

  useEffect(() => {
    if (!selectedBillingPatientId) {
      setSelectedPatientNotes([]);
      setIsBillingNotesLoading(false);
      return;
    }

    let active = true;
    setIsBillingNotesLoading(true);
    void api.listPatientNotes(selectedBillingPatientId)
      .then((notes) => {
        if (!active) {
          return;
        }
        setSelectedPatientNotes(notes);
        setIsBillingNotesLoading(false);
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setSelectedPatientNotes([]);
        setIsBillingNotesLoading(false);
        setBillingStatus("");
        setBillingError(error instanceof Error ? error.message : "Failed to load consultation notes.");
      });

    return () => {
      active = false;
    };
  }, [selectedBillingPatientId]);

  useEffect(() => {
    if (!selectedBillingPatientId || isBillingNotesLoading || isBillingSuggestionsLoading || hasSeededBillingDraft || isInvoiceDirty) {
      return;
    }
    setInvoiceItems(autoDraftInvoiceItems);
    setSavedInvoice(null);
    setIsInvoiceDirty(false);
    setBillingError("");
    setBillingStatus(
      autoDraftInvoiceItems.length
        ? `Added ${autoDraftInvoiceItems.length} catalog-backed item${autoDraftInvoiceItems.length === 1 ? "" : "s"} from the latest consultation.`
        : "",
    );
    setAmountPaidInput("");
    setHasSeededBillingDraft(true);
  }, [autoDraftInvoiceItems, hasSeededBillingDraft, isBillingNotesLoading, isBillingSuggestionsLoading, isInvoiceDirty, selectedBillingPatientId]);

  function addCatalogItemToInvoice(item: typeof catalogItems[number]) {
    if (item.track_inventory && item.stock_quantity <= 0) {
      setBillingError(`No stock left for ${item.name}.`);
      return;
    }
    setInvoiceItems((current) => [...current, { id: createId(), catalog_item_id: item.id, item_type: item.item_type, label: item.name, quantity: 1, unit_price: item.default_price }]);
    setBillingStatus("");
    setBillingError("");
    setIsInvoiceDirty(true);
  }

  function updateInvoiceItem(itemId: string, patch: Partial<DraftInvoiceItem>) {
    setInvoiceItems((current) => current.map((item) => item.id === itemId ? { ...item, ...patch } : item));
    setBillingStatus("");
    setBillingError("");
    setIsInvoiceDirty(true);
  }

  function removeInvoiceItem(itemId: string) {
    setInvoiceItems((current) => current.filter((item) => item.id !== itemId));
    setBillingStatus("");
    setBillingError("");
    setIsInvoiceDirty(true);
  }

  function addCustomInvoiceItem() {
    const label = customItemLabel.trim();
    const quantity = Number(customItemQuantity);
    const amount = Number(customItemUnitPrice);

    if (!label) {
      setBillingError("Enter a label for the custom item.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setBillingError("Custom item quantity must be greater than zero.");
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setBillingError("Custom item amount must be zero or more.");
      return;
    }
    const unitPrice = quantity > 0 ? amount / quantity : 0;

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
    setIsInvoiceDirty(true);
  }

  function buildInvoicePayload() {
    if (!selectedBillingPatient) {
      throw new Error("Select a done patient to bill.");
    }
    if (!invoiceItems.length) {
      throw new Error("Add at least one service or medicine.");
    }
    return {
      invoice_id: savedInvoice?.id ?? null,
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
    } as const;
  }

  async function saveInvoiceDraft() {
    const saved = await handleCreateInvoice(buildInvoicePayload());
    setSavedInvoice(saved);
    setInvoices((current) => upsertInvoice(current, saved));
    setIsInvoiceDirty(false);
    return saved;
  }

  async function ensureSavedInvoice() {
    if (!savedInvoice || isInvoiceDirty) {
      return saveInvoiceDraft();
    }
    return savedInvoice;
  }

  async function handleCreateBill() {
    setIsSavingInvoice(true);
    setBillingError("");
    setBillingStatus("");
    try {
      await saveInvoiceDraft();
      setBillingStatus(savedInvoice ? "Invoice Updated" : "Invoice Created");
    } catch (createError) {
      setBillingError(createError instanceof Error ? createError.message : "Failed to create bill.");
    } finally {
      setIsSavingInvoice(false);
    }
  }

  async function handleInvoicePdf(action: "preview" | "print" = "preview") {
    setIsPreparingInvoicePdf(true);
    setBillingError("");
    setBillingStatus("");
    try {
      const invoice = await ensureSavedInvoice();
      const blob = await api.generateInvoicePdf(invoice.id);
      if (action === "print") {
        const patientLabel = selectedBillingPatient?.name.replace(/\s+/g, "_") || "patient";
        printBlob(blob, `${patientLabel}_invoice.pdf`);
        setBillingStatus("Print dialog opened.");
      } else {
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
        setBillingStatus("Invoice PDF ready.");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
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
    setIsSendingInvoice(true);
    setBillingError("");
    setBillingStatus("");
    try {
      const invoice = await ensureSavedInvoice();
      const result = await handleSendInvoice({ invoice_id: invoice.id, recipient_email: selectedBillingPatient.email });
      setBillingStatus(result.message);
      setSavedInvoice(result.invoice);
      setInvoices((current) => upsertInvoice(current, result.invoice));
      setIsInvoiceDirty(false);
      setPatients((current) => current.map((patient) => patient.id === selectedBillingPatient.id ? { ...patient, billed: true } : patient));
    } catch (sendError) {
      setBillingError(sendError instanceof Error ? sendError.message : "Failed to mark invoice as shared.");
    } finally {
      setIsSendingInvoice(false);
    }
  }

  async function handleShareInvoiceWhatsApp() {
    if (!selectedBillingPatient) {
      setBillingError("Select a done patient to bill.");
      return;
    }
    if (!selectedBillingPatient.phone.trim()) {
      setBillingError("This patient does not have a phone number saved.");
      return;
    }
    setIsSendingInvoiceWhatsApp(true);
    setBillingError("");
    setBillingStatus("");
    try {
      const invoice = await ensureSavedInvoice();
      const result = await handleSendInvoiceWhatsApp({ invoice_id: invoice.id, recipient_phone: selectedBillingPatient.phone });
      setBillingStatus(result.message);
      trackWhatsAppDelivery(result.delivery, "Invoice", (message, delivery) => {
        if (delivery.status === "failed") {
          setBillingError(message);
          return;
        }
        setBillingStatus(message);
      });
      setSavedInvoice(result.invoice);
      setInvoices((current) => upsertInvoice(current, result.invoice));
      setIsInvoiceDirty(false);
      setPatients((current) => current.map((patient) => patient.id === selectedBillingPatient.id ? { ...patient, billed: true } : patient));
    } catch (sendError) {
      setBillingError(sendError instanceof Error ? sendError.message : "Failed to send invoice on WhatsApp.");
    } finally {
      setIsSendingInvoiceWhatsApp(false);
    }
  }

  async function handleCompleteInvoice() {
    if (!selectedBillingPatient) {
      setBillingError("Select a done patient to bill.");
      return;
    }
    setIsFinalizingInvoice(true);
    setBillingError("");
    setBillingStatus("");
    try {
      const invoice = await ensureSavedInvoice();
      const result = await handleFinalizeInvoice({ invoice_id: invoice.id });
      setSavedInvoice(result.invoice);
      setInvoices((current) => upsertInvoice(current, result.invoice));
      setPatients((current) => current.map((patient) => patient.id === selectedBillingPatient.id ? { ...patient, billed: true } : patient));
      setBillingStatus(result.message);
      setIsInvoiceDirty(false);
    } catch (finalizeError) {
      setBillingError(finalizeError instanceof Error ? finalizeError.message : "Failed to complete invoice.");
    } finally {
      setIsFinalizingInvoice(false);
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
          invoiceTaxTotal={invoiceTaxTotals.taxTotal}
          invoiceCgstTotal={invoiceTaxTotals.cgstTotal}
          invoiceSgstTotal={invoiceTaxTotals.sgstTotal}
          invoiceTotal={invoiceTotal}
          amountPaid={normalizedAmountPaid}
          amountPaidInput={amountPaidInput}
          balanceDue={balanceDue}
          paymentStatus={paymentStatus}
          billingError={billingError}
          billingStatus={billingStatus}
          isSavingInvoice={isSavingInvoice}
          isFinalizingInvoice={isFinalizingInvoice}
          isPreparingInvoicePdf={isPreparingInvoicePdf}
          isSendingInvoice={isSendingInvoice}
          isSendingInvoiceWhatsApp={isSendingInvoiceWhatsApp}
          savedInvoice={savedInvoice}
          customItemLabel={customItemLabel}
          customItemQuantity={customItemQuantity}
          customItemUnitPrice={customItemUnitPrice}
          onSelectPatient={(patientId) => {
            setSelectedBillingPatientId(patientId);
            setInvoiceItems([]);
            setSavedInvoice(null);
            setIsInvoiceDirty(false);
            setIsBillingNotesLoading(false);
            setHasSeededBillingDraft(false);
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
            setAmountPaidInput(status === "partial" ? invoiceTotal.toFixed(2) : "");
            setIsInvoiceDirty(true);
            setBillingStatus("");
            setBillingError("");
          }}
          onAmountPaidChange={(value) => {
            setAmountPaidInput(value);
            setIsInvoiceDirty(true);
            setBillingStatus("");
            setBillingError("");
          }}
          onPreviewPdf={handleInvoicePdf}
          onPrintInvoice={() => handleInvoicePdf("print")}
          onFinalizeInvoice={handleCompleteInvoice}
          onSendInvoice={handleShareInvoice}
          onSendInvoiceWhatsApp={handleShareInvoiceWhatsApp}
        />
        <section className="mt-4 rounded-[18px] border border-[#bfd7e8] bg-white p-5 shadow-[0_10px_28px_rgba(64,131,181,0.08)]">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Recent invoices</h2>
          </div>
          <div className="mt-5 overflow-hidden rounded-[18px] border border-[#bfd7e8] bg-white">
            {invoices.length ? (
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
                    {invoices.map((invoice) => {
                      const patientName = invoice.patient_name || patients.find((patient) => patient.id === invoice.patient_id)?.name || "Patient";
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
              <div className="rounded-[18px] border border-dashed border-[#bfd7e8] bg-[#f3f8fb]/20 px-6 py-12 text-center text-sm text-slate-500">No recent invoices.</div>
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
          onSendLetterWhatsApp={handleSendLetterWhatsApp}
          onCreateInvoice={handleCreateInvoice}
          onFinalizeInvoice={handleFinalizeInvoice}
          onGenerateInvoicePdf={(invoiceId) => api.generateInvoicePdf(invoiceId)}
          onSendInvoice={handleSendInvoice}
          onSendInvoiceWhatsApp={handleSendInvoiceWhatsApp}
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
