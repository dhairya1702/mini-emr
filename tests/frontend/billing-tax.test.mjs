import test from "node:test";
import assert from "node:assert/strict";

import { importWebModule } from "./load-web-module.mjs";

const billingTax = await importWebModule("lib/billing-tax.ts");

test("draft invoice totals tax only catalog items configured for GST", () => {
  const totals = billingTax.calculateDraftInvoiceTaxTotals(
    [
      { catalog_item_id: "frames", quantity: 1, unit_price: 1000 },
      { catalog_item_id: "consultation", quantity: 1, unit_price: 500 },
      { catalog_item_id: null, quantity: 1, unit_price: 250 },
    ],
    [
      { id: "frames", hsn_sac_code: "9003", gst_rate: 12 },
      { id: "consultation", hsn_sac_code: "", gst_rate: null },
    ],
  );

  assert.deepEqual(totals, {
    subtotal: 1750,
    taxTotal: 120,
    cgstTotal: 60,
    sgstTotal: 60,
    total: 1870,
  });
});

test("draft invoice keeps paise rounding balanced between CGST and SGST", () => {
  const totals = billingTax.calculateDraftInvoiceTaxTotals(
    [{ catalog_item_id: "taxed", quantity: 1, unit_price: 0.25 }],
    [{ id: "taxed", hsn_sac_code: "1234", gst_rate: 18 }],
  );

  assert.equal(totals.taxTotal, 0.05);
  assert.equal(totals.cgstTotal, 0.03);
  assert.equal(totals.sgstTotal, 0.02);
  assert.equal(totals.total, 0.3);
});
