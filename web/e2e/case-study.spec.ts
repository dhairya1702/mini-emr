import { expect, test } from "@playwright/test";

import {
  buildCaseStudySource,
  buildClinicSettings,
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  seedSession,
} from "./support/mock-clinic-api";

test("case study smoke generates and saves a draft for an admin", async ({ page }) => {
  const user = buildUser();
  const patient = buildPatient({
    id: "patient-case-1",
    name: "Morgan Lee",
    reason: "Blurred vision",
    last_visit_at: "2026-05-02T10:00:00.000Z",
  });

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings({ clinic_specialty: "optometry" }),
    patients: [patient],
    caseStudySource: buildCaseStudySource(patient),
  });

  await page.goto("/case-study");

  await page.getByPlaceholder("Search patient").fill("Morgan");
  await page.getByRole("button", { name: /Morgan Lee/ }).click();
  await page.getByLabel("Title").fill("Interesting blurred vision case");
  await page.getByLabel("Brief").fill("Focus on progression and management decisions.");
  await page.getByRole("button", { name: "Generate" }).click();

  await expect(page.getByText("Case study generated. Review and save when ready.")).toBeVisible();
  await page.getByRole("button", { name: "Save Draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
});

test("case study remains admin-only for staff users", async ({ page }) => {
  const user = buildUser({
    id: "user-staff-1",
    identifier: "staff@clinic.test",
    role: "staff",
  });

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings(),
  });

  await page.goto("/case-study");

  await expect(page.getByText("Case Study is admin-only because it generates and stores AI-authored clinical documents.")).toBeVisible();
});
