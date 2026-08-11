import { expect, test } from "@playwright/test";

test("public QR check-in restores and updates live status", async ({ page }) => {
  let status: "pending" | "approved" = "pending";

  await page.route("**/public/check-in?token=clinic-token", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        clinic_name: "Fika Eye Care",
        clinic_address: "",
        clinic_phone: "",
      }),
    });
  });
  await page.route("**/public/check-in/status", async (route) => {
    expect(route.request().headers()["x-check-in-token"]).toBe("private-tracking-token-1234567890");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status }),
    });
  });

  await page.goto("/check-in?token=clinic-token#check-in=private-tracking-token-1234567890");
  await expect(page.getByRole("heading", { name: "Check-in submitted" })).toBeVisible();
  await expect(page.getByText("Reception at Fika Eye Care is reviewing your request.", { exact: false })).toBeVisible();

  status = "approved";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "You’re in the queue" })).toBeVisible();
  await expect(page.getByText("Please remain nearby", { exact: false })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "You’re in the queue" })).toBeVisible();
});
