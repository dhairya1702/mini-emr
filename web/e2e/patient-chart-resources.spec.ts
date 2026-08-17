import { expect, test } from "@playwright/test";

import {
  buildPatient,
  buildUser,
  mockClinicBootstrap,
  seedSession,
} from "./support/mock-clinic-api";

const API_ORIGIN = "http://127.0.0.1:8001";

function buildAttachment(patientId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "attachment-report-1",
    org_id: "org-1",
    patient_id: patientId,
    visit_id: null,
    uploaded_by: "user-1",
    file_name: "report.pdf",
    content_type: "application/pdf",
    file_size: 2048,
    storage_path: "patients/report.pdf",
    created_at: "2026-08-17T12:00:00.000Z",
    ...overrides,
  };
}

test("patient chart lazily owns attachment upload, send, and delete workflows", async ({ page }) => {
  const user = buildUser();
  const patient = buildPatient({ id: "patient-resources-1", name: "Resource Patient" });
  const storedAttachment = buildAttachment(patient.id);
  let notesRequests = 0;
  let attachmentListRequests = 0;
  let sentPayload: Record<string, unknown> | null = null;

  await seedSession(page, { user });
  await mockClinicBootstrap(page, { user, patients: [patient] });
  await page.route(`${API_ORIGIN}/patients/${patient.id}/notes`, async (route) => {
    notesRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: "note-resource-1",
        patient_id: patient.id,
        content: "Attachment note",
        status: "final",
        created_at: "2026-08-16T12:00:00.000Z",
        finalized_at: "2026-08-16T12:30:00.000Z",
        asset_payload: [{
          id: "note-asset-1",
          kind: "attachment",
          name: "clinical-photo.jpg",
          content_type: "image/jpeg",
          data_base64: "aW1hZ2U=",
        }],
      }]),
    });
  });
  await page.route(`${API_ORIGIN}/patients/${patient.id}/attachments`, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildAttachment(patient.id, {
          id: "attachment-uploaded-1",
          file_name: "uploaded-report.pdf",
          created_at: "2026-08-17T13:00:00.000Z",
        })),
      });
      return;
    }
    attachmentListRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([storedAttachment]) });
  });
  await page.route(`${API_ORIGIN}/patients/${patient.id}/attachments/${storedAttachment.id}/send`, async (route) => {
    sentPayload = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, message: "Attachment sent." }),
    });
  });
  await page.route(`${API_ORIGIN}/patients/${patient.id}/attachments/${storedAttachment.id}`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(storedAttachment) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: `Open chart for ${patient.name}` }).click();
  expect(notesRequests).toBe(0);
  expect(attachmentListRequests).toBe(0);

  await page.getByRole("button", { name: "Attachments", exact: true }).click();
  await expect(page.getByText("report.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("clinical-photo.jpg", { exact: true })).toBeVisible();
  expect(notesRequests).toBe(1);
  expect(attachmentListRequests).toBe(1);

  await page.getByRole("button", { name: "Send", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Send attachment" })).toBeVisible();
  await page.getByRole("button", { name: "Send attachment", exact: true }).click();
  await expect(page.getByText("Attachment sent.")).toBeVisible();
  expect(sentPayload).toMatchObject({
    recipient_email: patient.email,
    subject: `${patient.name} attachment: report.pdf`,
  });

  const attachmentInput = page.locator('input[type="file"][accept*="application/pdf"]');
  await attachmentInput.setInputFiles({
    name: "uploaded-report.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("pdf"),
  });
  await expect(page.getByText("uploaded-report.pdf", { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).last().click();
  await expect(page.getByText("report.pdf", { exact: true })).toHaveCount(0);
});

test("patient chart validates, uploads, previews, and removes a profile photo", async ({ page }) => {
  const user = buildUser();
  const patient = buildPatient({
    id: "patient-profile-photo-1",
    name: "Profile Patient",
    profile_photo_url: null,
    profile_photo_content_type: null,
    profile_photo_updated_at: null,
  });
  let uploadRequests = 0;
  let removeRequests = 0;
  let photoFileRequests = 0;

  await seedSession(page, { user });
  await mockClinicBootstrap(page, { user, patients: [patient] });
  await page.route(`${API_ORIGIN}/patients/${patient.id}/profile-photo`, async (route) => {
    if (route.request().method() === "POST") {
      uploadRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...patient,
          profile_photo_url: `/patients/${patient.id}/profile-photo/file`,
          profile_photo_content_type: "image/png",
          profile_photo_updated_at: "2026-08-17T13:00:00.000Z",
        }),
      });
      return;
    }
    removeRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...patient,
        profile_photo_url: null,
        profile_photo_content_type: null,
        profile_photo_updated_at: null,
      }),
    });
  });
  await page.route(`${API_ORIGIN}/patients/${patient.id}/profile-photo/file`, async (route) => {
    photoFileRequests += 1;
    await route.fulfill({ status: 200, contentType: "image/png", body: "image" });
  });

  await page.goto("/");
  await page.getByRole("button", { name: `Open chart for ${patient.name}` }).click();
  const profileInput = page.locator('input.sr-only[type="file"][accept*=".webp"]');

  await profileInput.setInputFiles({ name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from("invalid") });
  await expect(page.getByText("Only JPG, PNG, and WEBP patient photos are supported.")).toBeVisible();
  expect(uploadRequests).toBe(0);

  await profileInput.setInputFiles({ name: "profile.png", mimeType: "image/png", buffer: Buffer.from("image") });
  await expect(page.getByRole("button", { name: "Manage patient photo" }).first()).toBeVisible();
  expect(uploadRequests).toBe(1);
  await expect.poll(() => photoFileRequests).toBeGreaterThanOrEqual(1);

  await page.getByRole("button", { name: "Manage patient photo" }).first().click();
  await expect(page.getByRole("dialog", { name: `Manage ${patient.name} profile photo` })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove photo" }).click();
  await expect(page.getByRole("button", { name: "Add patient photo" }).first()).toBeVisible();
  expect(removeRequests).toBe(1);
});

test("patient chart resource failures reset when switching patients", async ({ page }) => {
  const user = buildUser();
  const firstPatient = buildPatient({ id: "patient-resource-failure-1", name: "Failed Resources" });
  const secondPatient = buildPatient({ id: "patient-resource-failure-2", name: "Clean Resources" });

  await seedSession(page, { user });
  await mockClinicBootstrap(page, { user, patients: [firstPatient, secondPatient] });
  await page.route(`${API_ORIGIN}/patients/${firstPatient.id}/notes`, async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "Resources unavailable." }) });
  });
  await page.route(`${API_ORIGIN}/patients/${firstPatient.id}/attachments`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route(`${API_ORIGIN}/patients/${secondPatient.id}/notes`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route(`${API_ORIGIN}/patients/${secondPatient.id}/attachments`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([buildAttachment(secondPatient.id, {
        id: "attachment-clean-1",
        file_name: "clean-patient.pdf",
      })]),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: `Open chart for ${firstPatient.name}` }).click();
  await page.getByRole("button", { name: "Attachments", exact: true }).click();
  await expect(page.getByText("Resources unavailable.")).toBeVisible();

  await page.getByRole("button", { name: "Close patient chart" }).click();
  await page.getByRole("button", { name: `Open chart for ${secondPatient.name}` }).click();
  await page.getByRole("button", { name: "Attachments", exact: true }).click();
  await expect(page.getByText("clean-patient.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("Resources unavailable.")).toHaveCount(0);
});
