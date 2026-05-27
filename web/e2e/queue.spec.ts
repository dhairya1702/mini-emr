import { expect, Page, test } from "@playwright/test";

import {
  buildClinicSettings,
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  mockQueueIntake,
  seedSession,
} from "./support/mock-clinic-api";

async function dragByLabel(page: Page, sourceLabel: string, targetLabel: string) {
  const sourceBox = await page.getByLabel(sourceLabel).boundingBox();
  const targetBox = await page.getByLabel(targetLabel).boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error(`Could not locate drag source ${sourceLabel} or target ${targetLabel}.`);
  }

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.mouse.up();
}

test("queue smoke adds a patient and opens the settings drawer", async ({ page }) => {
  const user = buildUser({ doctor_signature_name: "signature.png" });
  const staffUser = buildUser({ id: "user-staff-1", identifier: "staff@clinic.test", role: "staff" });
  const existingPatient = buildPatient();

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    users: [user, staffUser],
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

test("queue drag moves a patient through consultation and billing", async ({ page }) => {
  const user = buildUser({ doctor_signature_name: "signature.png" });
  const staffUser = buildUser({ id: "user-staff-1", identifier: "staff@clinic.test", role: "staff" });
  const patient = buildPatient({
    id: "patient-drag-1",
    name: "Morgan Lee",
    reason: "Routine review",
    status: "waiting",
  });

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    users: [user, staffUser],
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients: [patient],
  });
  await mockQueueIntake(page, [patient]);

  await page.goto("/");

  await dragByLabel(page, "Drag Morgan Lee", "Consultation queue");
  await expect(page.getByLabel("Consultation queue").getByText("Morgan Lee", { exact: true })).toBeVisible();

  await dragByLabel(page, "Drag Morgan Lee", "Billing queue");
  await expect(page.getByLabel("Billing queue").getByText("Morgan Lee", { exact: true })).toBeVisible();
});
