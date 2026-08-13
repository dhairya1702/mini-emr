import { expect, Page, test } from "@playwright/test";

import {
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  seedSession,
} from "./support/mock-clinic-api";

const API_ORIGIN = "http://127.0.0.1:8001";

declare global {
  interface Window {
    __dashboardEventSource: EventTarget | null;
    __emitDashboardEvent?: (payload: unknown) => void;
  }
}

async function mockDashboardEventSource(page: Page) {
  await page.addInitScript(() => {
    class MockEventSource extends EventTarget {
      url: string;
      withCredentials: boolean;

      constructor(url: string, init?: EventSourceInit) {
        super();
        this.url = url;
        this.withCredentials = Boolean(init?.withCredentials);
        window.__dashboardEventSource = this;
        window.setTimeout(() => this.dispatchEvent(new Event("open")), 0);
      }

      close() {
        if (window.__dashboardEventSource === this) {
          window.__dashboardEventSource = null;
        }
      }
    }

    window.EventSource = MockEventSource as typeof EventSource;
    window.__emitDashboardEvent = (payload) => {
      window.__dashboardEventSource?.dispatchEvent(new MessageEvent("dashboard", {
        data: JSON.stringify(payload),
      }));
    };
  });
}

test("billing deduplicates focus refreshes and defers patient reload while a draft is dirty", async ({ page }) => {
  const user = buildUser();
  const patient = buildPatient({
    id: "patient-billing-refresh-1",
    name: "Draft Patient",
    status: "done",
    billed: false,
  });
  let patientRevision = "patients-1";
  let invoiceRevision = "invoices-1";
  let statusRequests = 0;
  let summaryRequests = 0;
  let patientListRequests = 0;

  await seedSession(page, { user });
  await mockClinicBootstrap(page, { user, patients: [patient] });
  await page.route(`${API_ORIGIN}/billing/dashboard*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        billable_patients_revision: patientRevision,
        billable_patient_count: 1,
        invoices_revision: invoiceRevision,
        recent_invoices: [],
      }),
    });
  });
  await page.route(`${API_ORIGIN}/billing/status`, async (route) => {
    statusRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        billable_patients_revision: patientRevision,
        billable_patient_count: 1,
        invoices_revision: invoiceRevision,
      }),
    });
  });
  await page.route(`${API_ORIGIN}/invoices/summaries*`, async (route) => {
    summaryRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: "invoice-summary-1",
        patient_id: patient.id,
        patient_name: patient.name,
        item_count: 2,
        total: 800,
        payment_status: "partial",
        amount_paid: 100,
        balance_due: 700,
        created_at: new Date().toISOString(),
      }]),
    });
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === API_ORIGIN && url.pathname === "/patients") patientListRequests += 1;
  });

  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "Patients", exact: true })).toBeVisible();
  await expect(page.getByText(patient.name, { exact: true }).first()).toBeVisible();
  await expect.poll(() => patientListRequests).toBe(1);

  await page.getByPlaceholder("Enter item").fill("Unsaved custom fee");
  const decimalInputs = page.locator('input[inputmode="decimal"]');
  await decimalInputs.last().fill("250");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Unsaved custom fee", { exact: true })).toBeVisible();

  await page.waitForTimeout(2100);
  const statusBaseline = statusRequests;
  const patientBaseline = patientListRequests;
  patientRevision = "patients-2";
  invoiceRevision = "invoices-2";
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });

  await expect.poll(() => statusRequests).toBe(statusBaseline + 1);
  await expect.poll(() => summaryRequests).toBe(1);
  await expect(page.getByText("2 items", { exact: true })).toBeVisible();
  await page.waitForTimeout(250);
  expect(patientListRequests).toBe(patientBaseline);
  await expect(page.getByText("Unsaved custom fee", { exact: true })).toBeVisible();
});

test("billing refreshes recent invoices from dashboard SSE invalidation", async ({ page }) => {
  const user = buildUser();
  const patient = buildPatient({
    id: "patient-billing-sse-1",
    name: "Realtime Billing",
    status: "done",
    billed: false,
  });
  let invoiceRevision = "invoices-1";
  let statusRequests = 0;
  let summaryRequests = 0;

  await mockDashboardEventSource(page);
  await seedSession(page, { user });
  await mockClinicBootstrap(page, { user, patients: [patient] });
  await page.route(`${API_ORIGIN}/billing/dashboard*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        billable_patients_revision: "patients-1",
        billable_patient_count: 1,
        invoices_revision: invoiceRevision,
        recent_invoices: [],
      }),
    });
  });
  await page.route(`${API_ORIGIN}/billing/status`, async (route) => {
    statusRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        billable_patients_revision: "patients-1",
        billable_patient_count: 1,
        invoices_revision: invoiceRevision,
      }),
    });
  });
  await page.route(`${API_ORIGIN}/invoices/summaries*`, async (route) => {
    summaryRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: "invoice-summary-sse-1",
        patient_id: patient.id,
        patient_name: patient.name,
        item_count: 1,
        total: 500,
        payment_status: "paid",
        amount_paid: 500,
        balance_due: 0,
        created_at: new Date().toISOString(),
      }]),
    });
  });

  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "Patients", exact: true })).toBeVisible();

  invoiceRevision = "invoices-2";
  await page.evaluate(() => {
    window.__emitDashboardEvent?.({
      org_id: "org-1",
      changed: ["billing_invoices"],
      queue_revision: "queue-1",
      check_in_revision: "check-1",
      billing_patients_revision: "patients-1",
      billing_invoices_revision: "invoices-2",
    });
  });

  await expect.poll(() => statusRequests).toBe(1);
  await expect.poll(() => summaryRequests).toBe(1);
  await expect(page.getByText("1 item", { exact: true })).toBeVisible();
});
