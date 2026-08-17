"use client";

import { MessageCircle, Printer, ReceiptIndianRupee, Sparkles, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";

import type { DraftInvoiceItem } from "@/features/dashboard/billing/billing-draft";
import { CatalogItem, Invoice, Patient, PaymentStatus } from "@/lib/types";

export type { DraftInvoiceItem } from "@/features/dashboard/billing/billing-draft";

interface SettingsDrawerBillingPanelProps {
  patients: Patient[];
  selectedBillingPatientId: string;
  selectedBillingPatient: Patient | null;
  showPatientSelector?: boolean;
  patientListFooter?: ReactNode;
  serviceItems: CatalogItem[];
  medicineItems: CatalogItem[];
  invoiceItems: DraftInvoiceItem[];
  invoiceSubtotal: number;
  invoiceTaxTotal: number;
  invoiceCgstTotal: number;
  invoiceSgstTotal: number;
  invoiceTotal: number;
  amountPaid: number;
  amountPaidInput: string;
  balanceDue: number;
  paymentStatus: PaymentStatus;
  billingError: string;
  billingStatus: string;
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
  recipientEmail?: string;
  onSelectPatient: (patientId: string) => void;
  onAddCatalogItem: (item: CatalogItem) => void;
  onCustomItemLabelChange: (value: string) => void;
  onCustomItemQuantityChange: (value: string) => void;
  onCustomItemUnitPriceChange: (value: string) => void;
  onRecipientEmailChange?: (value: string) => void;
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
  onClose?: () => void;
}

export function SettingsDrawerBillingPanel({
  patients,
  selectedBillingPatientId,
  selectedBillingPatient,
  showPatientSelector = true,
  patientListFooter,
  serviceItems,
  medicineItems,
  invoiceItems,
  invoiceSubtotal,
  invoiceTaxTotal,
  invoiceCgstTotal,
  invoiceSgstTotal,
  invoiceTotal,
  amountPaid,
  amountPaidInput,
  balanceDue,
  paymentStatus,
  billingError,
  billingStatus,
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
  recipientEmail,
  onSelectPatient,
  onAddCatalogItem,
  onCustomItemLabelChange,
  onCustomItemQuantityChange,
  onCustomItemUnitPriceChange,
  onRecipientEmailChange,
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
  onClose,
}: SettingsDrawerBillingPanelProps) {
  const displayedRecipientEmail = recipientEmail ?? selectedBillingPatient?.email ?? "";

  function lineAmount(item: DraftInvoiceItem) {
    return item.quantity * item.unit_price;
  }

  function updateLineAmount(item: DraftInvoiceItem, rawValue: string) {
    const amount = Number(rawValue);
    const quantity = item.quantity > 0 ? item.quantity : 1;
    onUpdateInvoiceItem(item.id, {
      unit_price: Number.isFinite(amount) && amount >= 0 ? amount / quantity : 0,
    });
  }

  const invoiceCatalogItemIds = new Set(
    invoiceItems
      .map((item) => item.catalog_item_id)
      .filter((itemId): itemId is string => Boolean(itemId)),
  );
  const catalogById = new Map(
    [...serviceItems, ...medicineItems].map((item) => [item.id, item]),
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
    <div className={`grid gap-4 ${showPatientSelector ? "xl:grid-cols-[300px_1fr]" : "h-full"}`}>
      {showPatientSelector ? (
        <div className="rounded-[18px] border border-[#bfd7e8] bg-white py-5">
          <div className="mb-4 flex items-center gap-2 px-5">
            <ReceiptIndianRupee className="h-4 w-4 text-[#2a6fa8]" />
            <div>
              <h3 className="text-base font-semibold text-black">Patients</h3>
            </div>
          </div>
          <div className="overflow-hidden border-y border-[#dbe7ef] bg-white">
            {patients.length ? patients.map((patient) => {
              const active = patient.id === selectedBillingPatientId;
              return (
                <button
                  key={patient.id}
                  type="button"
                  onClick={() => onSelectPatient(patient.id)}
                  className={`w-full border-b border-[#dbe7ef] px-4 py-3 text-left transition last:border-b-0 ${
                    active ? "border-l-4 border-l-[#2f8fd3] bg-[#f3f8fb]" : "border-l-4 border-l-transparent bg-white hover:bg-[#f3f8fb]/50"
                  }`}
                >
                  <p className="text-sm font-semibold text-black">{patient.name}</p>
                  <p className="mt-1 text-xs leading-5 text-black">{patient.reason}</p>
                </button>
              );
            }) : <p className="px-4 py-3 text-sm text-black">No done patients yet.</p>}
            {patientListFooter}
          </div>
        </div>
      ) : null}

      <div className={showPatientSelector ? "space-y-4" : "min-h-0"}>
        <div className={`bg-white ${showPatientSelector ? "rounded-[18px] border border-[#bfd7e8] p-5" : "flex h-full min-h-0 flex-col p-1"}`}>
          {onClose ? (
            <div className="mb-3 flex justify-end">
              {onClose ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#dbe7ef] bg-white text-black shadow-sm transition hover:bg-[#f3f8fb]"
                  aria-label="Close billing"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="flex min-h-[480px] flex-1 flex-col overflow-hidden rounded-[14px] border border-[#dbe7ef] bg-white">
            {setupWarnings.length ? (
              <div className="border-b border-amber-200 bg-amber-50/80 p-3 text-sm leading-6 text-amber-900">
                {setupWarnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
            <div className="grid grid-cols-[minmax(0,1fr)_88px_120px_36px] border-b border-[#dbe7ef] bg-[#f3f8fb]/70 px-3 py-2 text-sm font-semibold text-black">
              <span>Item</span>
              <span>Qty</span>
              <span>Amount</span>
              <span />
            </div>
            <div>
              {invoiceItems.length ? invoiceItems.map((item) => (
                <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_88px_120px_36px] items-center gap-3 border-b border-[#edf3f7] px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-black">{item.label}</p>
                    {item.catalog_item_id && catalogById.get(item.catalog_item_id)?.hsn_sac_code ? (
                      <p className="truncate text-[11px] text-[#2a6fa8]">
                        {item.item_type === "service" ? "SAC" : "HSN"} {catalogById.get(item.catalog_item_id)?.hsn_sac_code}
                        {" · "}GST {catalogById.get(item.catalog_item_id)?.gst_rate}%
                      </p>
                    ) : null}
                  </div>
                  <input
                    value={item.quantity}
                    disabled={item.item_type === "program"}
                    inputMode="decimal"
                    aria-label={`${item.label} quantity`}
                    onChange={(event) => onUpdateInvoiceItem(item.id, { quantity: item.item_type === "program" ? 1 : Number(event.target.value) || 0 })}
                    className="h-8 rounded-md border border-transparent bg-transparent px-2 text-sm text-black outline-none transition hover:border-[#dbe7ef] hover:bg-[#f8fbfd] focus:border-[#9fc7e1] focus:bg-white"
                  />
                  <input
                    value={lineAmount(item)}
                    inputMode="decimal"
                    aria-label={`${item.label} amount`}
                    onChange={(event) => updateLineAmount(item, event.target.value)}
                    className="h-8 rounded-md border border-transparent bg-transparent px-2 text-sm text-black outline-none transition hover:border-[#dbe7ef] hover:bg-[#f8fbfd] focus:border-[#9fc7e1] focus:bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveInvoiceItem(item.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-black transition hover:border-[#dbe7ef] hover:bg-[#f3f8fb]"
                    aria-label={`Remove ${item.label}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )) : (
                <p className="border-b border-[#edf3f7] px-3 py-4 text-sm text-black">Add services or medicines from the inventory to start billing.</p>
              )}
            </div>
            <div className="min-h-[220px] flex-1 border-b border-[#edf3f7]" aria-hidden="true" />
            <div className="grid grid-cols-[minmax(0,1fr)_88px_120px_72px] items-center gap-3 px-3 py-2.5">
              <input
                value={customItemLabel}
                onChange={(event) => onCustomItemLabelChange(event.target.value)}
                placeholder="Enter item"
                className="h-8 rounded-md border border-transparent bg-transparent px-2 text-sm text-black outline-none transition placeholder:text-black hover:border-[#dbe7ef] hover:bg-[#f8fbfd] focus:border-[#9fc7e1] focus:bg-white"
              />
              <input
                value={customItemQuantity}
                inputMode="decimal"
                aria-label="Manual item quantity"
                onChange={(event) => onCustomItemQuantityChange(event.target.value)}
                className="h-8 rounded-md border border-transparent bg-transparent px-2 text-sm text-black outline-none transition hover:border-[#dbe7ef] hover:bg-[#f8fbfd] focus:border-[#9fc7e1] focus:bg-white"
              />
              <input
                value={customItemUnitPrice}
                inputMode="decimal"
                aria-label="Manual item amount"
                onChange={(event) => onCustomItemUnitPriceChange(event.target.value)}
                placeholder="Amount"
                className="h-8 rounded-md border border-transparent bg-transparent px-2 text-sm text-black outline-none transition placeholder:text-black hover:border-[#dbe7ef] hover:bg-[#f8fbfd] focus:border-[#9fc7e1] focus:bg-white"
              />
              <button
                type="button"
                onClick={onAddCustomItem}
                className="h-8 rounded-md bg-[#2f8fd3] px-4 text-sm font-medium text-white transition hover:bg-[#287fc0]"
              >
                Add
              </button>
            </div>
          </div>

          {recommendationItems.length ? (
            <div className="mt-5 rounded-[16px] border border-[#cfe3f3] bg-gradient-to-br from-[#f3f9fe] to-[#eaf4fc] p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#2f8fd3]/10 text-[#2f8fd3]">
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <p className="text-sm font-semibold text-black">Recommendation</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {recommendationItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onAddCatalogItem(item)}
                    className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-2 text-left text-sm font-medium text-black shadow-sm shadow-[#2f8fd3]/5 transition hover:bg-[#f8fcff]"
                  >
                    + {item.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-4 grid gap-6 px-3 lg:grid-cols-[minmax(0,360px)_minmax(260px,360px)_minmax(280px,380px)] lg:justify-between">
            <div className="w-full border-t border-[#dbe7ef] pt-3">
              <div className="flex items-center justify-between gap-4 text-sm text-black">
                <span>Email</span>
                {onRecipientEmailChange ? (
                  <input
                    value={displayedRecipientEmail}
                    onChange={(event) => onRecipientEmailChange(event.target.value)}
                    placeholder="-"
                    aria-label="Recipient email"
                    className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-right text-sm text-black outline-none transition placeholder:text-black hover:border-[#dbe7ef] hover:bg-[#f8fbfd] focus:border-[#9fc7e1] focus:bg-white"
                  />
                ) : (
                  <span className="truncate text-right text-black">
                    {displayedRecipientEmail || "-"}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between gap-4 text-sm text-black">
                <span>Number</span>
                <span className="truncate text-right text-black">
                  {selectedBillingPatient?.phone || "-"}
                </span>
              </div>
            </div>

            <div className="w-full border-t border-[#dbe7ef] pt-3">
              <div className="flex items-center justify-between gap-4 text-sm text-black">
                <span>Payment</span>
                <div className="flex items-center justify-end gap-2">
                  {(["paid", "partial", "unpaid"] as PaymentStatus[]).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => onPaymentStatusChange(status)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        paymentStatus === status
                          ? "border-[#9fc7e1] bg-[#dbeaf4] text-[#235f8e]"
                          : "border-[#bfd7e8] bg-white text-black hover:bg-[#f3f8fb]"
                      }`}
                    >
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="w-full border-t border-[#dbe7ef] pt-3">
              <div className="flex items-center justify-between text-sm text-black">
                <span>Subtotal</span>
                <span>{invoiceSubtotal.toFixed(2)}</span>
              </div>
              {invoiceTaxTotal > 0 ? (
                <>
                  <div className="mt-2 flex items-center justify-between text-sm text-black">
                    <span>CGST</span>
                    <span>{invoiceCgstTotal.toFixed(2)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm text-black">
                    <span>SGST</span>
                    <span>{invoiceSgstTotal.toFixed(2)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm text-black">
                    <span>Total GST</span>
                    <span>{invoiceTaxTotal.toFixed(2)}</span>
                  </div>
                </>
              ) : null}
              <div className="mt-2 flex items-center justify-between text-sm text-black">
                <span>Amount Paid</span>
                <span>{amountPaid.toFixed(2)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm text-black">
                <span>Balance Due</span>
                <span>{balanceDue.toFixed(2)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-base font-semibold text-black">
                <span>Total</span>
                <span>{invoiceTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {paymentStatus === "partial" ? (
            <div className="mt-4 rounded-[16px] border border-amber-200 bg-amber-50/70 p-4">
              <label className="block">
                <span className="text-sm font-medium text-black">Amount Received</span>
                <input
                  value={amountPaidInput}
                  inputMode="decimal"
                  onChange={(event) => onAmountPaidChange(event.target.value)}
                  placeholder="Enter amount received"
                  className="mt-2 w-full rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm text-black outline-none placeholder:text-black"
                />
              </label>
            </div>
          ) : null}

          {billingError ? <p className="mt-4 text-sm font-medium text-rose-600">{billingError}</p> : null}
          {billingStatus ? <p className="mt-4 text-sm font-medium text-emerald-700">{billingStatus}</p> : null}
          <div className="mt-5 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={onCreateBill}
              disabled={isSavingInvoice}
              className="rounded-xl border border-[#9fc7e1] bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-[#f3f8fb] disabled:opacity-100"
            >
              {isSavingInvoice ? "Saving..." : savedInvoice ? "Save Changes" : "Create Invoice"}
            </button>
            <button
              type="button"
              onClick={onFinalizeInvoice}
              disabled={isFinalizingInvoice || isSavingInvoice}
              className="rounded-xl border border-[#9fc7e1] bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-[#f3f8fb] disabled:opacity-100"
            >
              {isFinalizingInvoice ? "Completing..." : "Done"}
            </button>
            <button
              type="button"
              onClick={onPreviewPdf}
              disabled={isPreparingInvoicePdf}
              className="rounded-xl border border-[#9fc7e1] bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-[#f3f8fb] disabled:opacity-100"
            >
              Preview
            </button>
            <button
              type="button"
              onClick={onPrintInvoice}
              disabled={isPreparingInvoicePdf}
              className="inline-flex items-center gap-2 rounded-xl border border-[#9fc7e1] bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-[#f3f8fb] disabled:opacity-100"
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
