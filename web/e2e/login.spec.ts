import { expect, test } from "@playwright/test";

import { buildClinicSettings, mockLoginFlow } from "./support/mock-clinic-api";

test("login smoke redirects into the authenticated queue shell", async ({ page }) => {
  await mockLoginFlow(page, {
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
  });

  await page.goto("/login");

  await page.getByLabel("Email or phone number").fill("admin@clinic.test");
  await page.locator('input[placeholder="Minimum 4 characters"]').fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Waiting" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Consultation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
});
