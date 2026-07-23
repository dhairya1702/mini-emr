"use client";

import { useEffect, useMemo, useState } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { MobileAdminGate } from "@/components/mobile/mobile-admin-gate";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { DraftInvoiceItem, SettingsDrawerBillingPanel } from "@/components/settings-drawer-billing-panel";
import { api } from "@/lib/api";
import { printBlob } from "@/lib/print";
import type { BillingSuggestionsResponse, CatalogItem, ConsultationNote, Invoice, Patient, PaymentStatus } from "@/lib/types";

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
  const noteText = `${note.snapshot_content || note.content || ""}`.trim().toLowerCase();
  if (!noteText) {
    return [];
  }
  return medicineItems.filter((item) => noteText.includes(item.name.toLowerCase()));
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

  const consultationService = serviceItems.find((item) => /\bconsult/i.test(item.name)) ?? null;
  const items: DraftInvoiceItem[] = [
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
  ];

  extractMedicineSuggestions(note, medicineItems).forEach((medicine) => {
    items.push({
      id: createId(),
      catalog_item_id: medicine.id,
      item_type: medicine.item_type,
      label: medicine.name,
      quantity: 1,
      unit_price: medicine.default_price,
    });
  });

  return items;
}

export default function MobileBillingPage() {
  const { currentUser, isAuthReady, isRedirectingToLogin } = useClinicShell();
  return (
    <MobileAdminGate title="Billing">
      <MobileBillingContent authReady={isAuthReady} redirecting={isRedirectingToLogin} userRole={currentUser?.role} />
    </MobileAdminGate>
  );
}

