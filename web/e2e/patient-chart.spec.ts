import { expect, test } from "@playwright/test";

import {
  buildClinicSettings,
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  seedSession,
} from "./support/mock-clinic-api";

test("patient chart smoke opens biodata and timeline details", async ({ page }) => {
  const user = buildUser({ doctor_signature_name: "Dr. Rivera" });
  const staffUser = buildUser({
    id: "user-staff-1",
    identifier: "staff@clinic.test",
    name: "Front Desk",
    role: "staff",
  });
  const patient = buildPatient({
    id: "patient-chart-1",
    name: "Jordan Miles",
    reason: "Review visit",
    status: "waiting",
  });

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    users: [user, staffUser],
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients: [patient],
  });

  await page.goto("/");

  await page.getByRole("button", { name: "Open chart for Jordan Miles" }).click();

  await expect(page.getByText("Patient Chart", { exact: true })).toBeVisible();
  await expect(page.getByText("Bio Data", { exact: true })).toBeVisible();
  await expect(page.getByText("Timeline", { exact: true })).toBeVisible();

  await page.getByRole("complementary").getByRole("button", { name: /Visit/ }).click();
  const selectedEventDetails = page.getByRole("region", { name: "Selected event details" });
  await expect(selectedEventDetails.getByText("Selected Event", { exact: true })).toBeVisible();
  await expect(selectedEventDetails.getByText("Review visit visit recorded.")).toBeVisible();
});
