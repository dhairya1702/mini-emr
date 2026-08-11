import { expect, test } from "@playwright/test";

import {
  buildClinicSettings,
  buildUser,
  mockClinicBootstrap,
  seedSession,
} from "./support/mock-clinic-api";

test("inventory rows open an edit drawer and save item and stock changes", async ({ page }) => {
  const user = buildUser({ role: "admin" });
  let item = {
    id: "catalog-item-1",
    org_id: user.org_id,
    name: "Lubricant Drops",
    item_type: "medicine",
    default_price: 420,
    track_inventory: true,
    stock_quantity: 4,
    low_stock_threshold: 5,
    unit: "bottle",
    hsn_sac_code: "",
    gst_rate: null,
    aliases: [],
    description: "",
    program_key: null,
    program_definition: null,
    is_active: true,
    created_at: new Date().toISOString(),
  };

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings({ clinic_specialty: "optometrist" }),
  });
  await page.route("**/catalog", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([item]) });
  });
  await page.route("**/catalog/catalog-item-1/stock", async (route) => {
    const payload = JSON.parse(route.request().postData() || "{}");
    item = { ...item, stock_quantity: item.stock_quantity + payload.delta };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(item) });
  });
  await page.route("**/catalog/catalog-item-1", async (route) => {
    const payload = JSON.parse(route.request().postData() || "{}");
    item = { ...item, ...payload };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(item) });
  });

  await page.goto("/inventory");

  await expect(page.getByText("Low Stock", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit Lubricant Drops" }).click();
  await expect(page.getByRole("heading", { name: "Edit item" })).toBeVisible();
  await expect(page.getByText("Current stock").locator(".." ).getByText("4", { exact: true })).toBeVisible();

  await page.getByLabel("Name").fill("Daily Lubricant Drops");
  await page.getByLabel("Default price").fill("450");
  await page.getByLabel("Adjust stock").fill("5");
  await expect(page.getByText("New stock: 9")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByRole("heading", { name: "Edit item" })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Daily Lubricant Drops" })).toBeVisible();
  await expect(page.getByText("9", { exact: true })).toBeVisible();
  await expect(page.getByText("Low Stock", { exact: true })).not.toBeVisible();
});
