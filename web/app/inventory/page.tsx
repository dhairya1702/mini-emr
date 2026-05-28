"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Boxes, PackagePlus, Pill, Plus, Search, Stethoscope, Trash2, X } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import type { CatalogFormState } from "@/components/settings-drawer-inventory-panel";
import { LazySettingsDrawer } from "@/components/lazy-settings-drawer";
import { api } from "@/lib/api";
import type { CatalogItem, CatalogItemType } from "@/lib/types";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";

type InventoryFilter = "all" | CatalogItemType | "tracked" | "low_stock";

const filterOptions: Array<{ value: InventoryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "service", label: "Services" },
  { value: "medicine", label: "Medicines" },
  { value: "tracked", label: "Stock tracked" },
  { value: "low_stock", label: "Low stock" },
];

function emptyCatalogForm(itemType: CatalogItemType = "service"): CatalogFormState {
  return {
    name: "",
    item_type: itemType,
    default_price: "",
    track_inventory: itemType === "medicine",
    stock_quantity: "",
    low_stock_threshold: "",
    unit: "",
  };
}

function itemTypeLabel(value: CatalogItemType) {
  return value === "service" ? "Service" : "Medicine";
}

function stockLabel(item: CatalogItem) {
  if (!item.track_inventory) {
    return "-";
  }
  return `${item.stock_quantity}`;
}

function isLowStock(item: CatalogItem) {
  return item.track_inventory && item.stock_quantity <= item.low_stock_threshold;
}

