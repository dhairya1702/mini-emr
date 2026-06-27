import { expect, test } from "@playwright/test";

import {
  buildClinicSettings,
  buildUser,
  mockClinicBootstrap,
  seedSession,
} from "./support/mock-clinic-api";

test("specialty onboarding saves and returns to the queue", async ({ page }) => {
  const user = buildUser();
  await seedSession(page, {
    user,
    specialtyOnboardingPending: true,
  });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings({
      clinic_specialty: null,
      onboarding_required: true,
      onboarding_completed_at: null,
    }),
  });

  await page.goto("/onboarding/setup");

  await expect(page.getByRole("heading", { name: "Specialty" })).toBeVisible();
  await page.getByRole("button", { name: "Save and continue" }).evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole("heading", { name: "Clinic Hours" })).toBeVisible();
  await page.getByRole("button", { name: "Save and continue" }).evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
  for (const heading of ["Signature", "Gmail Sender", "Staff User", "Letterhead"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).evaluate((button) => {
      (button as HTMLButtonElement).click();
    });
  }
  const firstPatientHeading = page.getByRole("heading", { name: "First Patient" });
  const enterWorkspaceButton = page.getByRole("button", { name: "Enter workspace" });
  await expect(firstPatientHeading.or(enterWorkspaceButton)).toBeVisible();
  if (await firstPatientHeading.isVisible()) {
    await page.getByRole("button", { name: "Skip for now" }).evaluate((button) => {
      (button as HTMLButtonElement).click();
    });
  }
  await expect(enterWorkspaceButton).toBeVisible();
  await enterWorkspaceButton.evaluate((button) => {
    (button as HTMLButtonElement).click();
  });

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Waiting" })).toBeVisible();
});
