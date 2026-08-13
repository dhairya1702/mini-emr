"use client";

import { FormEvent } from "react";
import { Pill, Stethoscope, Trash2 } from "lucide-react";

import { canUseInventory } from "@/lib/permissions";
import { AuthUser, CatalogItem } from "@/lib/types";

export type CatalogFormState = {
  name: string;
  item_type: "service" | "medicine";
  default_price: string;
  track_inventory: boolean;
  stock_quantity: string;
  low_stock_threshold: string;
  unit: string;
  hsn_sac_code: string;
  gst_rate: string;
  aliases: string;
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
      <form className="rounded-[18px] border border-[#bfd7e8] bg-white p-5" onSubmit={onSubmit}>
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
              className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
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
              className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
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
              className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Unit</span>
            <input
              value={catalogForm.unit}
              onChange={(event) => onCatalogFormChange({ unit: event.target.value })}
              placeholder="per visit, each, strip, bottle"
              className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
            />
          </label>
        </div>

        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Matching aliases</span>
          <input
            value={catalogForm.aliases}
            onChange={(event) => onCatalogFormChange({ aliases: event.target.value })}
            placeholder="Comma-separated, e.g. strep test, rapid antigen test"
            className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
          />
          <span className="mt-1 block text-xs text-slate-500">Used for exact consultation and billing suggestion matching.</span>
        </label>

        <div className="mt-4 rounded-xl border border-[#dbe7ef] bg-[#f8fbfd] p-4">
          <p className="text-sm font-semibold text-slate-800">GST details (optional)</p>
          <p className="mt-1 text-xs text-slate-500">Leave both blank to keep this item untaxed.</p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">
                {catalogForm.item_type === "service" ? "SAC code" : "HSN code"}
              </span>
              <input
                value={catalogForm.hsn_sac_code}
                inputMode="numeric"
                onChange={(event) => onCatalogFormChange({ hsn_sac_code: event.target.value.replace(/\D/g, "").slice(0, 8) })}
                placeholder="4, 6, or 8 digits"
                className="w-full rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">GST rate</span>
              <select
                value={catalogForm.gst_rate}
                onChange={(event) => onCatalogFormChange({ gst_rate: event.target.value })}
                className="w-full rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
              >
                <option value="">No GST</option>
                <option value="5">5%</option>
                <option value="12">12%</option>
                <option value="18">18%</option>
                <option value="28">28%</option>
              </select>
            </label>
          </div>
        </div>

        <label className="mt-4 flex items-center gap-3 rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/30 px-4 py-3 text-sm text-slate-700">
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
                className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Low Stock Threshold</span>
              <input
                value={catalogForm.low_stock_threshold}
                inputMode="decimal"
                onChange={(event) => onCatalogFormChange({ low_stock_threshold: event.target.value })}
                placeholder="10"
                className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
              />
            </label>
          </div>
        ) : null}

        {catalogError ? <p className="mt-4 text-sm font-medium text-rose-600">{catalogError}</p> : null}
        {catalogStatus ? <p className="mt-4 text-sm font-medium text-emerald-700">{catalogStatus}</p> : null}

        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={isSavingCatalog || !canUseInventory(currentUser?.role)}
            className="rounded-xl bg-[#2f8fd3] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
          >
            {isSavingCatalog ? "Saving..." : "Save Inventory Item"}
          </button>
        </div>
      </form>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-[18px] border border-[#bfd7e8] bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-[#2a6fa8]" />
            <h3 className="text-base font-semibold text-slate-900">Services</h3>
          </div>
          <div className="space-y-3">
            {serviceItems.length ? serviceItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/30 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{item.name}</p>
                  <p className="mt-1 text-xs text-slate-600">{item.unit || "per entry"} · {item.default_price.toFixed(2)}</p>
                  {item.hsn_sac_code && item.gst_rate ? (
                    <p className="mt-1 text-xs font-medium text-[#2a6fa8]">SAC {item.hsn_sac_code} · GST {item.gst_rate}%</p>
                  ) : null}
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
                        className="w-28 rounded-xl border border-[#bfd7e8] bg-white px-3 py-1.5 text-xs text-slate-800 outline-none"
                      />
                      <button
                        type="button"
                        disabled={adjustingStockId === item.id || !canUseInventory(currentUser?.role)}
                        onClick={() => onAdjustStock(item.id)}
                        className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-[#f3f8fb] disabled:opacity-50"
                      >
                        {adjustingStockId === item.id ? "Updating..." : "Adjust"}
                      </button>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={deletingCatalogId === item.id || !canUseInventory(currentUser?.role)}
                  onClick={() => onDeleteCatalogItem(item.id)}
                  className="rounded-xl border border-[#bfd7e8] p-2 text-slate-600 transition hover:bg-white disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )) : <p className="text-sm text-slate-600">No services added yet.</p>}
          </div>
        </div>

        <div className="rounded-[18px] border border-[#bfd7e8] bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <Pill className="h-4 w-4 text-[#2a6fa8]" />
            <h3 className="text-base font-semibold text-slate-900">Medicines</h3>
          </div>
          <div className="space-y-3">
            {medicineItems.length ? medicineItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/30 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{item.name}</p>
                  <p className="mt-1 text-xs text-slate-600">{item.unit || "per entry"} · {item.default_price.toFixed(2)}</p>
                  {item.hsn_sac_code && item.gst_rate ? (
                    <p className="mt-1 text-xs font-medium text-[#2a6fa8]">HSN {item.hsn_sac_code} · GST {item.gst_rate}%</p>
                  ) : null}
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
                        className="w-28 rounded-xl border border-[#bfd7e8] bg-white px-3 py-1.5 text-xs text-slate-800 outline-none"
                      />
                      <button
                        type="button"
                        disabled={adjustingStockId === item.id || !canUseInventory(currentUser?.role)}
                        onClick={() => onAdjustStock(item.id)}
                        className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-[#f3f8fb] disabled:opacity-50"
                      >
                        {adjustingStockId === item.id ? "Updating..." : "Adjust"}
                      </button>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={deletingCatalogId === item.id || !canUseInventory(currentUser?.role)}
                  onClick={() => onDeleteCatalogItem(item.id)}
                  className="rounded-xl border border-[#bfd7e8] p-2 text-slate-600 transition hover:bg-white disabled:opacity-50"
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