function MobileBillingContent({
  authReady,
  redirecting,
  userRole,
}: {
  authReady?: boolean;
  redirecting?: boolean;
  userRole?: string;
}) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [selectedBillingPatientId, setSelectedBillingPatientId] = useState("");
  const [invoiceItems, setInvoiceItems] = useState<DraftInvoiceItem[]>([]);
  const [billingError, setBillingError] = useState("");
  const [billingStatus, setBillingStatus] = useState("");
  const [savedInvoice, setSavedInvoice] = useState<Invoice | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [amountPaidInput, setAmountPaidInput] = useState("");
  const [customItemLabel, setCustomItemLabel] = useState("");
  const [customItemQuantity, setCustomItemQuantity] = useState("1");
  const [customItemUnitPrice, setCustomItemUnitPrice] = useState("");
  const [selectedPatientNotes, setSelectedPatientNotes] = useState<ConsultationNote[]>([]);
  const [billingSuggestions, setBillingSuggestions] = useState<BillingSuggestionsResponse | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingInvoice, setIsSavingInvoice] = useState(false);
  const [isFinalizingInvoice, setIsFinalizingInvoice] = useState(false);
  const [isPreparingInvoicePdf, setIsPreparingInvoicePdf] = useState(false);
  const [isSendingInvoice, setIsSendingInvoice] = useState(false);
  const [isSendingInvoiceWhatsApp, setIsSendingInvoiceWhatsApp] = useState(false);
  const [isInvoiceDirty, setIsInvoiceDirty] = useState(false);
  const [hasSeededBillingDraft, setHasSeededBillingDraft] = useState(false);

  const billablePatients = useMemo(() => patients.filter((patient) => patient.status === "done" && !patient.billed), [patients]);
  const selectedBillingPatient = useMemo(
    () => billablePatients.find((patient) => patient.id === selectedBillingPatientId) ?? null,
    [billablePatients, selectedBillingPatientId],
  );
  const serviceItems = useMemo(() => catalogItems.filter((item) => item.item_type === "service"), [catalogItems]);
  const medicineItems = useMemo(() => catalogItems.filter((item) => item.item_type === "medicine"), [catalogItems]);
  const invoiceSubtotal = useMemo(() => invoiceItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0), [invoiceItems]);
  const amountPaid = useMemo(
    () => (paymentStatus === "paid" ? invoiceSubtotal : paymentStatus === "unpaid" ? 0 : Number(amountPaidInput || "0")),
    [amountPaidInput, invoiceSubtotal, paymentStatus],
  );
  const balanceDue = useMemo(() => Math.max(invoiceSubtotal - amountPaid, 0), [amountPaid, invoiceSubtotal]);
  const latestConsultationNote = selectedPatientNotes[0] ?? null;
  const autoDraftInvoiceItems = useMemo(
    () => buildAutoDraftInvoiceItems(selectedBillingPatient, latestConsultationNote, serviceItems, medicineItems, billingSuggestions),
    [billingSuggestions, latestConsultationNote, medicineItems, selectedBillingPatient, serviceItems],
  );

  useEffect(() => {
    if (!authReady || redirecting || userRole !== "admin") {
      return;
    }
    let active = true;
    setIsLoading(true);
    Promise.all([api.listQueuePatients(), api.listCatalogItems()])
      .then(([patientRows, catalogRows]) => {
        if (!active) return;
        setPatients(patientRows);
        setCatalogItems(catalogRows);
        setBillingError("");
      })
      .catch((loadError) => {
        if (active) setBillingError(loadError instanceof Error ? loadError.message : "Failed to load billing.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authReady, redirecting, userRole]);

  useEffect(() => {
    if (!selectedBillingPatientId && billablePatients[0]) {
      setSelectedBillingPatientId(billablePatients[0].id);
    }
  }, [billablePatients, selectedBillingPatientId]);

  useEffect(() => {
    setRecipientEmail(selectedBillingPatient?.email ?? "");
  }, [selectedBillingPatient]);

  useEffect(() => {
    if (!selectedBillingPatientId) {
      setSelectedPatientNotes([]);
      setBillingSuggestions(null);
      return;
    }
    let active = true;
    api.listPatientNotes(selectedBillingPatientId)
      .then((notes) => {
        if (active) setSelectedPatientNotes(notes);
      })
      .catch((error) => {
        if (active) setBillingError(error instanceof Error ? error.message : "Failed to load consultation notes.");
      });
    return () => {
      active = false;
    };
  }, [selectedBillingPatientId]);

  useEffect(() => {
    if (!latestConsultationNote) {
      setBillingSuggestions(null);
      return;
    }
    let active = true;
    api.getNoteBillingSuggestions(latestConsultationNote.id)
      .then((response) => {
        if (active) setBillingSuggestions(response);
      })
      .catch(() => {
        if (active) setBillingSuggestions(null);
      });
    return () => {
      active = false;
    };
  }, [latestConsultationNote]);

  useEffect(() => {
    if (!selectedBillingPatientId || hasSeededBillingDraft || isInvoiceDirty) {
      return;
    }
    setInvoiceItems(autoDraftInvoiceItems);
    setSavedInvoice(null);
    setBillingError("");
    setBillingStatus("");
    setAmountPaidInput("");
    setHasSeededBillingDraft(true);
  }, [autoDraftInvoiceItems, hasSeededBillingDraft, isInvoiceDirty, selectedBillingPatientId]);

  function resetPatient(patientId: string) {
    setSelectedBillingPatientId(patientId);
    setInvoiceItems([]);
    setSavedInvoice(null);
    setIsInvoiceDirty(false);
    setHasSeededBillingDraft(false);
    setBillingError("");
    setBillingStatus("");
    setAmountPaidInput("");
    setSelectedPatientNotes([]);
    setBillingSuggestions(null);
  }

  function addCatalogItemToInvoice(item: CatalogItem) {
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
    setInvoiceItems((current) => [
      ...current,
      {
        id: createId(),
        catalog_item_id: null,
        item_type: "service",
        label,
        quantity,
        unit_price: quantity > 0 ? amount / quantity : 0,
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
      amount_paid: paymentStatus === "partial" ? amountPaid : undefined,
    };
  }

  async function saveInvoiceDraft() {
    const saved = await api.createInvoice(buildInvoicePayload());
    setSavedInvoice(saved);
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
      const wasUpdate = Boolean(savedInvoice);
      await saveInvoiceDraft();
      setBillingStatus(wasUpdate ? "Invoice Updated" : "Invoice Created");
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Failed to create invoice.");
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
        printBlob(blob, `${selectedBillingPatient?.name.replace(/\s+/g, "_") || "patient"}_invoice.pdf`);
        setBillingStatus("Print dialog opened.");
      } else {
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Failed to prepare invoice PDF.");
    } finally {
      setIsPreparingInvoicePdf(false);
    }
  }

  async function handleCompleteInvoice() {
    setIsFinalizingInvoice(true);
    setBillingError("");
    setBillingStatus("");
    try {
      const invoice = await ensureSavedInvoice();
      const result = await api.finalizeInvoice({ invoice_id: invoice.id });
      setSavedInvoice(result.invoice);
      setPatients((current) => current.map((patient) => patient.id === result.invoice.patient_id ? { ...patient, billed: true } : patient));
      setBillingStatus(result.message);
      setIsInvoiceDirty(false);
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Failed to complete invoice.");
    } finally {
      setIsFinalizingInvoice(false);
    }
  }

  async function handleShareInvoice() {
    if (!recipientEmail.trim()) {
      setBillingError("This patient does not have an email address saved.");
      return;
    }
    setIsSendingInvoice(true);
    setBillingError("");
    setBillingStatus("");
    try {
      const invoice = await ensureSavedInvoice();
      const result = await api.sendInvoice({ invoice_id: invoice.id, recipient_email: recipientEmail.trim() });
      setSavedInvoice(result.invoice);
      setBillingStatus(result.message);
      setIsInvoiceDirty(false);
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Failed to send invoice.");
    } finally {
      setIsSendingInvoice(false);
    }
  }

  async function handleShareInvoiceWhatsApp() {
    if (!selectedBillingPatient?.phone.trim()) {
      setBillingError("This patient does not have a phone number saved.");
      return;
    }
    setIsSendingInvoiceWhatsApp(true);
    setBillingError("");
    setBillingStatus("");
    try {
      const invoice = await ensureSavedInvoice();
      const result = await api.sendInvoiceWhatsApp({ invoice_id: invoice.id, recipient_phone: selectedBillingPatient.phone });
      setSavedInvoice(result.invoice);
      setBillingStatus(result.message);
      setIsInvoiceDirty(false);
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Failed to send invoice on WhatsApp.");
    } finally {
      setIsSendingInvoiceWhatsApp(false);
    }
  }

  return (
    <MobileShell title="Billing">
      {isLoading ? (
        <p className="clinic-empty-state">Loading billing...</p>
      ) : (
        <SettingsDrawerBillingPanel
          patients={billablePatients}
          selectedBillingPatientId={selectedBillingPatientId}
          selectedBillingPatient={selectedBillingPatient}
          serviceItems={serviceItems}
          medicineItems={medicineItems}
          invoiceItems={invoiceItems}
          invoiceSubtotal={invoiceSubtotal}
          amountPaid={amountPaid}
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
          recipientEmail={recipientEmail}
          onSelectPatient={resetPatient}
          onAddCatalogItem={addCatalogItemToInvoice}
          onCustomItemLabelChange={setCustomItemLabel}
          onCustomItemQuantityChange={setCustomItemQuantity}
          onCustomItemUnitPriceChange={setCustomItemUnitPrice}
          onRecipientEmailChange={setRecipientEmail}
          onAddCustomItem={addCustomInvoiceItem}
          onUpdateInvoiceItem={updateInvoiceItem}
          onRemoveInvoiceItem={removeInvoiceItem}
          onCreateBill={handleCreateBill}
          onPaymentStatusChange={(status) => {
            setPaymentStatus(status);
            setAmountPaidInput(status === "partial" ? invoiceSubtotal.toFixed(2) : "");
            setBillingStatus("");
            setBillingError("");
            setIsInvoiceDirty(true);
          }}
          onAmountPaidChange={(value) => {
            setAmountPaidInput(value);
            setBillingStatus("");
            setBillingError("");
            setIsInvoiceDirty(true);
          }}
          onPreviewPdf={handleInvoicePdf}
          onPrintInvoice={() => handleInvoicePdf("print")}
          onFinalizeInvoice={handleCompleteInvoice}
          onSendInvoice={handleShareInvoice}
          onSendInvoiceWhatsApp={handleShareInvoiceWhatsApp}
        />
      )}
    </MobileShell>
  );
}
