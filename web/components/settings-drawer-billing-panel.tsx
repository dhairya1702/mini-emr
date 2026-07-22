"use client";

import { MessageCircle, Printer, ReceiptIndianRupee, Sparkles, Trash2 } from "lucide-react";

import { CatalogItem, Invoice, Patient, PaymentStatus } from "@/lib/types";

export type DraftInvoiceItem = {
  id: string;
  catalog_item_id?: string | null;
  item_type: "service" | "medicine";
  label: string;
  quantity: number;
  unit_price: number;
};

interface SettingsDrawerBillingPanelProps {
  patients: Patient[];
  selectedBillingPatientId: string;
  selectedBillingPatient: Patient | null;
  showPatientSelector?: boolean;
  serviceItems: CatalogItem[];
  medicineItems: CatalogItem[];
  invoiceItems: DraftInvoiceItem[];
  invoiceSubtotal: number;
  amountPaid: number;
  amountPaidInput: string;
  balanceDue: number;
  paymentStatus: PaymentStatus;
  billingError: string;
  billingStatus: string;
  suggestionNotices?: string[];
  setupWarnings?: string[];
  isSavingInvoice: boolean;
  isFinalizingInvoice: boolean;
  isPreparingInvoicePdf: boolean;
  isSendingInvoice: boolean;
  isSendingInvoiceWhatsApp?: boolean;
  savedInvoice: Invoice | null;
  customItemLabel: string;
  customItemQuantity: string;
  customItemUnitPrice: string;
  onSelectPatient: (patientId: string) => void;
  onAddCatalogItem: (item: CatalogItem) => void;
  onCustomItemLabelChange: (value: string) => void;
  onCustomItemQuantityChange: (value: string) => void;
  onCustomItemUnitPriceChange: (value: string) => void;
  onAddCustomItem: () => void | Promise<void>;
  onUpdateInvoiceItem: (itemId: string, patch: Partial<DraftInvoiceItem>) => void;
  onRemoveInvoiceItem: (itemId: string) => void;
  onCreateBill: () => void | Promise<void>;
  onPaymentStatusChange: (status: PaymentStatus) => void;
  onAmountPaidChange: (value: string) => void;
  onPreviewPdf: () => void | Promise<void>;
  onPrintInvoice: () => void | Promise<void>;
  onFinalizeInvoice: () => void | Promise<void>;
  onSendInvoice: () => void | Promise<void>;
  onSendInvoiceWhatsApp?: () => void | Promise<void>;
}

