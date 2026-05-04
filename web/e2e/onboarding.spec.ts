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
    clinicSettings: buildClinicSettings({ clinic_specialty: null }),
  });

  await page.goto("/onboarding/specialty");

  await expect(page.getByRole("heading", { name: "Select your clinic specialty" })).toBeVisible();
  await page.locator("label").filter({ hasText: "Optometry" }).first().click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Waiting" })).toBeVisible();
});
