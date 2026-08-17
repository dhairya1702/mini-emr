import { expect, Page, test } from "@playwright/test";

import {
  buildClinicSettings,
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  mockQueueIntake,
  seedSession,
} from "./support/mock-clinic-api";

async function dragByLabel(page: Page, sourceRegion: string, sourceLabel: string, targetLabel: string) {
  const sourceBox = await page.getByLabel(sourceRegion).getByLabel(sourceLabel).boundingBox();
  const targetBox = await page.getByLabel(targetLabel).boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error(`Could not locate drag source ${sourceLabel} or target ${targetLabel}.`);
  }
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 16 });
  await page.mouse.up();
  await expect(page.getByLabel(targetLabel).getByText("Morgan Lee", { exact: true })).toBeVisible();
}

test("queue smoke adds a patient and opens the settings drawer", async ({ page }) => {
  const user = buildUser({ doctor_signature_name: "signature.png" });
  const staffUser = buildUser({ id: "user-staff-1", identifier: "staff@clinic.test", role: "staff" });
  const existingPatient = buildPatient();

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    users: [user, staffUser],
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients: [existingPatient],
  });
  await mockQueueIntake(page, [existingPatient]);

  await page.goto("/");

  await expect(page.getByText(existingPatient.name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add Patient" }).click();
  await expect(page.getByRole("heading", { name: "Add Patient" })).toBeVisible();

  await page.getByLabel("Name").fill("Taylor Brooks");
  await page.getByLabel("Phone").fill("5550103030");
  await page.getByLabel("Email").fill("taylor@example.com");
  await page.getByLabel("DOB").fill("1992-03-18");
  await page.getByLabel("Reason for Visit").fill("Cough and fatigue");
  await page.getByLabel("Weight").fill("72");
  await page.getByLabel("Height").fill("170");
  await page.getByLabel("Temperature").fill("99.2");
  await page.getByRole("button", { name: "Add to Queue" }).click();

  await expect(page.getByText("Taylor Brooks", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();
  await page.getByRole("button", { name: "Clinic", exact: true }).click();
  await expect(page.getByText("Clinic name")).toBeVisible();
});

test("queue defers users and catalog until their workflows need them", async ({ page }) => {
  const user = buildUser({ doctor_signature_name: "signature.png" });
  const patient = buildPatient({
    id: "patient-lazy-resources-1",
    name: "Casey Billing",
    status: "done",
    billed: false,
  });
  let usersRequests = 0;
  let catalogRequests = 0;

  page.on("request", (request) => {
    if (request.url() === "http://127.0.0.1:8001/users") usersRequests += 1;
    if (request.url() === "http://127.0.0.1:8001/catalog") catalogRequests += 1;
  });
  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    users: [user],
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients: [patient],
  });
  await page.route(`http://127.0.0.1:8001/patients/${patient.id}/notes`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.goto("/");
  await expect(page.getByText(patient.name, { exact: true })).toBeVisible();
  expect(usersRequests).toBe(0);
  expect(catalogRequests).toBe(0);

  await page.getByRole("button", { name: `Open billing for ${patient.name}` }).click();
  await expect.poll(() => catalogRequests).toBe(1);
  expect(usersRequests).toBe(0);

  await page.getByRole("button", { name: "Close billing" }).click();
  await page.getByRole("button", { name: `Open billing for ${patient.name}` }).click();
  await expect(page.getByRole("button", { name: "Close billing" })).toBeVisible();
  expect(catalogRequests).toBe(1);
  expect(usersRequests).toBe(0);
});

test("full catalog cache survives Billing to Inventory navigation", async ({ page }) => {
  const user = buildUser({ doctor_signature_name: "signature.png" });
  let catalogRequests = 0;

  page.on("request", (request) => {
    if (request.url() === "http://127.0.0.1:8001/catalog") catalogRequests += 1;
  });
  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients: [],
  });

  await page.goto("/");
  expect(catalogRequests).toBe(0);
  await page.getByRole("link", { name: "Billing" }).click();
  await expect(page).toHaveURL(/\/billing$/);
  await expect.poll(() => catalogRequests).toBe(1);
  await page.getByRole("link", { name: "Inventory" }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  expect(catalogRequests).toBe(1);
});

