import { expect, test } from "@playwright/test";

import {
  buildClinicSettings,
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  seedSession,
} from "./support/mock-clinic-api";

const PATIENTS_ENDPOINT = "http://127.0.0.1:8001/patients";

test("patient directory uses one lightweight initial request and ignores stale searches", async ({ page }) => {
  const user = buildUser({ doctor_signature_name: "signature.png" });
  const robin = buildPatient({ id: "patient-robin", name: "Robin Shah" });
  const casey = buildPatient({ id: "patient-casey", name: "Casey Morgan" });
  const requestedQueries: string[] = [];
  const limits: string[] = [];

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients: [robin, casey],
  });
  await page.route(new RegExp(`^${PATIENTS_ENDPOINT}(?:\\?.*)?$`), async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("q") || "";
    requestedQueries.push(query);
    limits.push(url.searchParams.get("limit") || "");
    if (query === "Robin") {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [robin], next_cursor: null, has_more: false }) });
      return;
    }
    if (query === "Casey") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [casey], next_cursor: null, has_more: false }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [robin, casey], next_cursor: null, has_more: false }) });
  });

  await page.goto("/patients");
  await expect(page.getByText("Robin Shah", { exact: true })).toBeVisible();
  await page.waitForTimeout(350);
  expect(requestedQueries).toEqual([""]);
  expect(limits).toEqual(["20"]);

  const search = page.getByPlaceholder("Search by name, phone number, or visit reason");
  await search.fill("Robin");
  await expect.poll(() => requestedQueries.includes("Robin")).toBe(true);
  await search.fill("Casey");
  await expect(page.getByText("Casey Morgan", { exact: true })).toBeVisible();
  await page.waitForTimeout(750);

  await expect(page.getByText("Robin Shah", { exact: true })).toHaveCount(0);
  expect(requestedQueries).toEqual(["", "Robin", "Casey"]);
  expect(limits).toEqual(["20", "20", "20"]);
});

test("patient directory automatically appends the next page at the scroll boundary", async ({ page }) => {
  const user = buildUser({ doctor_signature_name: "signature.png" });
  const patients = Array.from({ length: 25 }, (_, index) => buildPatient({
    id: `patient-page-${index}`,
    name: `Paged Patient ${String(index).padStart(2, "0")}`,
  }));
  const requestedCursors: string[] = [];

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients,
  });
  await page.route(new RegExp(`^${PATIENTS_ENDPOINT}(?:\\?.*)?$`), async (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor") || "";
    requestedCursors.push(cursor);
    const offset = Number(cursor || 0);
    const items = patients.slice(offset, offset + 20);
    const nextOffset = offset + items.length;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items,
        next_cursor: nextOffset < patients.length ? String(nextOffset) : null,
        has_more: nextOffset < patients.length,
      }),
    });
  });

  await page.goto("/patients");
  await expect(page.getByText("Paged Patient 19", { exact: true })).toBeVisible();
  await page.getByTestId("patient-scroll-sentinel").scrollIntoViewIfNeeded();
  await expect(page.getByText("Paged Patient 24", { exact: true })).toBeVisible();
  expect(requestedCursors).toEqual(["", "20"]);
});
