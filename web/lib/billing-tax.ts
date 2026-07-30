import type { CatalogItem } from "@/lib/types";

export type TaxableDraftItem = {
  catalog_item_id?: string | null;
  quantity: number;
  unit_price: number;
};

export type DraftInvoiceTaxTotals = {
  subtotal: number;
  taxTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  total: number;
};

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateDraftInvoiceTaxTotals(
  items: TaxableDraftItem[],
  catalogItems: CatalogItem[],
): DraftInvoiceTaxTotals {
  const catalogById = new Map(catalogItems.map((item) => [item.id, item]));
  let subtotal = 0;
  let taxTotal = 0;
  let cgstTotal = 0;

  for (const item of items) {
    const lineTotal = roundCurrency(item.quantity * item.unit_price);
    subtotal += lineTotal;
    const catalogItem = item.catalog_item_id
      ? catalogById.get(item.catalog_item_id)
      : null;
    if (!catalogItem?.hsn_sac_code || !catalogItem.gst_rate) {
      continue;
    }
    const lineTax = roundCurrency(lineTotal * catalogItem.gst_rate / 100);
    taxTotal += lineTax;
    cgstTotal += roundCurrency(lineTax / 2);
  }

  subtotal = roundCurrency(subtotal);
  taxTotal = roundCurrency(taxTotal);
  cgstTotal = roundCurrency(cgstTotal);
  const sgstTotal = roundCurrency(taxTotal - cgstTotal);
  return {
    subtotal,
    taxTotal,
    cgstTotal,
    sgstTotal,
    total: roundCurrency(subtotal + taxTotal),
  };
}