export function SettingsDrawerBillingPanel({
  patients,
  selectedBillingPatientId,
  selectedBillingPatient,
  showPatientSelector = true,
  serviceItems,
  medicineItems,
  invoiceItems,
  invoiceSubtotal,
  amountPaid,
  amountPaidInput,
  balanceDue,
  paymentStatus,
  billingError,
  billingStatus,
  suggestionNotices = [],
  setupWarnings = [],
  isSavingInvoice,
  isFinalizingInvoice,
  isPreparingInvoicePdf,
  isSendingInvoice,
  isSendingInvoiceWhatsApp = false,
  savedInvoice,
  customItemLabel,
  customItemQuantity,
  customItemUnitPrice,
  onSelectPatient,
  onAddCatalogItem,
  onCustomItemLabelChange,
  onCustomItemQuantityChange,
  onCustomItemUnitPriceChange,
  onAddCustomItem,
  onUpdateInvoiceItem,
  onRemoveInvoiceItem,
  onCreateBill,
  onPaymentStatusChange,
  onAmountPaidChange,
  onPreviewPdf,
  onPrintInvoice,
  onFinalizeInvoice,
  onSendInvoice,
  onSendInvoiceWhatsApp,
}: SettingsDrawerBillingPanelProps) {
  const invoiceCatalogItemIds = new Set(
    invoiceItems
      .map((item) => item.catalog_item_id)
      .filter((itemId): itemId is string => Boolean(itemId)),
  );
  const recommendationItems = [...serviceItems, ...medicineItems].filter((item) => {
    const normalizedName = item.name.trim().toLowerCase();
    const normalizedAliases = item.aliases.map((alias) => alias.trim().toLowerCase());
    if (normalizedName === "consultation" || normalizedAliases.includes("consultation")) {
      return false;
    }
    if (invoiceCatalogItemIds.has(item.id)) {
      return false;
    }
    return !item.track_inventory || item.stock_quantity > 0;
  });

  return (
    <div className={`grid gap-4 ${showPatientSelector ? "xl:grid-cols-[300px_1fr]" : ""}`}>
      {showPatientSelector ? (
        <div className="rounded-[18px] border border-[#bfd7e8] bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <ReceiptIndianRupee className="h-4 w-4 text-[#2a6fa8]" />
            <div>
              <h3 className="text-base font-semibold text-slate-900">Patients</h3>
              <p className="mt-1 text-sm text-slate-600">Select a patient to prepare billing.</p>
            </div>
          </div>
          <div className="space-y-3">
            {patients.length ? patients.map((patient) => {
              const active = patient.id === selectedBillingPatientId;
              return (
                <button
                  key={patient.id}
                  type="button"
                  onClick={() => onSelectPatient(patient.id)}
                  className={`w-full rounded-[16px] border px-4 py-3 text-left transition ${
                    active ? "border-[#9fc7e1] bg-[#f3f8fb]" : "border-[#dbe7ef] bg-white hover:bg-[#f3f8fb]/50"
                  }`}
                >
                  <p className="text-sm font-semibold text-slate-900">{patient.name}</p>
                  <p className="mt-1 text-xs text-slate-600">{patient.reason}</p>
                </button>
              );
            }) : <p className="text-sm text-slate-600">No done patients yet.</p>}
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="rounded-[18px] border border-[#bfd7e8] bg-white p-5">
          <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                {selectedBillingPatient ? `Invoice Items for ${selectedBillingPatient.name}` : "Invoice Items"}
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(["paid", "partial", "unpaid"] as PaymentStatus[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => onPaymentStatusChange(status)}
                  className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                    paymentStatus === status
                      ? "border-[#9fc7e1] bg-[#dbeaf4] text-[#235f8e]"
                      : "border-[#bfd7e8] bg-white text-slate-700 hover:bg-[#f3f8fb]"
                  }`}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ))}
              <span className="rounded-xl border border-[#bfd7e8] bg-[#f3f8fb] px-3 py-1 text-xs font-medium text-[#2a6fa8]">
                {invoiceItems.length} item{invoiceItems.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            {setupWarnings.length ? (
              <div className="rounded-[16px] border border-amber-200 bg-amber-50/80 p-4 text-sm leading-6 text-amber-900">
                {setupWarnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
            {invoiceItems.length ? invoiceItems.map((item) => (
              <div key={item.id} className="grid gap-3 rounded-[16px] border border-[#dbe7ef] bg-[#f3f8fb]/30 p-4 md:grid-cols-[1.3fr_120px_140px_44px]">
                <div>
                  <p className="text-sm font-medium text-slate-900">{item.label}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">{item.item_type}</p>
                </div>
                <input
                  value={item.quantity}
                  inputMode="decimal"
                  onChange={(event) => onUpdateInvoiceItem(item.id, { quantity: Number(event.target.value) || 0 })}
                  className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-2 text-sm text-slate-800 outline-none"
                />
                <input
                  value={item.unit_price}
                  inputMode="decimal"
                  onChange={(event) => onUpdateInvoiceItem(item.id, { unit_price: Number(event.target.value) || 0 })}
                  className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-2 text-sm text-slate-800 outline-none"
                />
                <button
                  type="button"
                  onClick={() => onRemoveInvoiceItem(item.id)}
                  className="rounded-xl border border-[#bfd7e8] p-2 text-slate-600 transition hover:bg-white"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )) : <p className="text-sm text-slate-600">Add services or medicines from the inventory to start billing.</p>}
          </div>

          {recommendationItems.length ? (
            <div className="mt-5 rounded-[16px] border border-[#cfe3f3] bg-gradient-to-br from-[#f3f9fe] to-[#eaf4fc] p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#2f8fd3]/10 text-[#2f8fd3]">
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <p className="text-sm font-semibold text-[#1d4d72]">Recommendation</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {recommendationItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onAddCatalogItem(item)}
                    className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 shadow-sm shadow-[#2f8fd3]/5 transition hover:bg-[#f8fcff]"
                  >
                    Add {item.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-5 rounded-[16px] border border-[#dbe7ef] bg-[#f3f8fb]/40 p-4">
            <p className="mb-3 text-sm font-medium text-slate-700">Manual item</p>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
              <label className="flex-1">
                <span className="mb-2 block text-sm font-medium text-slate-700">Item</span>
                <input
                  value={customItemLabel}
                  onChange={(event) => onCustomItemLabelChange(event.target.value)}
                  placeholder="e.g. Procedure charge, dressing, emergency fee"
                  className="w-full rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                />
              </label>
              <label>
                <span className="mb-2 block text-sm font-medium text-slate-700">Qty</span>
                <input
                  value={customItemQuantity}
                  inputMode="decimal"
                  onChange={(event) => onCustomItemQuantityChange(event.target.value)}
                  className="w-24 rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                />
              </label>
              <label>
                <span className="mb-2 block text-sm font-medium text-slate-700">Price</span>
                <input
                  value={customItemUnitPrice}
                  inputMode="decimal"
                  onChange={(event) => onCustomItemUnitPriceChange(event.target.value)}
                  className="w-32 rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                />
              </label>
              <button
                type="button"
                onClick={onAddCustomItem}
                className="rounded-xl bg-[#2f8fd3] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#287fc0]"
              >
                Add
              </button>
            </div>
          </div>

          <div className="mt-5 rounded-[16px] border border-[#dbe7ef] bg-[#f3f8fb]/40 p-4">
            <div className="flex items-center justify-between text-sm text-slate-700">
              <span>Subtotal</span>
              <span>{invoiceSubtotal.toFixed(2)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm text-slate-700">
              <span>Amount Paid</span>
              <span>{amountPaid.toFixed(2)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm text-slate-700">
              <span>Balance Due</span>
              <span>{balanceDue.toFixed(2)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-base font-semibold text-slate-900">
              <span>Total</span>
              <span>{invoiceSubtotal.toFixed(2)}</span>
            </div>
          </div>

          {paymentStatus === "partial" ? (
            <div className="mt-4 rounded-[16px] border border-amber-200 bg-amber-50/70 p-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Amount Received</span>
                <input
                  value={amountPaidInput}
                  inputMode="decimal"
                  onChange={(event) => onAmountPaidChange(event.target.value)}
                  placeholder="Enter amount received"
                  className="mt-2 w-full rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                />
              </label>
            </div>
          ) : null}

          {selectedBillingPatient ? (
            <div className="mt-4 rounded-[16px] border border-[#dbe7ef] bg-[#f3f8fb]/40 p-4">
              <p className="text-sm font-medium text-slate-700">Patient Recipient</p>
              <p className="mt-2 text-sm text-slate-900">{selectedBillingPatient.email || "No patient email saved."}</p>
            </div>
          ) : null}

          {billingError ? <p className="mt-4 text-sm font-medium text-rose-600">{billingError}</p> : null}
          {billingStatus ? <p className="mt-4 text-sm font-medium text-emerald-700">{billingStatus}</p> : null}
          {suggestionNotices.length ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">Review consultation suggestions</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {suggestionNotices.map((notice) => <li key={notice}>{notice}</li>)}
              </ul>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={onCreateBill}
              disabled={isSavingInvoice}
              className="rounded-xl border border-[#9fc7e1] bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-[#f3f8fb] disabled:opacity-60"
            >
              {isSavingInvoice ? "Saving..." : savedInvoice ? "Save Changes" : "Create Invoice"}
            </button>
            <button
              type="button"
              onClick={onFinalizeInvoice}
              disabled={isFinalizingInvoice || isSavingInvoice}
              className="rounded-xl border border-[#9fc7e1] bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-[#f3f8fb] disabled:opacity-60"
            >
              {isFinalizingInvoice ? "Completing..." : "Done"}
            </button>
            <button
              type="button"
              onClick={onPreviewPdf}
              disabled={isPreparingInvoicePdf}
              className="rounded-xl border border-[#9fc7e1] bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-[#f3f8fb] disabled:opacity-60"
            >
              Preview
            </button>
            <button
              type="button"
              onClick={onPrintInvoice}
              disabled={isPreparingInvoicePdf}
              className="inline-flex items-center gap-2 rounded-xl border border-[#9fc7e1] bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-[#f3f8fb] disabled:opacity-60"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
            <button
              type="button"
              onClick={onSendInvoice}
              disabled={isSendingInvoice || isSavingInvoice}
              className="rounded-xl bg-[#2f8fd3] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
            >
              {isSendingInvoice ? "Sending..." : "Send Email"}
            </button>
            <button
              type="button"
              onClick={onSendInvoiceWhatsApp}
              disabled={!onSendInvoiceWhatsApp || isSendingInvoiceWhatsApp || isSavingInvoice}
              className="inline-flex items-center gap-2 rounded-xl bg-[#1f9d68] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#18885a] disabled:opacity-60"
            >
              <MessageCircle className="h-4 w-4" />
              {isSendingInvoiceWhatsApp ? "Sending..." : "Send WhatsApp"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
