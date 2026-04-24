"use client";

import { ReceiptIndianRupee, Trash2 } from "lucide-react";

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
  isSavingInvoice: boolean;
  isPreparingInvoicePdf: boolean;
  isSendingInvoice: boolean;
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
  onSendInvoice: () => void | Promise<void>;
}

export function SettingsDrawerBillingPanel({
  patients,
  selectedBillingPatientId,
  selectedBillingPatient,
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
  isSavingInvoice,
  isPreparingInvoicePdf,
  isSendingInvoice,
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
  onSendInvoice,
}: SettingsDrawerBillingPanelProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
      <div className="rounded-[28px] border border-sky-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <ReceiptIndianRupee className="h-4 w-4 text-sky-700" />
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
                className={`w-full rounded-[24px] border px-4 py-3 text-left transition ${
                  active ? "border-sky-300 bg-sky-50" : "border-sky-100 bg-white hover:bg-sky-50/50"
                }`}
              >
                <p className="text-sm font-semibold text-slate-900">{patient.name}</p>
                <p className="mt-1 text-xs text-slate-600">{patient.reason}</p>
              </button>
            );
          }) : <p className="text-sm text-slate-600">No done patients yet.</p>}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-[28px] border border-sky-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                {selectedBillingPatient ? `Billing for ${selectedBillingPatient.name}` : "Billing"}
              </h3>
            </div>
            <div className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700">
              {paymentStatus.charAt(0).toUpperCase() + paymentStatus.slice(1)}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(["paid", "partial", "unpaid"] as PaymentStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => onPaymentStatusChange(status)}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                  paymentStatus === status
                    ? "border-sky-300 bg-sky-100 text-sky-800"
                    : "border-sky-200 bg-white text-slate-700 hover:bg-sky-50"
                }`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <div className="xl:col-span-2 rounded-[24px] border border-sky-100 bg-sky-50/40 p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
                <label className="flex-1">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Item</span>
                  <input
                    value={customItemLabel}
                    onChange={(event) => onCustomItemLabelChange(event.target.value)}
                    placeholder="e.g. Procedure charge, dressing, emergency fee"
                    className="w-full rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                  />
                </label>
                <label>
                  <span className="mb-2 block text-sm font-medium text-slate-700">Qty</span>
                  <input
                    value={customItemQuantity}
                    inputMode="decimal"
                    onChange={(event) => onCustomItemQuantityChange(event.target.value)}
                    className="w-24 rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                  />
                </label>
                <label>
                  <span className="mb-2 block text-sm font-medium text-slate-700">Price</span>
                  <input
                    value={customItemUnitPrice}
                    inputMode="decimal"
                    onChange={(event) => onCustomItemUnitPriceChange(event.target.value)}
                    className="w-32 rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={onAddCustomItem}
                  className="rounded-full bg-sky-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-sky-600"
                >
                  Add
                </button>
              </div>
            </div>
            <div>
              <p className="mb-3 text-sm font-semibold text-slate-800">Services</p>
              <div className="flex flex-wrap gap-2">
                {serviceItems.length ? serviceItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onAddCatalogItem(item)}
                    disabled={item.track_inventory && item.stock_quantity <= 0}
                    className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-slate-700 transition hover:bg-sky-100"
                  >
                    {item.name} · {item.default_price.toFixed(2)}
                    {item.track_inventory ? ` · Stock ${item.stock_quantity}` : ""}
                  </button>
                )) : <p className="text-sm text-slate-600">No services in inventory.</p>}
              </div>
            </div>
            <div>
              <p className="mb-3 text-sm font-semibold text-slate-800">Medicines</p>
              <div className="flex flex-wrap gap-2">
                {medicineItems.length ? medicineItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onAddCatalogItem(item)}
                    disabled={item.track_inventory && item.stock_quantity <= 0}
                    className="rounded-full border border-sky-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-sky-50"
                  >
                    {item.name} · {item.default_price.toFixed(2)}
                    {item.track_inventory ? ` · Stock ${item.stock_quantity}` : ""}
                  </button>
                )) : <p className="text-sm text-slate-600">No medicines in inventory.</p>}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-sky-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">Invoice Items</h3>
            <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
              {invoiceItems.length} item{invoiceItems.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="space-y-3">
            {invoiceItems.length ? invoiceItems.map((item) => (
              <div key={item.id} className="grid gap-3 rounded-[24px] border border-sky-100 bg-sky-50/30 p-4 md:grid-cols-[1.3fr_120px_140px_44px]">
                <div>
                  <p className="text-sm font-medium text-slate-900">{item.label}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">{item.item_type}</p>
                </div>
                <input
                  value={item.quantity}
                  inputMode="decimal"
                  onChange={(event) => onUpdateInvoiceItem(item.id, { quantity: Number(event.target.value) || 0 })}
                  className="rounded-2xl border border-sky-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none"
                />
                <input
                  value={item.unit_price}
                  inputMode="decimal"
                  onChange={(event) => onUpdateInvoiceItem(item.id, { unit_price: Number(event.target.value) || 0 })}
                  className="rounded-2xl border border-sky-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none"
                />
                <button
                  type="button"
                  onClick={() => onRemoveInvoiceItem(item.id)}
                  className="rounded-full border border-sky-200 p-2 text-slate-600 transition hover:bg-white"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )) : <p className="text-sm text-slate-600">Add services or medicines from the inventory to start billing.</p>}
          </div>

          <div className="mt-5 rounded-[24px] border border-sky-100 bg-sky-50/40 p-4">
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
            <div className="mt-4 rounded-[24px] border border-amber-200 bg-amber-50/70 p-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Amount Received</span>
                <input
                  value={amountPaidInput}
                  inputMode="decimal"
                  onChange={(event) => onAmountPaidChange(event.target.value)}
                  placeholder="Enter amount received"
                  className="mt-2 w-full rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                />
              </label>
              <p className="mt-2 text-xs text-amber-800">Partial invoices require an amount greater than zero and less than the total.</p>
            </div>
          ) : null}

          {selectedBillingPatient ? (
            <div className="mt-4 rounded-[24px] border border-sky-100 bg-sky-50/40 p-4">
              <p className="text-sm font-medium text-slate-700">Patient Recipient</p>
              <p className="mt-2 text-sm text-slate-900">{selectedBillingPatient.email || "No patient email saved."}</p>
            </div>
          ) : null}

          {billingError ? <p className="mt-4 text-sm font-medium text-rose-600">{billingError}</p> : null}
          {billingStatus ? <p className="mt-4 text-sm font-medium text-emerald-700">{billingStatus}</p> : null}

          <div className="mt-5 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={onCreateBill}
              disabled={isSavingInvoice}
              className="rounded-full border border-sky-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
            >
              {isSavingInvoice ? "Saving..." : savedInvoice ? "Recreate Invoice" : "Create Invoice"}
            </button>
            <button
              type="button"
              onClick={onPreviewPdf}
              disabled={isPreparingInvoicePdf}
              className="rounded-full border border-sky-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
            >
              Preview PDF
            </button>
            <button
              type="button"
              onClick={onSendInvoice}
              disabled={isSendingInvoice || isSavingInvoice}
              className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
            >
              {isSendingInvoice ? "Sending..." : "Send Email"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
