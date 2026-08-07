import { expect, test } from "@playwright/test";

import { mockPublicFollowUpBooking } from "./support/mock-clinic-api";

test("public follow-up flow confirms a suggested slot", async ({ page }) => {
  await mockPublicFollowUpBooking(page);

  await page.goto("/follow-up?token=valid-token");

  await expect(page.getByRole("heading", { name: "Book or manage your appointment" })).toBeVisible();
  await page.getByRole("button", { name: /May/ }).first().click();
  await page.getByRole("button", { name: "Book appointment" }).click();

  await expect(page.getByText("Appointment booked.")).toBeVisible();
});
