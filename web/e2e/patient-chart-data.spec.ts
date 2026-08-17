import { expect, test } from "@playwright/test";

import {
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  seedSession,
} from "./support/mock-clinic-api";

const API_ORIGIN = "http://127.0.0.1:8001";

function visit(patientId: string, id: string, visitNumber: number, reason: string, createdAt: string) {
  return { id, patient_id: patientId, visit_number: visitNumber, reason, created_at: createdAt };
}

function visitDetail(id: string, reason: string) {
  return {
    visit_id: id,
    reason,
    timestamp: "2026-08-17T12:00:00.000Z",
    consultation_note: null,
    optometry_history: null,
    attachments: [],
    timeline: [],
  };
}

test("patient chart caches visit details while selection changes", async ({ page }) => {
  const user = buildUser();
  const patient = buildPatient({ id: "patient-chart-cache-1", name: "Visit Cache" });
  const newest = visit(patient.id, "visit-cache-2", 2, "Newest list reason", "2026-08-17T12:00:00.000Z");
  const oldest = visit(patient.id, "visit-cache-1", 1, "Oldest list reason", "2026-08-16T12:00:00.000Z");
  const detailRequests = new Map<string, number>();

  await seedSession(page, { user });
  await mockClinicBootstrap(page, { user, patients: [patient] });
  await page.route(`${API_ORIGIN}/patients/${patient.id}/visits`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([newest, oldest]) });
  });
  await page.route(new RegExp(`${API_ORIGIN}/patients/${patient.id}/visits/[^/]+/details$`), async (route) => {
    const visitId = new URL(route.request().url()).pathname.split("/").at(-2) || "";
    detailRequests.set(visitId, (detailRequests.get(visitId) || 0) + 1);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(visitDetail(visitId, visitId === newest.id ? "Newest detail" : "Oldest detail")),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: `Open chart for ${patient.name}` }).click();
  await expect(page.getByRole("heading", { name: "Reason: Newest detail" })).toBeVisible();
  await page.getByRole("button", { name: "Visit 1" }).click();
  await expect(page.getByRole("heading", { name: "Reason: Oldest detail" })).toBeVisible();
  await page.getByRole("button", { name: "Visit 2" }).click();
  await expect(page.getByRole("heading", { name: "Reason: Newest detail" })).toBeVisible();

  expect(detailRequests.get(newest.id)).toBe(1);
  expect(detailRequests.get(oldest.id)).toBe(1);
});

test("chart data failures retry independently and reset for the next patient", async ({ page }) => {
  const user = buildUser();
  const firstPatient = buildPatient({ id: "patient-chart-data-1", name: "Data Failure" });
  const secondPatient = buildPatient({ id: "patient-chart-data-2", name: "Data Clean" });
  let firstTimelineRequests = 0;

  await seedSession(page, { user });
  await mockClinicBootstrap(page, { user, patients: [firstPatient, secondPatient] });
  await page.route(`${API_ORIGIN}/patients/${firstPatient.id}/visits`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([visit(firstPatient.id, "visit-data-1", 1, "Failure patient visit", "2026-08-16T12:00:00.000Z")]),
    });
  });
  await page.route(`${API_ORIGIN}/patients/${secondPatient.id}/visits`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([visit(secondPatient.id, "visit-data-2", 1, "Clean patient visit", "2026-08-17T12:00:00.000Z")]),
    });
  });
  await page.route(`${API_ORIGIN}/patients/${firstPatient.id}/summary`, async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "Summary unavailable." }) });
  });
  await page.route(`${API_ORIGIN}/patients/${secondPatient.id}/summary`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ summary: "Clean patient summary.", updated_at: "2026-08-17T12:00:00.000Z", stale: false, used_fallback: false }),
    });
  });
  await page.route(`${API_ORIGIN}/patients/${firstPatient.id}/timeline`, async (route) => {
    firstTimelineRequests += 1;
    if (firstTimelineRequests === 1) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "Timeline unavailable." }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "event-retry-1", type: "visit_recorded", title: "Visit recorded", description: "Timeline recovered.", timestamp: "2026-08-17T12:00:00.000Z" }]),
    });
  });
  await page.route(`${API_ORIGIN}/patients/${secondPatient.id}/timeline`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "event-clean-1", type: "visit_recorded", title: "Visit recorded", description: "Clean timeline.", timestamp: "2026-08-17T12:00:00.000Z" }]),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: `Open chart for ${firstPatient.name}` }).click();
  await expect(page.getByRole("button", { name: "Visit 1" })).toBeVisible();
  await expect(page.getByText("Summary unavailable.")).toBeVisible();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByText("Timeline unavailable.")).toBeVisible();
  await page.getByRole("button", { name: "Visits", exact: true }).click();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByText("Timeline recovered.")).toBeVisible();
  expect(firstTimelineRequests).toBe(2);

  await page.getByRole("button", { name: "Close patient chart" }).click();
  await page.getByRole("button", { name: `Open chart for ${secondPatient.name}` }).click();
  await expect(page.getByText("Clean patient summary.")).toBeVisible();
  await expect(page.getByText("Summary unavailable.")).toHaveCount(0);
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByText("Clean timeline.")).toBeVisible();
  await expect(page.getByText("Timeline recovered.")).toHaveCount(0);
});
