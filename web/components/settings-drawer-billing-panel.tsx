"use client";

import { ReceiptIndianRupee, Trash2 } from "lucide-react";

import { CatalogItem, Invoice, Patient } from "@/lib/types";

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
  billingError: string;
  billingStatus: string;
  isSavingInvoice: boolean;
  isPreparingInvoicePdf: boolean;
  isSendingInvoice: boolean;
  savedInvoice: Invoice | null;
  onSelectPatient: (patientId: string) => void;
  onAddCatalogItem: (item: CatalogItem) => void;
  onUpdateInvoiceItem: (itemId: string, patch: Partial<DraftInvoiceItem>) => void;
  onRemoveInvoiceItem: (itemId: string) => void;
  onCreateBill: () => void | Promise<void>;
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
  billingError,
  billingStatus,
  isSavingInvoice,
  isPreparingInvoicePdf,
  isSendingInvoice,
  savedInvoice,
  onSelectPatient,
  onAddCatalogItem,
  onUpdateInvoiceItem,
  onRemoveInvoiceItem,
  onCreateBill,
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
              <p className="mt-2 text-sm leading-7 text-slate-600">
                Quick-add services and medicines from your inventory. Bills are recorded as fully paid upfront.
              </p>
            </div>
            <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
              Paid Upfront
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
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
            <div className="mt-2 flex items-center justify-between text-base font-semibold text-slate-900">
              <span>Total</span>
              <span>{invoiceSubtotal.toFixed(2)}</span>
            </div>
          </div>

          {selectedBillingPatient ? (
            <div className="mt-4 rounded-[24px] border border-sky-100 bg-sky-50/40 p-4">
              <p className="text-sm font-medium text-slate-700">Patient Recipient</p>
              <p className="mt-2 text-sm text-slate-900">{selectedBillingPatient.phone}</p>
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
              {isSavingInvoice ? "Saving..." : savedInvoice ? "Recreate Bill" : "Create Bill"}
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
              {isSendingInvoice ? "Saving & Sending..." : "Send Bill"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
