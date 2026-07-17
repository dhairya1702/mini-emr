import { expect, test } from "@playwright/test";

import {
  buildClinicSettings,
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  mockConsultationFlow,
  seedSession,
} from "./support/mock-clinic-api";

test("solo consultation billing keeps custom items after the old polling interval", async ({ page }) => {
  const user = buildUser({ doctor_signature_name: "Dr. Rivera" });
  const patient = buildPatient({
    id: "patient-solo-1",
    name: "Reset Check",
    reason: "Review",
    status: "consultation",
  });

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings({ workspace_mode: "solo" }),
    patients: [patient],
  });
  await mockConsultationFlow(page);

  await page.route("http://127.0.0.1:8001/patients/patient-solo-1/notes", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify([]),
    });
  });

  await page.goto("/");

  await page.getByRole("button", { name: "Open chart for Reset Check" }).click();
  await page.getByRole("button", { name: "Continue consultation" }).click();

  await expect(page.getByRole("complementary").getByText("Consultation", { exact: true })).toBeVisible();
  await page.getByLabel("Symptoms").fill("Review symptoms");
  await page.getByLabel("Diagnosis").fill("Routine review");
  await page.getByLabel("Medications").fill("None");
  await page.getByLabel("Clinical Notes").fill("Billing reset repro");
  await page.getByRole("button", { name: "Generate Note" }).click();
  await expect(page.getByText("Plan: Hydration and observation.")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  await expect(page.getByRole("heading", { level: 2, name: "Reset Check", exact: true })).toBeVisible();
  await expect(page.getByText("Invoice Items for Reset Check")).toBeVisible();

  await page.getByPlaceholder("e.g. Procedure charge, dressing, emergency fee").fill("Custom fee");
  const decimalInputs = page.locator('input[inputmode="decimal"]');
  await decimalInputs.last().fill("250");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByText("2 items")).toBeVisible();
  await expect(page.getByText("Custom fee")).toBeVisible();

  await page.waitForTimeout(6500);

  await expect(page.getByText("Custom fee")).toBeVisible();
  await expect(page.getByText("2 items")).toBeVisible();
});

test("consultation follow-up failure keeps the drawer open and shows the error", async ({ page }) => {
  const user = buildUser({ doctor_signature_name: "Dr. Rivera" });
  const patient = buildPatient({
    id: "patient-follow-up-1",
    name: "Follow Up Check",
    reason: "Review",
    status: "consultation",
  });

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings({ workspace_mode: "team", timezone: "Asia/Kolkata" }),
    patients: [patient],
  });
  await mockConsultationFlow(page);

  await page.route("http://127.0.0.1:8001/patients/patient-follow-up-1/notes", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify([]),
    });
  });
  await page.route("http://127.0.0.1:8001/patients/patient-follow-up-1/follow-ups", async (route) => {
    await route.fulfill({
      status: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ detail: "Follow-up create failed." }),
    });
  });

  await page.goto("/");

  await page.getByRole("button", { name: "Open chart for Follow Up Check" }).click();
  await page.getByRole("button", { name: "Continue consultation" }).click();

  await page.getByLabel("Symptoms").fill("Review symptoms");
  await page.getByLabel("Diagnosis").fill("Routine review");
  await page.getByLabel("Medications").fill("None");
  await page.getByLabel("Clinical Notes").fill("Follow-up failure repro");
  await page.getByRole("button", { name: "Generate Note" }).click();
  await expect(page.getByText("Plan: Hydration and observation.")).toBeVisible();

  await page.getByRole("button", { name: "Follow-up" }).click();
  await page.getByLabel("Follow-up Date").fill("2026-06-30");
  await page.getByLabel("Follow-up Notes").fill("Return for review");
  await page.getByRole("button", { name: "Done" }).click();

  await expect(page.getByText("Follow-up create failed.")).toBeVisible();
  await expect(page.getByRole("complementary").getByText("Consultation", { exact: true })).toBeVisible();
});
