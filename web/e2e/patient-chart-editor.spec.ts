import { expect, test } from "@playwright/test";

import {
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  seedSession,
} from "./support/mock-clinic-api";

const API_ORIGIN = "http://127.0.0.1:8001";

test("patient editor validates, preserves its draft, normalizes payloads, and retries save", async ({ page }) => {
  const user = buildUser();
  const patient = buildPatient({ id: "patient-editor-1", name: "Editor Patient" });
  let saveRequests = 0;
  let savedPayload: Record<string, unknown> | null = null;

  await seedSession(page, { user });
  await mockClinicBootstrap(page, { user, patients: [patient] });
  await page.route(`${API_ORIGIN}/patients/${patient.id}`, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fallback();
      return;
    }
    saveRequests += 1;
    savedPayload = JSON.parse(route.request().postData() || "{}");
    if (saveRequests === 1) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "Save failed safely." }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...patient, ...savedPayload }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: `Open chart for ${patient.name}` }).click();
  const editButton = page.getByRole("button", { name: "Edit patient details" });
  await editButton.click();

  await page.getByLabel("Name").fill(" ");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("Name is required.")).toBeVisible();
  expect(saveRequests).toBe(0);

  await page.getByLabel("Name").fill("  Updated Patient  ");
  await page.getByLabel("Phone").fill(" (555) 010-2222 ");
  await page.getByLabel("Email").fill(" UPDATED@EXAMPLE.COM ");
  await page.getByLabel("Address").fill("  44 New Street  ");
  await page.getByLabel("Reason").fill("  Follow-up review  ");
  await page.getByLabel("DOB").fill("1991-04-05");
  await page.getByLabel("Weight").fill("72.5");
  await page.getByLabel("Height").fill("180");
  await page.getByLabel("Temp").fill("98.6");

  await editButton.click();
  await expect(page.getByLabel("Name")).toHaveCount(0);
  await editButton.click();
  await expect(page.getByLabel("Name")).toHaveValue("  Updated Patient  ");

  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("Save failed safely.")).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("  Updated Patient  ");
  expect(saveRequests).toBe(1);

  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByRole("button", { name: "Close patient chart" })).toHaveCount(0);
  expect(saveRequests).toBe(2);
  expect(savedPayload).toMatchObject({
    name: "Updated Patient",
    phone: "(555) 010-2222",
    email: "updated@example.com",
    address: "44 New Street",
    reason: "Follow-up review",
    date_of_birth: "1991-04-05",
    age: null,
    weight: 72.5,
    height: 180,
    temperature: 98.6,
  });
});

test("patient editor discards the previous draft when switching patients", async ({ page }) => {
  const user = buildUser();
  const firstPatient = buildPatient({ id: "patient-editor-reset-1", name: "First Editor" });
  const secondPatient = buildPatient({ id: "patient-editor-reset-2", name: "Second Editor" });

  await seedSession(page, { user });
  await mockClinicBootstrap(page, { user, patients: [firstPatient, secondPatient] });
  await page.goto("/");

  await page.getByRole("button", { name: `Open chart for ${firstPatient.name}` }).click();
  await page.getByRole("button", { name: "Edit patient details" }).click();
  await page.getByLabel("Name").fill("Unsaved first-patient draft");
  await page.getByRole("button", { name: "Close patient chart" }).click();

  await page.getByRole("button", { name: `Open chart for ${secondPatient.name}` }).click();
  await page.getByRole("button", { name: "Edit patient details" }).click();
  await expect(page.getByLabel("Name")).toHaveValue(secondPatient.name);
  await expect(page.getByLabel("Name")).not.toHaveValue("Unsaved first-patient draft");
});
