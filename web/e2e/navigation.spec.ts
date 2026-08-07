import { expect, test } from "@playwright/test";

import { buildPatient, buildUser, mockClinicBootstrap, seedSession } from "./support/mock-clinic-api";

test("top-level menu navigation replaces the current section in browser history", async ({ page }) => {
  const user = buildUser();
  const patient = buildPatient({ id: "patient-navigation-1", name: "Navigation Patient" });
  await seedSession(page, { user });
  await mockClinicBootstrap(page, { user, patients: [patient] });

  await page.goto("/");
  await page.goto("/qr-code");
  await expect(page).toHaveURL(/\/qr-code$/);

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Patients", exact: true }).click();
  await expect(page).toHaveURL(/\/patients$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});