export default function InventoryPage() {
  const router = useRouter();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCatalogDrawerOpen, setIsCatalogDrawerOpen] = useState(false);
  const [catalogForm, setCatalogForm] = useState<CatalogFormState>(() => emptyCatalogForm());
  const [catalogError, setCatalogError] = useState("");
  const [catalogStatus, setCatalogStatus] = useState("");
  const [isSavingCatalog, setIsSavingCatalog] = useState(false);
  const [stockAdjustments, setStockAdjustments] = useState<Record<string, string>>({});
  const [adjustingStockId, setAdjustingStockId] = useState("");
  const [deletingCatalogId, setDeletingCatalogId] = useState("");
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>("all");
  const canLoadAdminPageData = useCallback((user: { role: "admin" | "staff" }) => user.role === "admin", []);
  const loadPageData = useCallback(async () => null, []);
  const onPageData = useCallback(() => undefined, []);
  const loadBillablePatients = useCallback(async () => {
    const patients = await api.listPatients();
    return patients.filter((patient) => patient.status === "done" && !patient.billed);
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
  const sortedCatalogItems = useMemo(
    () =>
      [...catalogItems].sort((left, right) => {
        if (left.item_type !== right.item_type) {
          return left.item_type === "service" ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      }),
    [catalogItems],
  );
  const filteredCatalogItems = useMemo(() => {
    const query = inventorySearch.trim().toLowerCase();
    return sortedCatalogItems.filter((item) => {
      const matchesSearch =
        !query ||
        item.name.toLowerCase().includes(query) ||
        item.unit.toLowerCase().includes(query) ||
        item.item_type.toLowerCase().includes(query);
      if (!matchesSearch) {
        return false;
      }
      if (inventoryFilter === "tracked") {
        return item.track_inventory;
      }
      if (inventoryFilter === "low_stock") {
        return isLowStock(item);
      }
      if (inventoryFilter === "service" || inventoryFilter === "medicine") {
        return item.item_type === inventoryFilter;
      }
      return true;
    });
  }, [inventoryFilter, inventorySearch, sortedCatalogItems]);
  const serviceCount = catalogItems.filter((item) => item.item_type === "service").length;
  const medicineCount = catalogItems.filter((item) => item.item_type === "medicine").length;
  const lowStockCount = catalogItems.filter(isLowStock).length;

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

  async function handleSaveCatalogItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCatalogError("");
    setCatalogStatus("");
    const price = Number(catalogForm.default_price);
    const stockQuantity = Number(catalogForm.stock_quantity || "0");
    const lowStockThreshold = Number(catalogForm.low_stock_threshold || "0");
    if (!catalogForm.name.trim()) {
      setCatalogError("Name is required.");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setCatalogError("Enter a valid price.");
      return;
    }
    if (catalogForm.track_inventory && (!Number.isFinite(stockQuantity) || stockQuantity < 0)) {
      setCatalogError("Enter a valid stock quantity.");
      return;
    }
    if (catalogForm.track_inventory && (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0)) {
      setCatalogError("Enter a valid low-stock threshold.");
      return;
    }
    setIsSavingCatalog(true);
    try {
      await handleCreateCatalogItem({
        name: catalogForm.name.trim(),
        item_type: catalogForm.item_type,
        default_price: price,
        track_inventory: catalogForm.track_inventory,
        stock_quantity: catalogForm.track_inventory ? stockQuantity : 0,
        low_stock_threshold: catalogForm.track_inventory ? lowStockThreshold : 0,
        unit: catalogForm.unit.trim(),
      });
      setCatalogStatus(catalogForm.item_type === "service" ? "Service saved." : "Medicine saved.");
      setCatalogForm(emptyCatalogForm(catalogForm.item_type));
      setIsCatalogDrawerOpen(false);
    } catch (saveError) {
      setCatalogError(saveError instanceof Error ? saveError.message : "Failed to save catalog item.");
    } finally {
      setIsSavingCatalog(false);
    }
  }

  async function handleAdjustStock(itemId: string) {
    const raw = stockAdjustments[itemId] ?? "";
    const delta = Number(raw);
    if (!Number.isFinite(delta) || delta === 0) {
      setCatalogError("Enter a stock adjustment other than zero.");
      return;
    }
    setAdjustingStockId(itemId);
    setCatalogError("");
    setCatalogStatus("");
    try {
      await handleAdjustCatalogStock(itemId, delta);
      setStockAdjustments((current) => ({ ...current, [itemId]: "" }));
      setCatalogStatus(delta > 0 ? "Stock increased." : "Stock reduced.");
    } catch (adjustError) {
      setCatalogError(adjustError instanceof Error ? adjustError.message : "Failed to adjust stock.");
    } finally {
      setAdjustingStockId("");
    }
  }

  async function handleDeleteCatalog(itemId: string) {
    setDeletingCatalogId(itemId);
    setCatalogError("");
    setCatalogStatus("");
    try {
      await handleDeleteCatalogItem(itemId);
      setCatalogStatus("Inventory item removed.");
    } catch (deleteError) {
      setCatalogError(deleteError instanceof Error ? deleteError.message : "Failed to remove inventory item.");
    } finally {
      setDeletingCatalogId("");
    }
  }

  if (isRedirectingToLogin) return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[20px] border border-[#dbe7ef] bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">Redirecting to login...</div></main>;
  if (!isAuthReady) return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[20px] border border-[#dbe7ef] bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">Loading ClinicOS...</div></main>;
  if (currentUser?.role === "staff") return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[20px] border border-[#dbe7ef] bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">Redirecting to queue...</div></main>;

  return (
    <main className="clinic-page">
      <div className="clinic-container">
        <AppHeader clinicName={clinicName} currentUser={currentUser} active="inventory" onOpenSettings={() => setIsSettingsOpen(true)} onLogout={handleLogout} />
        {error ? <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        {catalogError ? <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{catalogError}</div> : null}
        {catalogStatus ? <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{catalogStatus}</div> : null}

        <section className="clinic-panel">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <Boxes className="h-5 w-5 text-[#2a6fa8]" />
                <h1 className="text-xl font-semibold text-slate-900">Inventory</h1>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-sm">
                <span className="rounded-xl bg-[#f3f8fb] px-3 py-1 text-slate-600">{serviceCount} services</span>
                <span className="rounded-xl bg-[#f3f8fb] px-3 py-1 text-slate-600">{medicineCount} medicines</span>
                {lowStockCount ? (
                  <span className="rounded-xl bg-amber-50 px-3 py-1 text-amber-700">{lowStockCount} low stock</span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex w-full gap-2 xl:max-w-[480px]">
              <label className="relative block min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={inventorySearch}
                  onChange={(event) => setInventorySearch(event.target.value)}
                  placeholder="Search item, unit, or type"
                  className="h-11 w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/70 pl-10 pr-4 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#9fc7e1] focus:bg-white"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setCatalogError("");
                  setCatalogStatus("");
                  setCatalogForm(emptyCatalogForm());
                  setIsCatalogDrawerOpen(true);
                }}
                aria-label="Add inventory item"
                title="Add inventory item"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#2f8fd3] text-white transition hover:bg-[#287fc0] active:scale-[0.99]"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {filterOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setInventoryFilter(option.value)}
                  className={`rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
                    inventoryFilter === option.value
                      ? "border-[#9fc7e1] bg-[#2f8fd3] text-white"
                      : "border-[#bfd7e8] bg-[#f3f8fb]/70 text-slate-700 hover:bg-[#dbeaf4]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 overflow-x-auto rounded-[18px] border border-[#dbe7ef]">
            {filteredCatalogItems.length ? (
              <div>
                <div className="grid min-w-[980px] grid-cols-[minmax(0,1.4fr)_120px_120px_120px_150px_96px] gap-4 bg-[#f3f8fb]/80 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <p>Name</p>
                  <p>Type</p>
                  <p>Unit</p>
                  <p className="text-right">Price</p>
                  <p>Stock</p>
                  <p className="text-right">Actions</p>
                </div>
                {filteredCatalogItems.map((item) => (
                  <div
                    key={item.id}
                    className="grid min-w-[980px] grid-cols-[minmax(0,1.4fr)_120px_120px_120px_150px_96px] items-center gap-4 border-t border-[#dbe7ef] px-5 py-3.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
                      {isLowStock(item) ? (
                        <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                          <AlertTriangle className="h-3 w-3" />
                          Low stock threshold reached
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      {item.item_type === "service" ? <Stethoscope className="h-4 w-4 text-[#2a6fa8]" /> : <Pill className="h-4 w-4 text-[#2a6fa8]" />}
                      {itemTypeLabel(item.item_type)}
                    </div>
                    <p className="truncate text-sm text-slate-600">{item.unit || "per entry"}</p>
                    <p className="text-right text-sm font-semibold tabular-nums text-slate-900">{item.default_price.toFixed(2)}</p>
                    <div>
                      <p className={`text-sm tabular-nums ${isLowStock(item) ? "font-semibold text-amber-700" : "text-slate-700"}`}>
                        {stockLabel(item)}
                      </p>
                      {item.track_inventory ? (
                        <div className="mt-2 flex gap-1.5">
                          <input
                            value={stockAdjustments[item.id] ?? ""}
                            inputMode="decimal"
                            onChange={(event) => setStockAdjustments((current) => ({ ...current, [item.id]: event.target.value }))}
                            placeholder="+10 / -2"
                            className="h-8 w-20 rounded-xl border border-[#bfd7e8] bg-white px-2.5 text-xs text-slate-800 outline-none transition focus:border-[#9fc7e1]"
                          />
                          <button
                            type="button"
                            disabled={adjustingStockId === item.id || currentUser?.role !== "admin"}
                            onClick={() => void handleAdjustStock(item.id)}
                            className="h-8 rounded-xl border border-[#bfd7e8] bg-white px-2.5 text-xs font-medium text-slate-700 transition hover:bg-[#f3f8fb] disabled:opacity-50"
                          >
                            {adjustingStockId === item.id ? "..." : "Adjust"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={deletingCatalogId === item.id || currentUser?.role !== "admin"}
                        onClick={() => void handleDeleteCatalog(item.id)}
                        aria-label={`Delete ${item.name}`}
                        title={`Delete ${item.name}`}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#bfd7e8] bg-white text-slate-600 transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : catalogItems.length ? (
              <div className="rounded-[18px] border border-dashed border-[#9fc7e1] bg-[#f3f8fb]/20 px-6 py-16 text-center text-sm text-slate-500">
                No inventory items match the current search or filter.
              </div>
            ) : (
              <div className="rounded-[18px] border border-dashed border-[#9fc7e1] bg-[#f3f8fb]/20 px-6 py-16 text-center">
                <PackagePlus className="mx-auto h-8 w-8 text-[#2a6fa8]" />
                <p className="mt-3 text-sm font-semibold text-slate-900">No inventory items yet</p>
                <p className="mt-1 text-sm text-slate-500">Add services and medicines so staff can bill from the catalog.</p>
                <button
                  type="button"
                  onClick={() => setIsCatalogDrawerOpen(true)}
                  className="mt-5 rounded-xl bg-[#2f8fd3] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#287fc0]"
                >
                  Add item
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
      {isCatalogDrawerOpen ? (
        <div className="fixed inset-0 z-30 bg-slate-950/35 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close add item drawer"
            className="absolute inset-0"
            onClick={() => setIsCatalogDrawerOpen(false)}
          />
          <aside className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col overflow-hidden bg-white shadow-[0_35px_90px_rgba(15,23,42,0.22)]">
            <div className="flex items-start justify-between gap-4 border-b border-[#dbe7ef] px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Inventory item</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-900">Add item</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsCatalogDrawerOpen(false)}
                aria-label="Close"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#dbe7ef] text-slate-500 transition hover:bg-[#f3f8fb] hover:text-slate-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSaveCatalogItem}>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
                {catalogError ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {catalogError}
                  </div>
                ) : null}
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Name</span>
                  <input
                    value={catalogForm.name}
                    onChange={(event) => setCatalogForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Consultation, Injection, Paracetamol"
                    className="h-11 w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#6daed8]"
                  />
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Type</span>
                    <select
                      value={catalogForm.item_type}
                      onChange={(event) => {
                        const nextType = event.target.value as CatalogItemType;
                        setCatalogForm((current) => ({
                          ...current,
                          item_type: nextType,
                          track_inventory: nextType === "medicine" ? true : current.track_inventory,
                        }));
                      }}
                      className="h-11 w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition focus:border-[#6daed8]"
                    >
                      <option value="service">Service</option>
                      <option value="medicine">Medicine</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Default price</span>
                    <input
                      value={catalogForm.default_price}
                      inputMode="decimal"
                      onChange={(event) => setCatalogForm((current) => ({ ...current, default_price: event.target.value }))}
                      placeholder="500"
                      className="h-11 w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#6daed8]"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Unit</span>
                  <input
                    value={catalogForm.unit}
                    onChange={(event) => setCatalogForm((current) => ({ ...current, unit: event.target.value }))}
                    placeholder="per visit, each, strip, bottle"
                    className="h-11 w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#6daed8]"
                  />
                </label>

                <label className="flex items-center gap-3 rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={catalogForm.track_inventory}
                    onChange={(event) => setCatalogForm((current) => ({ ...current, track_inventory: event.target.checked }))}
                  />
                  Track stock for this item
                </label>

                {catalogForm.track_inventory ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">Opening stock</span>
                      <input
                        value={catalogForm.stock_quantity}
                        inputMode="decimal"
                        onChange={(event) => setCatalogForm((current) => ({ ...current, stock_quantity: event.target.value }))}
                        placeholder="100"
                        className="h-11 w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#6daed8]"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">Low stock alert</span>
                      <input
                        value={catalogForm.low_stock_threshold}
                        inputMode="decimal"
                        onChange={(event) => setCatalogForm((current) => ({ ...current, low_stock_threshold: event.target.value }))}
                        placeholder="10"
                        className="h-11 w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#6daed8]"
                      />
                    </label>
                  </div>
                ) : null}
              </div>
              <div className="flex items-center justify-end gap-3 border-t border-[#dbe7ef] px-6 py-4">
                <button
                  type="button"
                  onClick={() => setIsCatalogDrawerOpen(false)}
                  className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingCatalog || currentUser?.role !== "admin"}
                  className="rounded-xl bg-[#2f8fd3] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
                >
                  {isSavingCatalog ? "Saving..." : "Save item"}
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
      {isSettingsOpen ? (
        <LazySettingsDrawer
          open={isSettingsOpen}
          settings={clinicSettings}
          currentUser={currentUser}
          users={users}
          onLoadUsers={loadUsers}
          auditEvents={auditEvents}
          onLoadAuditEvents={loadAuditEvents}
          patients={[]}
          onLoadBillingPatients={loadBillablePatients}
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
            const checkedInPatient = options?.existingPatientId
              ? await api.checkInAppointmentWithPatient(appointmentId, options.existingPatientId)
              : await api.checkInAppointment(appointmentId, { force_new: options?.forceNew });
            return { id: appointmentId, checked_in_at: new Date().toISOString(), checked_in_patient_id: checkedInPatient.id };
          }}
          onUpdateAppointment={(appointmentId, payload) => api.updateAppointment(appointmentId, payload)}
          onUpdateFollowUp={(followUpId, payload) => api.updateFollowUp(followUpId, payload)}
          onBillingComplete={() => undefined}
        />
      ) : null}
    </main>
  );
}
