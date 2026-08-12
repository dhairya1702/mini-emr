import { expect, test } from "@playwright/test";

import {
  buildClinicSettings,
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  mockConsultationFlow,
  seedSession,
} from "./support/mock-clinic-api";

test("consultations share one lightweight medicine request", async ({ page }) => {
  const user = buildUser({ doctor_signature_name: "Dr. Rivera" });
  const patients = [
    buildPatient({ id: "patient-catalog-1", name: "Avery Stone", status: "waiting" }),
    buildPatient({ id: "patient-catalog-2", name: "Morgan Lee", status: "waiting", queue_position: 2 }),
  ];
  let medicineRequests = 0;
  let fullCatalogRequests = 0;

  page.on("request", (request) => {
    if (request.url() === "http://127.0.0.1:8001/catalog/medicines") medicineRequests += 1;
    if (request.url() === "http://127.0.0.1:8001/catalog") fullCatalogRequests += 1;
  });
  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients,
  });
  await mockConsultationFlow(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Open chart for Avery Stone" }).click();
  await page.getByRole("button", { name: "Start consultation" }).click();
  await expect.poll(() => medicineRequests).toBe(1);
  expect(fullCatalogRequests).toBe(0);
  await page.getByRole("button", { name: "Close consultation" }).click();
  await page.getByRole("button", { name: "Close patient chart" }).click();

  await page.getByRole("button", { name: "Open chart for Morgan Lee" }).click();
  await page.getByRole("button", { name: "Start consultation" }).click();
  await expect(page.getByRole("complementary").getByRole("heading", { name: "Morgan Lee" })).toBeVisible();
  expect(medicineRequests).toBe(1);
  expect(fullCatalogRequests).toBe(0);
});

test("consultation smoke generates a note and completes the patient flow", async ({ page }) => {
  const user = buildUser({ doctor_signature_name: "Dr. Rivera" });
  const staffUser = buildUser({
    id: "user-staff-1",
    identifier: "staff@clinic.test",
    name: "Front Desk",
    role: "staff",
  });
  const patient = buildPatient({
    id: "patient-consult-1",
    name: "Avery Stone",
    reason: "Headache",
    status: "waiting",
  });

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    users: [user, staffUser],
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients: [patient],
  });
  await mockConsultationFlow(page);

  await page.goto("/");

  await page.getByRole("button", { name: "Open chart for Avery Stone" }).click();
  await page.getByRole("button", { name: "Start consultation" }).click();

  await expect(
    page.getByRole("complementary").getByRole("heading", { name: "Avery Stone" }),
  ).toBeVisible();
  await expect(page.getByRole("complementary").getByText("Consultation", { exact: true })).toBeVisible();

  await page.getByLabel("Symptoms").fill("Headache for three days");
  await page.getByLabel("Diagnosis").fill("Tension headache");
  await page.getByLabel("Medications").fill("Paracetamol");
  await page.getByLabel("Clinical Notes").fill("Hydration and rest advised.");
  await page.getByRole("button", { name: "Generate Note" }).click();

  await expect(page.getByText("Plan: Hydration and observation.")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Billing queue" }).getByText("Avery Stone", { exact: true }),
  ).toBeVisible();
});

test("consultation draft survives closing, reopening, and refreshing the shell", async ({ page }) => {
  const user = buildUser({ doctor_signature_name: "Dr. Rivera" });
  const patient = buildPatient({
    id: "patient-consult-recovery-1",
    name: "Jordan Reed",
    reason: "Persistent headache",
    status: "waiting",
  });

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients: [patient],
  });
  await mockConsultationFlow(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Open chart for Jordan Reed" }).click();
  await page.getByRole("button", { name: "Start consultation" }).click();
  await page.getByLabel("Symptoms").fill("Headache for five days");
  await page.getByLabel("Diagnosis").fill("Tension headache");
  await page.getByLabel("Clinical Notes").fill("Hydration and sleep reviewed.");
  await page.getByRole("button", { name: "Generate Note" }).click();
  await expect(page.getByText("Plan: Hydration and observation.")).toBeVisible();

  await page.getByRole("button", { name: "Close consultation" }).click();
  await expect(page.getByRole("button", { name: "Close patient chart" })).toBeVisible();
  await page.getByRole("button", { name: "Continue Consultation" }).click();
  await expect(page.getByLabel("Symptoms")).toHaveValue("Headache for five days");
  await expect(page.getByLabel("Diagnosis")).toHaveValue("Tension headache");
  await expect(page.getByLabel("Clinical Notes")).toHaveValue("Hydration and sleep reviewed.");
  await expect(page.getByText("Plan: Hydration and observation.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Symptoms")).toHaveValue("Headache for five days");
  await expect(page.getByLabel("Diagnosis")).toHaveValue("Tension headache");
  await expect(page.getByText("Plan: Hydration and observation.")).toBeVisible();
});

