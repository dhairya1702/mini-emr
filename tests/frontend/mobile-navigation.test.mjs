import test from "node:test";
import assert from "node:assert/strict";

import { importWebModule } from "./load-web-module.mjs";

const expectedAdminLabels = [
    "Queue",
    "Appointments",
    "Patients",
    "QR Code",
    "Care Programs",
    "Billing",
  "Inventory",
  "History",
  "Generate Letter",
  "Earnings",
  "Case Study",
  "Users",
  "Clinic",
  "Account",
  "Audit",
  "Training Mode",
  "About",
];

test("mobile admin navigation mirrors desktop menu coverage", async () => {
  const { getVisibleMobileNavItems } = await importWebModule("lib/mobile/navigation.ts");

  assert.deepEqual(
    getVisibleMobileNavItems("admin").map((item) => item.label),
    expectedAdminLabels,
  );
});

test("mobile staff navigation hides admin-only destinations", async () => {
  const { getVisibleMobileNavItems } = await importWebModule("lib/mobile/navigation.ts");

  assert.deepEqual(
    getVisibleMobileNavItems("staff").map((item) => item.label),
    ["Queue", "Appointments", "Patients", "QR Code", "History", "Account", "Training Mode", "About"],
  );
});

test("mobile active state covers nested patient and consultation routes", async () => {
  const { getVisibleMobileNavItems, isMobileNavItemActive } = await importWebModule("lib/mobile/navigation.ts");
  const items = getVisibleMobileNavItems("admin");
  const queue = items.find((item) => item.label === "Queue");
  const patients = items.find((item) => item.label === "Patients");

  assert.equal(isMobileNavItemActive("/m/consultation/patient-1", queue), true);
  assert.equal(isMobileNavItemActive("/m/patient/patient-1", patients), true);
  assert.equal(isMobileNavItemActive("/m/inventory", queue), false);
});
