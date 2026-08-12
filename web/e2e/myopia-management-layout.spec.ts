import { expect, test } from "@playwright/test";

import {
  buildClinicSettings,
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  seedSession,
} from "./support/mock-clinic-api";

const API_ORIGIN = "http://127.0.0.1:8001";

test("myopia management renders the compact history dashboard", async ({ page }) => {
  const user = buildUser();
  const patient = buildPatient({ id: "patient-myopia-layout", name: "Myopia Layout Patient", age: 12 });
  const records = [
    {
      id: "myopia-layout-1",
      org_id: user.org_id,
      patient_id: patient.id,
      measured_at: "2025-01-08T10:00:00.000Z",
      age_years: 12,
      axial_length_right_mm: 24.04,
      axial_length_left_mm: 24.01,
      treatment_type: "Observation",
      treatment_notes: "",
      visit_notes: "Baseline before treatment.",
      refraction_right: "-2.00 DS",
      refraction_left: "-1.75 DS",
      created_at: "2025-01-08T10:00:00.000Z",
    },
    {
      id: "myopia-layout-2",
      org_id: user.org_id,
      patient_id: patient.id,
      measured_at: "2025-03-10T10:00:00.000Z",
      age_years: 12.2,
      axial_length_right_mm: 24.15,
      axial_length_left_mm: 24.11,
      treatment_type: "Low-dose atropine 0.05%",
      treatment_notes: "Started treatment.",
      visit_notes: "",
      refraction_right: "-2.25 DS",
      refraction_left: "-2.00 DS",
      created_at: "2025-03-10T10:00:00.000Z",
    },
    {
      id: "myopia-layout-3",
      org_id: user.org_id,
      patient_id: patient.id,
      measured_at: "2025-05-12T10:00:00.000Z",
      age_years: 12.4,
      axial_length_right_mm: 24.27,
      axial_length_left_mm: 24.22,
      treatment_type: "Low-dose atropine 0.05%",
      treatment_notes: "Good adherence.",
      visit_notes: "Tolerating well.",
      refraction_right: "-2.50 DS",
      refraction_left: "-2.25 DS",
      created_at: "2025-05-12T10:00:00.000Z",
    },
  ];

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings({ clinic_specialty: "optometry" }),
    patients: [patient],
  });
  await page.route(`${API_ORIGIN}/patients/${patient.id}/myopia-history`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        patient_id: patient.id,
        records,
        baseline_delta: { right_mm: 0.23, left_mm: 0.21 },
        last_delta: { right_mm: 0.12, left_mm: 0.11 },
        annualized_growth: { right_mm: 0.68, left_mm: 0.62 },
        overlay_version: "clinic-reference-v1",
      }),
    });
  });

  await page.goto("/patients");
  await page.getByText(patient.name, { exact: true }).first().click();
  await page.getByRole("button", { name: "Tests", exact: true }).click();
  await page.getByRole("button", { name: /Myopia/ }).click();

  await expect(page.getByRole("heading", { name: "Myopia Management" })).toBeVisible();
  await expect(page.getByText("Review axial-length progression, treatment changes, and backfilled records in one place.")).toHaveCount(0);
  await expect(page.getByText("View reading history", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Projection uses the recorded annualized growth trend/)).toHaveCount(0);
  await expect(page.getByText("Since baseline", { exact: true })).toBeVisible();
  await expect(page.getByText("Axial length trend with reference band", { exact: true })).toBeVisible();
  await expect(page.getByText("Projection", { exact: true })).toBeVisible();
  await expect(page.getByText("Current treatment", { exact: true })).toBeVisible();
  await expect(page.getByText("Low-dose atropine 0.05%", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Started Mar 2025", { exact: true })).toBeVisible();
  await expect(page.getByText("Readings & treatment timeline", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "1Y", exact: true })).toHaveAttribute("aria-pressed", "true");

  const dateLabels = await Promise.all(
    ["Jan 25", "Mar 25", "May 25"].map(async (label) => {
      const box = await page.locator("svg text").filter({ hasText: label }).boundingBox();
      expect(box, `${label} chart label should render`).not.toBeNull();
      return box!;
    }),
  );
  expect(dateLabels[1]!.x - (dateLabels[0]!.x + dateLabels[0]!.width)).toBeGreaterThan(8);
  expect(dateLabels[2]!.x - (dateLabels[1]!.x + dateLabels[1]!.width)).toBeGreaterThan(8);

  await page.getByRole("button", { name: "Add reading", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Myopia Management" })).toBeVisible();
  await expect(page.getByText("Visit details", { exact: true })).toBeVisible();
  await expect(page.getByText("Clinical measurements", { exact: true })).toBeVisible();
  await expect(page.getByText("Clinical notes", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(page.getByText(/historical|backfill/i)).toHaveCount(0);
});
