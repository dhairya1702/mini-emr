"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildAutoDraftInvoiceItems,
  createDraftInvoiceItemId,
  type DraftInvoiceItem,
} from "@/features/dashboard/billing/billing-draft";
import { calculateDraftInvoiceTaxTotals } from "@/lib/billing-tax";
import { printBlob } from "@/lib/print";
import { trackWhatsAppDelivery } from "@/lib/whatsapp-delivery";
import type {
  BillingSuggestionsResponse,
  CatalogItem,
  ConsultationNote,
  Invoice,
  InvoiceActionResult,
  InvoiceCreatePayload,
  Patient,
  PaymentStatus,
} from "@/lib/types";

export type BillingWorkflowGateway = {
  loadPatientNotes: (patientId: string) => Promise<ConsultationNote[]>;
  loadBillingSuggestions: (noteId: string) => Promise<BillingSuggestionsResponse>;
  createInvoice: (payload: InvoiceCreatePayload) => Promise<Invoice>;
  generateInvoicePdf: (invoiceId: string) => Promise<Blob>;
  finalizeInvoice: (payload: { invoice_id: string }) => Promise<InvoiceActionResult>;
  sendInvoice: (payload: { invoice_id: string; recipient_email: string }) => Promise<InvoiceActionResult>;
  sendInvoiceWhatsApp: (payload: { invoice_id: string; recipient_phone?: string | null }) => Promise<InvoiceActionResult>;
};

export type UseBillingWorkflowOptions = {
  patient: Patient;
  catalogItems: CatalogItem[];
  isCatalogLoaded: boolean;
  isCatalogLoading: boolean;
  loadCatalogItems: () => Promise<CatalogItem[]>;
  gateway: BillingWorkflowGateway;
  onCompleted: (patientId: string, options?: { refreshDashboard?: boolean }) => void | Promise<void>;
  createId?: () => string;
};

