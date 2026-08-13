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

test("clinic shell warns then signs out after inactivity", async ({ page }) => {
  const user = buildUser();
  const patient = buildPatient({ id: "patient-idle-logout-1", name: "Idle Patient" });
  let logoutRequests = 0;

  await page.clock.install();
  await seedSession(page, { user });
  await mockClinicBootstrap(page, { user, patients: [patient] });
  await page.route("**/auth/logout", async (route) => {
    logoutRequests += 1;
    await route.fulfill({ status: 204 });
  });

  await page.goto("/");
  await expect(page.getByText(patient.name, { exact: true })).toBeVisible();

  await page.clock.fastForward(9 * 60 * 1000);
  await expect(page.getByRole("dialog", { name: "You'll be signed out in 1 minute." })).toBeVisible();

  await page.clock.fastForward(60 * 1000);
  await expect.poll(() => logoutRequests).toBe(1);
  await page.clock.fastForward(1000);
  await expect(page).toHaveURL(/\/login$/);
});

test("clinic shell activity resets the inactivity warning", async ({ page }) => {
  const user = buildUser();
  const patient = buildPatient({ id: "patient-idle-reset-1", name: "Idle Reset Patient" });
  let logoutRequests = 0;

  await page.clock.install();
  await seedSession(page, { user });
  await mockClinicBootstrap(page, { user, patients: [patient] });
  await page.route("**/auth/logout", async (route) => {
    logoutRequests += 1;
    await route.fulfill({ status: 204 });
  });

  await page.goto("/");
  await expect(page.getByText(patient.name, { exact: true })).toBeVisible();

  await page.clock.fastForward(8 * 60 * 1000);
  await page.keyboard.press("Shift");
  await page.clock.fastForward(8 * 60 * 1000 + 500);
  await expect(page.getByRole("dialog", { name: "You'll be signed out in 1 minute." })).toHaveCount(0);
  expect(logoutRequests).toBe(0);

  await page.clock.fastForward(60 * 1000);
  await expect(page.getByRole("dialog", { name: "You'll be signed out in 1 minute." })).toBeVisible();
  await page.getByRole("button", { name: "Stay signed in" }).click();
  await expect(page.getByRole("dialog", { name: "You'll be signed out in 1 minute." })).toHaveCount(0);
  await page.clock.fastForward(60 * 1000);
  expect(logoutRequests).toBe(0);
});