test("queue drag moves a waiting patient into consultation", async ({ page }) => {
  const user = buildUser({ doctor_signature_name: "signature.png" });
  const staffUser = buildUser({ id: "user-staff-1", identifier: "staff@clinic.test", role: "staff" });
  const patient = buildPatient({
    id: "patient-drag-1",
    name: "Morgan Lee",
    reason: "Routine review",
    status: "waiting",
  });

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    users: [user, staffUser],
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients: [patient],
  });
  await mockQueueIntake(page, [patient]);

  await page.goto("/");

  await dragByLabel(page, "Waiting queue", "Drag Morgan Lee", "Consultation queue");
  await expect(page.getByLabel("Consultation queue").getByText("Morgan Lee", { exact: true })).toBeVisible();
});

test("queue header reviews and approves a QR check-in request", async ({ page }) => {
  const user = buildUser({ doctor_signature_name: "signature.png" });
  const existingPatient = buildPatient();
  const approvedPatient = buildPatient({
    id: "patient-qr-1",
    name: "Jordan QR",
    phone: "5550104040",
    reason: "Blurred vision",
    queue_position: 2,
  });
  let pending = true;
  let statusRequests = 0;
  let fullRequests = 0;

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients: [existingPatient],
  });
  await mockQueueIntake(page, [existingPatient]);
  await page.route("**/dashboard/status", async (route) => {
    statusRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        queue_revision: "queue-1",
        active_patient_count: pending ? 1 : 2,
        pending_check_in_count: pending ? 1 : 0,
        check_in_revision: pending ? "request-qr-1:1" : "empty:0",
      }),
    });
  });
  await page.route("**/check-in/requests", async (route) => {
    fullRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pending ? [{
        id: "request-qr-1",
        submitted_name: "Jordan QR",
        submitted_phone: "5550104040",
        submitted_email: "jordan@example.com",
        submitted_date_of_birth: "1990-04-12",
        submitted_sex_at_birth: "other",
        submitted_reason: "Blurred vision",
        status: "pending",
        approved_patient_id: null,
        reviewed_by: null,
        reviewed_at: null,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        candidates: [],
      }] : []),
    });
  });
  await page.route("**/check-in/requests/request-qr-1/approve", async (route) => {
    pending = false;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(approvedPatient) });
  });

  await page.goto("/");

  const checkInsButton = page.getByRole("button", { name: "Open check-in requests, 1 pending" });
  await expect(checkInsButton).toBeVisible();
  await expect.poll(() => statusRequests).toBeGreaterThanOrEqual(1);
  expect(fullRequests).toBe(0);
  await expect(checkInsButton).toHaveClass(/animate-pulse/);
  await checkInsButton.click({ force: true });
  await expect.poll(() => fullRequests).toBe(1);
  await expect(page.getByRole("heading", { name: "Check-in requests" })).toBeVisible();
  await expect(page.getByText("Jordan QR", { exact: true })).toBeVisible();
  await expect(checkInsButton).not.toHaveClass(/animate-pulse/);

  await page.getByRole("button", { name: "Approve and add Jordan QR to queue" }).click();
  await expect(page.getByText("All caught up")).toBeVisible();
  await expect(page.getByLabel("Waiting queue").getByText("Jordan QR", { exact: true })).toBeVisible();
});

test("idle queue polls only the lightweight dashboard heartbeat", async ({ page }) => {
  await page.clock.install();
  const user = buildUser({ doctor_signature_name: "signature.png" });
  const patient = buildPatient({ id: "patient-idle-1", name: "Idle Queue Patient" });
  let heartbeatRequests = 0;
  let queueSnapshotRequests = 0;

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients: [patient],
  });
  await page.route("**/dashboard/status", async (route) => {
    heartbeatRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        queue_revision: "queue-idle",
        active_patient_count: 1,
        check_in_revision: "check-ins-idle:0",
        pending_check_in_count: 0,
      }),
    });
  });
  await page.route("**/patients/queue", async (route) => {
    queueSnapshotRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ revision: "queue-idle", patients: [patient], providers: [] }),
    });
  });

  await page.goto("/");
  await expect(page.getByText("Idle Queue Patient", { exact: true })).toBeVisible();
  await page.clock.fastForward(61_000);

  expect(heartbeatRequests).toBeGreaterThanOrEqual(2);
  expect(queueSnapshotRequests).toBe(1);
});
