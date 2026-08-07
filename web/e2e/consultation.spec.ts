import { expect, test } from "@playwright/test";

import {
  buildClinicSettings,
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  mockConsultationFlow,
  seedSession,
} from "./support/mock-clinic-api";

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
  await expect(page.getByRole("complementary")).toHaveCount(0);
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

  await page.getByLabel("UCVA distance").first().fill("6/6");
  await page.getByRole("button", { name: /Glasses prescriptions/ }).click();
  await expect(page.getByRole("heading", { name: "Glasses Prescriptions" })).toBeVisible();

  const queueRefresh = page.waitForRequest((request) => (
    new URL(request.url()).pathname === "/patients" && request.method() === "GET"
  ));
  await page.clock.fastForward(16_000);
  await queueRefresh;
  await expect(steps.getByRole("button", { name: /Examination/ })).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("heading", { name: "Glasses Prescriptions" })).toBeVisible();

  await page.getByRole("button", { name: "Save Eye Exam" }).click();
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
  await expect(page.getByRole("heading", { name: "Glasses Prescriptions" })).toBeVisible();
});
