import { expect, test } from "@playwright/test";

import {
  buildClinicSettings,
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  mockConsultationFlow,
  seedSession,
} from "./support/mock-clinic-api";

test("consultation smoke generates a note and completes the patient flow", async ({ page }) => {
  const user = buildUser({ doctor_signature_name: "Dr. Rivera" });
  const staffUser = buildUser({
    id: "user-staff-1",
    identifier: "staff@clinic.test",
    name: "Front Desk",
    role: "staff",
  });
  const patient = buildPatient({
    id: "patient-consult-1",
    name: "Avery Stone",
    reason: "Headache",
    status: "waiting",
  });

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    users: [user, staffUser],
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients: [patient],
  });
  await mockConsultationFlow(page);

  await page.goto("/");

  await page.getByRole("button", { name: "Start consultation for Avery Stone" }).click();
  await page.getByRole("button", { name: "Open chart for Avery Stone" }).click();

  await expect(page.getByRole("heading", { name: "Avery Stone" })).toBeVisible();
  await expect(page.getByRole("complementary").getByText("Consultation", { exact: true })).toBeVisible();

  await page.getByLabel("Symptoms").fill("Headache for three days");
  await page.getByLabel("Diagnosis").fill("Tension headache");
  await page.getByLabel("Medications").fill("Paracetamol");
  await page.getByLabel("Clinical Notes").fill("Hydration and rest advised.");
  await page.getByRole("button", { name: "Generate Note" }).click();

  await expect(page.getByText("Plan: Hydration and observation.")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  await expect(page.getByRole("heading", { name: "Avery Stone" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start consultation for Avery Stone" })).toHaveCount(0);
});
