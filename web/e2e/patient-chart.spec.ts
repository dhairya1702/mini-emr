import { expect, test } from "@playwright/test";

import {
  buildClinicSettings,
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  seedSession,
} from "./support/mock-clinic-api";

test("patient chart smoke opens biodata and timeline details", async ({ page }) => {
  const user = buildUser();
  const patient = buildPatient({
    id: "patient-chart-1",
    name: "Jordan Miles",
    reason: "Review visit",
    status: "waiting",
  });

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients: [patient],
  });

  await page.goto("/");

  await page.getByText("Jordan Miles", { exact: true }).click();

  await expect(page.getByText("Patient Chart", { exact: true })).toBeVisible();
  await expect(page.getByText("Bio Data", { exact: true })).toBeVisible();
  await expect(page.getByText("Timeline", { exact: true })).toBeVisible();

  await page.getByRole("complementary").getByRole("button", { name: /Visit/ }).click();
  await expect(page.getByText("Selected Event", { exact: true })).toBeVisible();
  await expect(page.getByText("Review visit visit recorded.")).toBeVisible();
});
