"use client";

import { FormEvent } from "react";
import { Pill, Stethoscope, Trash2 } from "lucide-react";

import { AuthUser, CatalogItem } from "@/lib/types";

export type CatalogFormState = {
  name: string;
  item_type: "service" | "medicine";
  default_price: string;
  track_inventory: boolean;
  stock_quantity: string;
  low_stock_threshold: string;
  unit: string;
};

interface SettingsDrawerInventoryPanelProps {
  currentUser: AuthUser | null;
  catalogForm: CatalogFormState;
  catalogError: string;
  catalogStatus: string;
  isSavingCatalog: boolean;
  serviceItems: CatalogItem[];
  medicineItems: CatalogItem[];
  stockAdjustments: Record<string, string>;
  adjustingStockId: string;
  deletingCatalogId: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onCatalogFormChange: (patch: Partial<CatalogFormState>) => void;
  onStockAdjustmentChange: (itemId: string, value: string) => void;
  onAdjustStock: (itemId: string) => void | Promise<void>;
  onDeleteCatalogItem: (itemId: string) => void | Promise<void>;
}

export function SettingsDrawerInventoryPanel({
  currentUser,
  catalogForm,
  catalogError,
  catalogStatus,
  isSavingCatalog,
  serviceItems,
  medicineItems,
  stockAdjustments,
  adjustingStockId,
  deletingCatalogId,
  onSubmit,
  onCatalogFormChange,
  onStockAdjustmentChange,
  onAdjustStock,
  onDeleteCatalogItem,
}: SettingsDrawerInventoryPanelProps) {
  return (
    <div className="space-y-4">
      <form className="rounded-[28px] border border-sky-200 bg-white p-5" onSubmit={onSubmit}>
        <div className="mb-4">
          <h3 className="text-base font-semibold text-slate-900">Inventory Management</h3>
          <p className="mt-2 text-sm leading-7 text-slate-600">
            Add and manage the services and medicines your clinic uses so staff can bill from inventory quickly.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Name</span>
            <input
              value={catalogForm.name}
              onChange={(event) => onCatalogFormChange({ name: event.target.value })}
              placeholder="Consultation, Injection, Paracetamol"
              className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Type</span>
            <select
              value={catalogForm.item_type}
              onChange={(event) =>
                onCatalogFormChange({
                  item_type: event.target.value as "service" | "medicine",
                  track_inventory:
                    event.target.value === "medicine"
                      ? catalogForm.track_inventory || true
                      : catalogForm.track_inventory,
                })
              }
              className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
            >
              <option value="service">Service</option>
              <option value="medicine">Medicine</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Default Price</span>
            <input
              value={catalogForm.default_price}
              inputMode="decimal"
              onChange={(event) => onCatalogFormChange({ default_price: event.target.value })}
              placeholder="500"
              className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Unit</span>
            <input
              value={catalogForm.unit}
              onChange={(event) => onCatalogFormChange({ unit: event.target.value })}
              placeholder="per visit, each, strip, bottle"
              className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
            />
          </label>
        </div>

        <label className="mt-4 flex items-center gap-3 rounded-2xl border border-sky-100 bg-sky-50/30 px-4 py-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={catalogForm.track_inventory}
            onChange={(event) => onCatalogFormChange({ track_inventory: event.target.checked })}
          />
          Track stock for this inventory item
        </label>

        {catalogForm.track_inventory ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Opening Stock</span>
              <input
                value={catalogForm.stock_quantity}
                inputMode="decimal"
                onChange={(event) => onCatalogFormChange({ stock_quantity: event.target.value })}
                placeholder="100"
                className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Low Stock Threshold</span>
              <input
                value={catalogForm.low_stock_threshold}
                inputMode="decimal"
                onChange={(event) => onCatalogFormChange({ low_stock_threshold: event.target.value })}
                placeholder="10"
                className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
              />
            </label>
          </div>
        ) : null}

        {catalogError ? <p className="mt-4 text-sm font-medium text-rose-600">{catalogError}</p> : null}
        {catalogStatus ? <p className="mt-4 text-sm font-medium text-emerald-700">{catalogStatus}</p> : null}

        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={isSavingCatalog || currentUser?.role !== "admin"}
            className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
          >
            {isSavingCatalog ? "Saving..." : "Save Inventory Item"}
          </button>
        </div>
      </form>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-[28px] border border-sky-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-sky-700" />
            <h3 className="text-base font-semibold text-slate-900">Services</h3>
          </div>
          <div className="space-y-3">
            {serviceItems.length ? serviceItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-2xl border border-sky-100 bg-sky-50/30 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{item.name}</p>
                  <p className="mt-1 text-xs text-slate-600">{item.unit || "per entry"} · {item.default_price.toFixed(2)}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.track_inventory
                      ? `Stock ${item.stock_quantity} · Low at ${item.low_stock_threshold}`
                      : "Stock not tracked"}
                  </p>
                  {item.track_inventory ? (
                    <div className="mt-2 flex gap-2">
                      <input
                        value={stockAdjustments[item.id] ?? ""}
                        inputMode="decimal"
                        onChange={(event) => onStockAdjustmentChange(item.id, event.target.value)}
                        placeholder="+10 / -2"
                        className="w-28 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs text-slate-800 outline-none"
                      />
                      <button
                        type="button"
                        disabled={adjustingStockId === item.id || currentUser?.role !== "admin"}
                        onClick={() => onAdjustStock(item.id)}
                        className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-sky-50 disabled:opacity-50"
                      >
                        {adjustingStockId === item.id ? "Updating..." : "Adjust"}
                      </button>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={deletingCatalogId === item.id || currentUser?.role !== "admin"}
                  onClick={() => onDeleteCatalogItem(item.id)}
                  className="rounded-full border border-sky-200 p-2 text-slate-600 transition hover:bg-white disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )) : <p className="text-sm text-slate-600">No services added yet.</p>}
          </div>
        </div>

        <div className="rounded-[28px] border border-sky-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <Pill className="h-4 w-4 text-sky-700" />
            <h3 className="text-base font-semibold text-slate-900">Medicines</h3>
          </div>
          <div className="space-y-3">
            {medicineItems.length ? medicineItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-2xl border border-sky-100 bg-sky-50/30 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{item.name}</p>
                  <p className="mt-1 text-xs text-slate-600">{item.unit || "per entry"} · {item.default_price.toFixed(2)}</p>
                  <p className={`mt-1 text-xs ${item.track_inventory && item.stock_quantity <= item.low_stock_threshold ? "text-amber-700" : "text-slate-500"}`}>
                    {item.track_inventory
                      ? `Stock ${item.stock_quantity} · Low at ${item.low_stock_threshold}`
                      : "Stock not tracked"}
                  </p>
                  {item.track_inventory ? (
                    <div className="mt-2 flex gap-2">
                      <input
                        value={stockAdjustments[item.id] ?? ""}
                        inputMode="decimal"
                        onChange={(event) => onStockAdjustmentChange(item.id, event.target.value)}
                        placeholder="+10 / -2"
                        className="w-28 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs text-slate-800 outline-none"
                      />
                      <button
                        type="button"
                        disabled={adjustingStockId === item.id || currentUser?.role !== "admin"}
                        onClick={() => onAdjustStock(item.id)}
                        className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-sky-50 disabled:opacity-50"
                      >
                        {adjustingStockId === item.id ? "Updating..." : "Adjust"}
                      </button>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={deletingCatalogId === item.id || currentUser?.role !== "admin"}
                  onClick={() => onDeleteCatalogItem(item.id)}
                  className="rounded-full border border-sky-200 p-2 text-slate-600 transition hover:bg-white disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )) : <p className="text-sm text-slate-600">No medicines added yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