export function useBillingWorkflow({
  patient,
  catalogItems,
  isCatalogLoaded,
  isCatalogLoading,
  loadCatalogItems,
  gateway,
  onCompleted,
  createId = createDraftInvoiceItemId,
}: UseBillingWorkflowOptions) {
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
  const [patientNotes, setPatientNotes] = useState<ConsultationNote[]>([]);
  const [isBillingNotesLoading, setIsBillingNotesLoading] = useState(false);
  const [billingSuggestions, setBillingSuggestions] = useState<BillingSuggestionsResponse | null>(null);
  const [isBillingSuggestionsLoading, setIsBillingSuggestionsLoading] = useState(false);
  const [hasSeededBillingDraft, setHasSeededBillingDraft] = useState(false);
  const [customItemLabel, setCustomItemLabel] = useState("");
  const [customItemQuantity, setCustomItemQuantity] = useState("1");
  const [customItemUnitPrice, setCustomItemUnitPrice] = useState("");
  const [recipientEmail, setRecipientEmail] = useState(patient.email ?? "");
  const catalogLoadRequestedRef = useRef(false);
  const cancelWhatsAppTrackingRef = useRef<(() => void) | null>(null);

  const serviceItems = useMemo(
    () => catalogItems.filter((item) => item.item_type === "service" || (item.item_type === "program" && item.is_active !== false)),
    [catalogItems],
  );
  const medicineItems = useMemo(
    () => catalogItems.filter((item) => item.item_type === "medicine"),
    [catalogItems],
  );
  const latestConsultationNote = patientNotes[0] ?? null;
  const autoDraftInvoiceItems = useMemo(
    () => buildAutoDraftInvoiceItems(
      patient,
      latestConsultationNote,
      serviceItems,
      medicineItems,
      billingSuggestions,
      createId,
    ),
    [billingSuggestions, createId, latestConsultationNote, medicineItems, patient, serviceItems],
  );
  const invoiceTaxTotals = useMemo(
    () => calculateDraftInvoiceTaxTotals(invoiceItems, catalogItems),
    [catalogItems, invoiceItems],
  );
  const invoiceTotal = invoiceTaxTotals.total;
  const normalizedAmountPaid = useMemo(
    () => (paymentStatus === "paid" ? invoiceTotal : paymentStatus === "unpaid" ? 0 : Number(amountPaidInput || "0")),
    [amountPaidInput, invoiceTotal, paymentStatus],
  );
  const balanceDue = Math.max(invoiceTotal - normalizedAmountPaid, 0);

  useEffect(() => () => {
    cancelWhatsAppTrackingRef.current?.();
    cancelWhatsAppTrackingRef.current = null;
  }, []);

  useEffect(() => {
    if (isCatalogLoaded || isCatalogLoading || catalogLoadRequestedRef.current) {
      return;
    }
    catalogLoadRequestedRef.current = true;
    void loadCatalogItems().catch((loadError) => {
      setBillingStatus("");
      setBillingError(loadError instanceof Error ? loadError.message : "Failed to load services and medicines.");
    });
  }, [isCatalogLoaded, isCatalogLoading, loadCatalogItems]);

  useEffect(() => {
    let active = true;
    setIsBillingNotesLoading(true);
    void gateway.loadPatientNotes(patient.id)
      .then((notes) => {
        if (active) setPatientNotes(notes);
      })
      .catch((loadError) => {
        if (!active) return;
        setPatientNotes([]);
        setBillingStatus("");
        setBillingError(loadError instanceof Error ? loadError.message : "Failed to load consultation notes.");
      })
      .finally(() => {
        if (active) setIsBillingNotesLoading(false);
      });
    return () => { active = false; };
  }, [gateway, patient.id]);

  useEffect(() => {
    if (!latestConsultationNote) {
      setBillingSuggestions(null);
      setIsBillingSuggestionsLoading(false);
      return;
    }
    let active = true;
    setIsBillingSuggestionsLoading(true);
    void gateway.loadBillingSuggestions(latestConsultationNote.id)
      .then((response) => {
        if (active) setBillingSuggestions(response);
      })
      .catch((loadError) => {
        if (!active) return;
        setBillingSuggestions(null);
        setBillingError(loadError instanceof Error ? loadError.message : "Failed to load billing suggestions.");
      })
      .finally(() => {
        if (active) setIsBillingSuggestionsLoading(false);
      });
    return () => { active = false; };
  }, [gateway, latestConsultationNote]);

  useEffect(() => {
    if (
      !isCatalogLoaded
      || isCatalogLoading
      || isBillingNotesLoading
      || isBillingSuggestionsLoading
      || hasSeededBillingDraft
      || isInvoiceDirty
    ) {
      return;
    }
    setInvoiceItems(autoDraftInvoiceItems);
    setSavedInvoice(null);
    setIsInvoiceDirty(false);
    setBillingError("");
    setBillingStatus("");
    setAmountPaidInput("");
    setHasSeededBillingDraft(true);
  }, [
    autoDraftInvoiceItems,
    hasSeededBillingDraft,
    isBillingNotesLoading,
    isBillingSuggestionsLoading,
    isCatalogLoaded,
    isCatalogLoading,
    isInvoiceDirty,
  ]);

  function clearFeedback() {
    setBillingStatus("");
    setBillingError("");
  }

  function markDirty() {
    clearFeedback();
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
    setInvoiceItems((current) => [...current, {
      id: createId(),
      catalog_item_id: null,
      item_type: "service",
      label,
      quantity,
      unit_price: amount / quantity,
    }]);
    setCustomItemLabel("");
    setCustomItemQuantity("1");
    setCustomItemUnitPrice("");
    markDirty();
  }

  function addCatalogItem(item: CatalogItem) {
    if (item.track_inventory && item.stock_quantity <= 0) {
      setBillingError(`No stock left for ${item.name}.`);
      return;
    }
    setInvoiceItems((current) => [...current, {
      id: createId(),
      catalog_item_id: item.id,
      item_type: item.item_type,
      label: item.name,
      quantity: 1,
      unit_price: item.default_price,
    }]);
    markDirty();
  }

  function updateInvoiceItem(itemId: string, patch: Partial<DraftInvoiceItem>) {
    setInvoiceItems((current) => current.map((item) => item.id === itemId ? { ...item, ...patch } : item));
    markDirty();
  }

  function removeInvoiceItem(itemId: string) {
    setInvoiceItems((current) => current.filter((item) => item.id !== itemId));
    markDirty();
  }

  function updateRecipientEmail(value: string) {
    setRecipientEmail(value);
    clearFeedback();
  }

  function updatePaymentStatus(status: PaymentStatus) {
    setPaymentStatus(status);
    setAmountPaidInput(status === "partial" ? invoiceTotal.toFixed(2) : "");
    markDirty();
  }

  function updateAmountPaid(value: string) {
    setAmountPaidInput(value);
    markDirty();
  }

  function buildInvoicePayload(): InvoiceCreatePayload {
    if (!invoiceItems.length) {
      throw new Error("Add at least one service or medicine.");
    }
    return {
      invoice_id: savedInvoice?.id ?? null,
      patient_id: patient.id,
      items: invoiceItems.map((item) => ({
        catalog_item_id: item.catalog_item_id ?? null,
        item_type: item.item_type,
        label: item.label,
        quantity: item.quantity,
        unit_price: item.unit_price,
      })),
      payment_status: paymentStatus,
      amount_paid: paymentStatus === "partial" ? normalizedAmountPaid : undefined,
    };
  }

  async function saveInvoiceDraft() {
    const saved = await gateway.createInvoice(buildInvoicePayload());
    setSavedInvoice(saved);
    setIsInvoiceDirty(false);
    return saved;
  }

  async function ensureSavedInvoice() {
    return !savedInvoice || isInvoiceDirty ? saveInvoiceDraft() : savedInvoice;
  }

  async function createBill() {
    const wasUpdating = Boolean(savedInvoice);
    setIsSavingInvoice(true);
    clearFeedback();
    try {
      await saveInvoiceDraft();
      setBillingStatus(wasUpdating ? "Invoice Updated" : "Invoice Created");
    } catch (createError) {
      setBillingError(createError instanceof Error ? createError.message : "Failed to create bill.");
    } finally {
      setIsSavingInvoice(false);
    }
  }

  async function prepareInvoicePdf(action: "preview" | "print" = "preview") {
    setIsPreparingInvoicePdf(true);
    clearFeedback();
    try {
      const invoice = await ensureSavedInvoice();
      const blob = await gateway.generateInvoicePdf(invoice.id);
      if (action === "print") {
        printBlob(blob, `${patient.name.replace(/\s+/g, "_") || "patient"}_invoice.pdf`);
        setBillingStatus("Print dialog opened.");
      } else {
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
        setBillingStatus("Invoice PDF ready.");
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (pdfError) {
      setBillingError(pdfError instanceof Error ? pdfError.message : "Failed to prepare invoice PDF.");
    } finally {
      setIsPreparingInvoicePdf(false);
    }
  }

  async function shareInvoice() {
    const normalizedEmail = recipientEmail.trim();
    if (!normalizedEmail) {
      setBillingError("This patient does not have an email address saved.");
      return;
    }
    setIsSendingInvoice(true);
    clearFeedback();
    try {
      const invoice = await ensureSavedInvoice();
      const result = await gateway.sendInvoice({ invoice_id: invoice.id, recipient_email: normalizedEmail });
      setSavedInvoice(result.invoice);
      setBillingStatus(result.message);
      await onCompleted(patient.id);
    } catch (sendError) {
      setBillingError(sendError instanceof Error ? sendError.message : "Failed to mark invoice as shared.");
    } finally {
      setIsSendingInvoice(false);
    }
  }

  async function shareInvoiceWhatsApp() {
    if (!patient.phone.trim()) {
      setBillingError("This patient does not have a phone number saved.");
      return;
    }
    setIsSendingInvoiceWhatsApp(true);
    clearFeedback();
    try {
      const invoice = await ensureSavedInvoice();
      const result = await gateway.sendInvoiceWhatsApp({ invoice_id: invoice.id, recipient_phone: patient.phone });
      setBillingStatus(result.message);
      cancelWhatsAppTrackingRef.current?.();
      cancelWhatsAppTrackingRef.current = trackWhatsAppDelivery(result.delivery, "Invoice", (message, delivery) => {
        if (delivery.status === "failed") {
          setBillingError(message);
          return;
        }
        setBillingStatus(message);
      });
      setSavedInvoice(result.invoice);
      await onCompleted(patient.id);
    } catch (sendError) {
      setBillingError(sendError instanceof Error ? sendError.message : "Failed to send invoice on WhatsApp.");
    } finally {
      setIsSendingInvoiceWhatsApp(false);
    }
  }

  async function finalizeInvoice() {
    setIsFinalizingInvoice(true);
    clearFeedback();
    try {
      const invoice = await ensureSavedInvoice();
      const result = await gateway.finalizeInvoice({ invoice_id: invoice.id });
      setSavedInvoice(result.invoice);
      setBillingStatus(result.message);
      await onCompleted(patient.id, { refreshDashboard: true });
    } catch (finalizeError) {
      setBillingError(finalizeError instanceof Error ? finalizeError.message : "Failed to complete invoice.");
    } finally {
      setIsFinalizingInvoice(false);
    }
  }

  return {
    patient,
    serviceItems,
    medicineItems,
    invoiceItems,
    invoiceTaxTotals,
    invoiceTotal,
    normalizedAmountPaid,
    balanceDue,
    paymentStatus,
    amountPaidInput,
    billingError,
    billingStatus,
    savedInvoice,
    isSavingInvoice,
    isFinalizingInvoice,
    isPreparingInvoicePdf,
    isSendingInvoice,
    isSendingInvoiceWhatsApp,
    customItemLabel,
    customItemQuantity,
    customItemUnitPrice,
    recipientEmail,
    setCustomItemLabel,
    setCustomItemQuantity,
    setCustomItemUnitPrice,
    updateRecipientEmail,
    addCustomInvoiceItem,
    addCatalogItem,
    updateInvoiceItem,
    removeInvoiceItem,
    createBill,
    updatePaymentStatus,
    updateAmountPaid,
    prepareInvoicePdf,
    finalizeInvoice,
    shareInvoice,
    shareInvoiceWhatsApp,
  };
}

export type BillingWorkflow = ReturnType<typeof useBillingWorkflow>;