test("closing a consultation cancels pending WhatsApp delivery polling", async ({ page }) => {
  const user = buildUser();
  const patient = buildPatient({
    id: "patient-consult-whatsapp-1",
    name: "Morgan Lee",
    phone: "+919876543210",
    reason: "Follow-up",
    status: "waiting",
  });
  let deliveryPolls = 0;

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings({ clinic_specialty: "general_physician" }),
    patients: [patient],
  });
  await mockConsultationFlow(page);
  await page.route("http://127.0.0.1:8001/send-note-whatsapp", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        message: "Consultation note accepted by WhatsApp.",
        delivery: {
          event_id: "delivery-consultation-1",
          document_type: "consultation_note",
          document_id: "note-1",
          recipient: "919876543210",
          provider_message_id: "wamid.consultation-1",
          status: "accepted",
          error: "",
        },
      }),
    });
  });
  await page.route(
    "http://127.0.0.1:8001/whatsapp/document-deliveries/consultation_note/note-1",
    async (route) => {
      deliveryPolls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          event_id: "delivery-consultation-1",
          document_type: "consultation_note",
          document_id: "note-1",
          recipient: "919876543210",
          provider_message_id: "wamid.consultation-1",
          status: "accepted",
          error: "",
        }),
      });
    },
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Open chart for Morgan Lee" }).click();
  await page.getByRole("button", { name: "Start consultation" }).click();
  await page.getByLabel("Symptoms").fill("Symptoms improving");
  await page.getByLabel("Diagnosis").fill("Routine follow-up");
  await page.getByRole("button", { name: "Generate Note" }).click();
  await page.getByRole("button", { name: "Send WhatsApp" }).click();
  await expect(page.getByText("WhatsApp: Accepted")).toBeVisible();

  await page.getByRole("complementary").locator("button").first().click();
  await expect(page.getByRole("button", { name: "Close patient chart" })).toBeVisible();
  await expect(page.getByLabel("Symptoms")).toHaveCount(0);
  await page.waitForTimeout(3500);

  expect(deliveryPolls).toBe(0);
});

