import { expect, test } from "@playwright/test";

import {
  buildClinicSettings,
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  mockQueueIntake,
  seedSession,
} from "./support/mock-clinic-api";

test("queue smoke adds a patient and opens the settings drawer", async ({ page }) => {
  const user = buildUser();
  const existingPatient = buildPatient();

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients: [existingPatient],
  });
  await mockQueueIntake(page, [existingPatient]);

  await page.goto("/");

  await expect(page.getByText(existingPatient.name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add Patient" }).click();
  await expect(page.getByRole("heading", { name: "Add Patient" })).toBeVisible();

  await page.getByLabel("Name").fill("Taylor Brooks");
  await page.getByLabel("Phone").fill("5550103030");
  await page.getByLabel("Email").fill("taylor@example.com");
  await page.getByLabel("Address").fill("11 Pine Road");
  await page.getByLabel("Reason for visit").fill("Cough and fatigue");
  await page.getByLabel("Age").fill("34");
  await page.getByLabel("Weight").fill("72");
  await page.getByLabel("Temperature").fill("99.2");
  await page.getByRole("button", { name: "Add to Queue" }).click();

  await expect(page.getByText("Taylor Brooks", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();
  await page.getByRole("button", { name: "Clinic", exact: true }).click();
  await expect(page.getByText("Clinic name")).toBeVisible();
});
