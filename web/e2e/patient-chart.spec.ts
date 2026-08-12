import { expect, test } from "@playwright/test";

import {
  buildClinicSettings,
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  seedSession,
} from "./support/mock-clinic-api";

test("patient chart smoke opens biodata and timeline details", async ({ page }) => {
  const user = buildUser({ doctor_signature_name: "Dr. Rivera" });
  const staffUser = buildUser({
    id: "user-staff-1",
    identifier: "staff@clinic.test",
    name: "Front Desk",
    role: "staff",
  });
  const patient = buildPatient({
    id: "patient-chart-1",
    name: "Jordan Miles",
    reason: "Review visit",
    status: "waiting",
  });

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    users: [user, staffUser],
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients: [patient],
  });

  await page.goto("/");

  await page.getByRole("button", { name: "Open chart for Jordan Miles" }).click();

  await expect(page.getByText("Patient Chart", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\?workspace=chart&patient=patient-chart-1$/);
  await expect(page.getByRole("button", { name: "Visits" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Visit 1" })).toBeVisible();

  await page.getByRole("button", { name: "Visit 1" }).click();
  await expect(page.getByText("Review visit", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByText("Review visit visit recorded.")).toBeVisible();

  await page.goBack();
  await expect(page.getByText("Patient Chart", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

test("patient chart keeps newest visits first while numbering oldest as visit one", async ({ page }) => {
  const user = buildUser();
  const patient = buildPatient({ id: "patient-chart-order", name: "Taylor Reed", reason: "Latest review" });
  await seedSession(page, { user });
  await mockClinicBootstrap(page, { user, patients: [patient] });
  await page.route("http://127.0.0.1:8001/patients/patient-chart-order/visits", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "visit-3", patient_id: patient.id, visit_number: 3, reason: "Latest", created_at: "2026-08-03T10:00:00Z" },
        { id: "visit-2", patient_id: patient.id, visit_number: 2, reason: "Middle", created_at: "2026-08-02T10:00:00Z" },
        { id: "visit-1", patient_id: patient.id, visit_number: 1, reason: "First", created_at: "2026-08-01T10:00:00Z" },
      ]),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open chart for Taylor Reed" }).click();
  const visitButtons = page.getByRole("button", { name: /^Visit [123]/ });
  await expect(visitButtons).toHaveCount(3);
  await expect(visitButtons.nth(0)).toContainText("Visit 3");
  await expect(visitButtons.nth(1)).toContainText("Visit 2");
  await expect(visitButtons.nth(2)).toContainText("Visit 1");
});

test("patient chart preserves visits and summary when the queue refreshes", async ({ page }) => {
  const user = buildUser();
  const patient = buildPatient({ id: "patient-chart-refresh", name: "Robin Shah", reason: "Review" });
  let visitRequests = 0;
  let summaryRequests = 0;

  await seedSession(page, { user });
  await mockClinicBootstrap(page, { user, patients: [patient] });
  await page.route("http://127.0.0.1:8001/patients/patient-chart-refresh/visits", async (route) => {
    visitRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([1, 2, 3, 4].map((visitNumber) => ({
        id: `visit-${visitNumber}`,
        patient_id: patient.id,
        visit_number: visitNumber,
        reason: `Review ${visitNumber}`,
        created_at: `2026-08-0${visitNumber}T10:00:00Z`,
      })).reverse()),
    });
  });
  await page.route("http://127.0.0.1:8001/patients/patient-chart-refresh/summary", async (route) => {
    summaryRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: "Robin has four documented review visits.",
        updated_at: "2026-08-04T10:00:00Z",
        stale: false,
        used_fallback: false,
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open chart for Robin Shah" }).click();
  await expect(page.getByRole("button", { name: /^Visit [1-4]/ })).toHaveCount(4);
  await expect(page.getByText("Robin has four documented review visits.")).toBeVisible();
  const visitsBeforeRefresh = visitRequests;
  const summariesBeforeRefresh = summaryRequests;

  const queueRefresh = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/dashboard/status" && response.request().method() === "GET";
  });
  await page.evaluate(() => {
    const actualNow = Date.now;
    Date.now = () => actualNow() + 16_000;
    window.dispatchEvent(new Event("focus"));
    Date.now = actualNow;
  });
  await queueRefresh;

  await expect(page.getByRole("button", { name: /^Visit [1-4]/ })).toHaveCount(4);
  await expect(page.getByText("Robin has four documented review visits.")).toBeVisible();
  await expect(page.getByText("No visits recorded yet.")).toHaveCount(0);
  expect(visitRequests).toBe(visitsBeforeRefresh);
  expect(summaryRequests).toBe(summariesBeforeRefresh);
});

test("consultation note opens the saved letterhead PDF in a new tab", async ({ page }) => {
  const user = buildUser();
  const patient = buildPatient({ id: "patient-chart-note", name: "Casey Lin", reason: "Review" });
  let pdfRequests = 0;
  await seedSession(page, { user });
  await mockClinicBootstrap(page, { user, patients: [patient] });
  await page.route("http://127.0.0.1:8001/patients/patient-chart-note/visits/visit-1/details", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        visit_id: "visit-1",
        reason: "Review",
        timestamp: "2026-08-03T10:00:00Z",
        consultation_note: { note_id: "note-letterhead-1", status: "final", content: "Saved note" },
        optometry_history: null,
        attachments: [],
        timeline: [],
      }),
    });
  });
  await page.route("http://127.0.0.1:8001/notes/note-letterhead-1/pdf", async (route) => {
    pdfRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4\n%%EOF" });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open chart for Casey Lin" }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: /Consultation note/ }).click();
  const popup = await popupPromise;
  await expect.poll(() => pdfRequests).toBe(1);
  expect(popup.isClosed()).toBe(false);
  await popup.close();
});
