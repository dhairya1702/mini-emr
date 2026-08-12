"use client";

import { useEffect, useMemo } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { MobileAdminGate } from "@/components/mobile/mobile-admin-gate";
import { MobileShell } from "@/components/mobile/mobile-shell";
import type { CatalogItem } from "@/lib/types";

function itemTypeLabel(item: CatalogItem) {
  if (item.item_type === "service") return "Service";
  if (item.item_type === "program") return "Program";
  return "Medicine";
}

export default function MobileInventoryPage() {
  const {
    currentUser,
    isAuthReady,
    isRedirectingToLogin,
    catalogItems: items,
    catalogError: error,
    isCatalogLoaded,
    isCatalogLoading: isLoading,
    loadCatalogItems,
  } = useClinicShell();

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || currentUser?.role !== "admin") {
      return;
    }
    void loadCatalogItems().catch(() => undefined);
  }, [currentUser, isAuthReady, isRedirectingToLogin, loadCatalogItems]);

  const sortedItems = useMemo(
    () => [...items].sort((left, right) => left.item_type.localeCompare(right.item_type) || left.name.localeCompare(right.name)),
    [items],
  );

  return (
    <MobileAdminGate title="Inventory">
      <MobileShell title="Inventory">
        {error ? <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
        {isLoading && !isCatalogLoaded ? (
          <p className="clinic-empty-state">Loading inventory...</p>
        ) : (
          <div className="grid gap-3">
            {sortedItems.map((item) => (
              <section key={item.id} className="rounded-[18px] border border-[#dbe7ef] bg-white p-4 shadow-[0_12px_28px_rgba(64,131,181,0.08)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{item.name}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{itemTypeLabel(item)}</p>
                  </div>
                  <p className="text-sm font-semibold text-[#2a6fa8]">Rs {item.default_price}</p>
                </div>
                {item.track_inventory ? (
                  <p className={`mt-3 rounded-xl px-3 py-2 text-sm ${item.stock_quantity <= item.low_stock_threshold ? "bg-amber-50 text-amber-800" : "bg-[#f3f8fb] text-slate-700"}`}>
                    Stock: {item.stock_quantity} {item.unit || "units"}
                  </p>
                ) : null}
              </section>
            ))}
            {!sortedItems.length ? <p className="clinic-empty-state">No inventory items yet.</p> : null}
          </div>
        )}
      </MobileShell>
    </MobileAdminGate>
  );
}