test("optometry consultation separates History, Examination, and Consultation", async ({ page }) => {
  await page.clock.install();
  const user = buildUser();
  const patient = buildPatient({
    id: "patient-optometry-steps-1",
    name: "Riley Shah",
    reason: "Vision review",
    status: "waiting",
  });

  await seedSession(page, { user });
  await mockClinicBootstrap(page, {
    user,
    clinicSettings: buildClinicSettings({ clinic_specialty: "optometry" }),
    patients: [patient],
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open chart for Riley Shah" }).click();
  await page.getByRole("button", { name: "Start consultation" }).click();

  const steps = page.getByRole("navigation", { name: "Consultation steps" });
  await expect(steps.getByRole("button", { name: /History/ })).toBeVisible();
  await expect(steps.getByRole("button", { name: /Examination/ })).toBeVisible();
  await expect(steps.getByRole("button", { name: /Consultation/ })).toBeVisible();
  await expect(steps.getByRole("button", { name: /History/ })).toHaveAttribute("aria-current", "step");
  await expect(page).toHaveURL(/workspace=consultation.*consultationStep=history/);
  await page.goBack();
  await expect(page.getByRole("button", { name: "Close patient chart" })).toBeVisible();
  await page.getByRole("button", { name: "Continue Consultation" }).click();
  await expect(steps.getByRole("button", { name: /History/ })).toHaveAttribute("aria-current", "step");
  await page.getByLabel("Add attachment").setInputFiles({
    name: "history-scan.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await expect(page.getByText("history-scan.png")).toBeVisible();

  await page.getByRole("button", { name: "Continue to Examination" }).click();
  await expect(steps.getByRole("button", { name: /Examination/ })).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("tablist", { name: "Clinical modules" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Visual Acuity" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue Consultation" })).toBeVisible();
  const eyeExamFooter = page.getByRole("button", { name: "Save", exact: true }).locator("..");
  await expect(eyeExamFooter.getByRole("button")).toHaveText([
    "Back",
    "Next",
    "Save",
    "Continue Consultation",
  ]);
  const eyeExamFooterBottomGap = await eyeExamFooter.evaluate((element) => window.innerHeight - element.getBoundingClientRect().bottom);
  expect(Math.abs(eyeExamFooterBottomGap)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Refraction" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Visual Acuity" })).toBeVisible();
  await expect(steps.getByRole("button", { name: /Examination/ })).toHaveAttribute("aria-current", "step");
  await page.goBack();
  await expect(steps.getByRole("button", { name: /History/ })).toHaveAttribute("aria-current", "step");
  await page.getByRole("button", { name: "Continue to Examination" }).click();
  await expect(page.getByRole("heading", { name: "Visual Acuity" })).toBeVisible();

  await page.getByLabel("UCVA distance").first().fill("6/9");
  await page.goBack();
  await expect(steps.getByRole("button", { name: /History/ })).toHaveAttribute("aria-current", "step");
  await page.getByRole("button", { name: "Continue to Examination" }).click();
  await expect(page.getByLabel("UCVA distance").first()).toHaveValue("6/9");

  const clinicalModules = page.getByRole("tablist", { name: "Clinical modules" });
  await clinicalModules.getByRole("button", { name: "Contact lens", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Contact Lens Initial Work-up" })).toBeVisible();
  const contactLensFooter = page.getByRole("button", { name: "Save", exact: true }).last().locator("..");
  await expect(contactLensFooter.getByRole("button")).toHaveText([
    "Back",
    "Next",
    "Save",
    "Continue Consultation",
  ]);
  const contactLensFooterBottomGap = await contactLensFooter.evaluate((element) => window.innerHeight - element.getBoundingClientRect().bottom);
  expect(Math.abs(contactLensFooterBottomGap)).toBeLessThanOrEqual(1);
  await contactLensFooter.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Clinical Assessment" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Contact Lens Initial Work-up" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Visual Acuity" })).toBeVisible();

  await clinicalModules.getByRole("button", { name: "Low vision", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Low Vision Initial Assessment", exact: true }).last()).toBeVisible();
  const lowVisionFooter = page.getByRole("button", { name: "Save", exact: true }).last().locator("..");
  await expect(lowVisionFooter.getByRole("button")).toHaveText([
    "Back",
    "Next",
    "Save",
    "Continue Consultation",
  ]);
  const lowVisionFooterBottomGap = await lowVisionFooter.evaluate((element) => window.innerHeight - element.getBoundingClientRect().bottom);
  expect(Math.abs(lowVisionFooterBottomGap)).toBeLessThanOrEqual(1);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Visual Acuity" })).toBeVisible();

  await clinicalModules.getByRole("button", { name: "Myopia", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Myopia Management", exact: true })).toBeVisible();
  await expect(page.getByText("Visit details", { exact: true })).toBeVisible();
  await expect(page.getByText("Clinical measurements", { exact: true })).toBeVisible();
  await expect(page.getByText("Clinical notes", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true }).last()).toBeVisible();
  await expect(page.getByText(/historical|backfill/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Visual Acuity" })).toBeVisible();

  await page.getByLabel("UCVA distance").first().fill("6/6");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Refraction" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Visual Acuity" })).toBeVisible();
  await page.getByRole("button", { name: /Ocular Examination/ }).click();
  await expect(page.getByRole("heading", { name: "Ocular Examination" })).toBeVisible();

  const queueRefresh = page.waitForRequest((request) => (
    new URL(request.url()).pathname === "/dashboard/status" && request.method() === "GET"
  ));
  await page.clock.fastForward(16_000);
  await queueRefresh;
  await expect(steps.getByRole("button", { name: /Examination/ })).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("heading", { name: "Ocular Examination" })).toBeVisible();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Eye exam saved.")).toBeVisible();
  await expect(steps.getByRole("button", { name: /Examination/ })).toHaveAttribute("aria-current", "step");
  await page.getByRole("button", { name: "Continue Consultation" }).click();
  await expect(steps.getByRole("button", { name: /Consultation/ })).toHaveAttribute("aria-current", "step");
  await page.goBack();
  await expect(steps.getByRole("button", { name: /Examination/ })).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("heading", { name: "Ocular Examination" })).toBeVisible();
  await page.getByRole("button", { name: "Continue Consultation" }).click();
  await expect(steps.getByRole("button", { name: /Consultation/ })).toHaveAttribute("aria-current", "step");
  await expect(page.getByLabel("Symptoms")).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Clinical modules" })).toHaveCount(0);
  await expect(page.getByText("Examinations completed", { exact: true })).toBeVisible();
  await expect(page.getByText("history-scan.png")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit history" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ask AI Questions" })).toBeVisible();
  await expect(page.getByLabel("Recipient email")).toBeVisible();
  await expect(page.getByLabel("WhatsApp number")).toBeVisible();

  const symptomsBox = await page.getByLabel("Symptoms").boundingBox();
  const recipientBox = await page.getByLabel("Recipient email").boundingBox();
  expect(recipientBox?.x ?? 0).toBeGreaterThan(symptomsBox?.x ?? Number.MAX_SAFE_INTEGER);

  await steps.getByRole("button", { name: /Examination/ }).click();
  await expect(page.getByRole("heading", { name: "Ocular Examination" })).toBeVisible();
  await page.getByRole("complementary").locator("button").first().click();
  await expect(page.getByLabel("Symptoms")).toHaveCount(0);
});
