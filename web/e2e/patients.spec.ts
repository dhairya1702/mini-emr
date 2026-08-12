import { expect, test } from "@playwright/test";

import {
  buildClinicSettings,
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  seedSession,
} from "./support/mock-clinic-api";

const PATIENTS_ENDPOINT = "http://127.0.0.1:8001/patients";

test("patient directory uses one lightweight initial request and ignores stale searches", async ({ page }) => {
  const user = buildUser({ doctor_signature_name: "signature.png" });
  const robin = buildPatient({ id: "patient-robin", name: "Robin Shah" });
  const casey = buildPatient({ id: "patient-casey", name: "Casey Morgan" });
  const requestedQueries: string[] = [];
  const contextFlags: string[] = [];

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients: [robin, casey],
  });
  await page.route(new RegExp(`^${PATIENTS_ENDPOINT}(?:\\?.*)?$`), async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("q") || "";
    requestedQueries.push(query);
    contextFlags.push(url.searchParams.get("include_queue_context") || "");
    if (query === "Robin") {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([robin]) });
      return;
    }
    if (query === "Casey") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([casey]) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([robin, casey]) });
  });

  await page.goto("/patients");
  await expect(page.getByText("Robin Shah", { exact: true })).toBeVisible();
  await page.waitForTimeout(350);
  expect(requestedQueries).toEqual([""]);
  expect(contextFlags).toEqual(["false"]);

  const search = page.getByPlaceholder("Search by name, phone fragment, or visit reason");
  await search.fill("Robin");
  await expect.poll(() => requestedQueries.includes("Robin")).toBe(true);
  await search.fill("Casey");
  await expect(page.getByText("Casey Morgan", { exact: true })).toBeVisible();
  await page.waitForTimeout(750);

  await expect(page.getByText("Robin Shah", { exact: true })).toHaveCount(0);
  expect(requestedQueries).toEqual(["", "Robin", "Casey"]);
  expect(contextFlags).toEqual(["false", "false", "false"]);
});
