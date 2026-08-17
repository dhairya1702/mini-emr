import { expect, test } from "@playwright/test";

import {
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  seedSession,
} from "./support/mock-clinic-api";

const API_ORIGIN = "http://127.0.0.1:8001";

function invoiceFromPayload(payload: Record<string, unknown>) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const total = items.reduce((sum, item) => {
    const row = item as { quantity?: number; unit_price?: number };
    return sum + Number(row.quantity || 0) * Number(row.unit_price || 0);
  }, 0);
  return {
    id: "invoice-dashboard-1",
    org_id: "org-1",
    patient_id: String(payload.patient_id || ""),
    patient_name: "Billing Workflow",
    subtotal: total,
    tax_total: 0,
    cgst_total: 0,
    sgst_total: 0,
    total,
    supplier_gstin: "",
    payment_status: payload.payment_status || "paid",
    amount_paid: total,
    balance_due: 0,
    paid_at: null,
    completed_at: null,
    completed_by: null,
    sent_at: null,
    created_at: "2026-08-17T00:00:00.000Z",
    items: [],
  };
}

test("dashboard billing saves before finalizing and preserves the draft after finalization failure", async ({ page }) => {
  const user = buildUser();
  const patient = buildPatient({
    id: "patient-dashboard-billing-1",
    name: "Billing Workflow",
    status: "done",
    billed: false,
  });
  const requestOrder: string[] = [];
  let createRequests = 0;
  let finalizeRequests = 0;
  let savedInvoice = invoiceFromPayload({ patient_id: patient.id, items: [] });

  await seedSession(page, { user });
  await mockClinicBootstrap(page, { user, patients: [patient] });
  await page.route(`${API_ORIGIN}/patients/${patient.id}/notes`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route(`${API_ORIGIN}/invoices`, async (route) => {
    createRequests += 1;
    requestOrder.push("create");
    const payload = JSON.parse(route.request().postData() || "{}");
    savedInvoice = invoiceFromPayload(payload);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(savedInvoice),
    });
  });
  await page.route(`${API_ORIGIN}/invoices/finalize`, async (route) => {
    finalizeRequests += 1;
    requestOrder.push("finalize");
    if (finalizeRequests === 1) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Finalize failed safely." }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        message: "Invoice completed.",
        invoice: { ...savedInvoice, completed_at: "2026-08-17T01:00:00.000Z" },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: `Open billing for ${patient.name}` }).click();
  await expect(page.getByRole("button", { name: "Close billing" })).toBeVisible();

  await page.getByPlaceholder("Enter item").fill("Custom procedure");
  await page.locator('input[inputmode="decimal"]').last().fill("350");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();

  await expect(page.getByText("Finalize failed safely.")).toBeVisible();
  await expect(page.getByText("Custom procedure", { exact: true })).toBeVisible();
  expect(requestOrder).toEqual(["create", "finalize"]);
  expect(createRequests).toBe(1);

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close billing" })).toHaveCount(0);
  expect(requestOrder).toEqual(["create", "finalize", "finalize"]);
  expect(createRequests).toBe(1);
});

test("dashboard billing resets local draft state when changing patients", async ({ page }) => {
  const user = buildUser();
  const firstPatient = buildPatient({
    id: "patient-dashboard-reset-1",
    name: "First Billing Patient",
    status: "done",
    billed: false,
  });
  const secondPatient = buildPatient({
    id: "patient-dashboard-reset-2",
    name: "Second Billing Patient",
    status: "done",
    billed: false,
  });

  await seedSession(page, { user });
  await mockClinicBootstrap(page, { user, patients: [firstPatient, secondPatient] });
  await page.route(new RegExp(`${API_ORIGIN}/patients/[^/]+/notes$`), async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.goto("/");
  await page.getByRole("button", { name: `Open billing for ${firstPatient.name}` }).click();
  await page.getByPlaceholder("Enter item").fill("First patient only");
  await page.locator('input[inputmode="decimal"]').last().fill("100");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("First patient only", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Close billing" }).click();
  await page.getByRole("button", { name: `Open billing for ${secondPatient.name}` }).click();
  await expect(page.getByRole("button", { name: "Close billing" })).toBeVisible();
  await expect(page.getByText("First patient only", { exact: true })).toHaveCount(0);
});
