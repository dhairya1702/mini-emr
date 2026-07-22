import { readFile } from "node:fs/promises";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API_BASE_URL = "http://127.0.0.1:8012";
const PASSWORD = "password123!";
const attachmentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8BQDwAFgwJ/lh1fWQAAAABJRU5ErkJggg==",
  "base64",
);

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function futureIsoDate(daysFromNow = 2) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

function futureClinicHourIso(daysFromNow = 2, utcHour = 5) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setUTCHours(utcHour, 0, 0, 0);
  return date.toISOString();
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Cookie: `clinic_session=${token}`,
  };
}

async function registerClinic(request: APIRequestContext, label = unique("live")) {
  const identifier = `${label}@clinic.test`;
  const response = await request.post(`${API_BASE_URL}/auth/register`, {
    data: {
      identifier,
      password: PASSWORD,
      admin_name: "Dr. Live E2E",
      clinic_name: `Live E2E ${label}`,
      clinic_address: "123 Browser Street",
      clinic_phone: "5550100000",
      doctor_name: "Dr. Live E2E",
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json() as { token: string; user: { identifier: string } };
  expect(body.token).toBeTruthy();
  expect(body.user.identifier).toBe(identifier);
  return { ...body, identifier, password: PASSWORD };
}

async function completeOnboarding(request: APIRequestContext, token: string) {
  const headers = authHeaders(token);
  const settings = await request.put(`${API_BASE_URL}/settings/clinic`, {
    headers,
    data: {
      clinic_name: "Live E2E Clinic",
      clinic_address: "123 Browser Street",
      clinic_phone: "5550100000",
      clinic_specialty: "general_physician",
      timezone: "Asia/Kolkata",
      appointment_start_time: "09:00",
      appointment_end_time: "17:00",
      appointments_per_hour: 4,
      document_template_notes_enabled: false,
      document_template_letters_enabled: false,
      document_template_invoices_enabled: false,
    },
  });
  expect(settings.status()).toBe(200);

  const complete = await request.post(`${API_BASE_URL}/settings/clinic/onboarding/complete`, { headers });
  expect(complete.status()).toBe(200);
}

async function createStaffUser(request: APIRequestContext, token: string, identifier: string, password = PASSWORD) {
  const response = await request.post(`${API_BASE_URL}/users/staff`, {
    headers: authHeaders(token),
    data: { identifier, password },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string; identifier: string; role: "staff" }>;
}

async function listUsers(request: APIRequestContext, token: string) {
  const response = await request.get(`${API_BASE_URL}/users`, { headers: authHeaders(token) });
  expect(response.status()).toBe(200);
  return response.json() as Promise<Array<{ id: string; identifier: string; role: "admin" | "staff" }>>;
}

async function createCatalogItem(request: APIRequestContext, token: string) {
  const response = await request.post(`${API_BASE_URL}/catalog`, {
    headers: authHeaders(token),
    data: {
      name: "Live Paracetamol",
      item_type: "medicine",
      default_price: 75,
      track_inventory: true,
      stock_quantity: 2,
      low_stock_threshold: 1,
      unit: "strip",
      aliases: ["Paracetamol"],
    },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string; stock_quantity: number }>;
}

async function createPatient(request: APIRequestContext, token: string, name = "Live Follow-up Patient") {
  const response = await request.post(`${API_BASE_URL}/patients`, {
    headers: authHeaders(token),
    data: {
      name,
      phone: "5550105555",
      email: "followup.patient@example.com",
      address: "55 Follow Up Road",
      reason: "Follow-up setup",
      age: 37,
    },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string; name: string }>;
}

async function createFollowUp(request: APIRequestContext, token: string, patientId: string, scheduledFor: string) {
  const response = await request.post(`${API_BASE_URL}/patients/${patientId}/follow-ups`, {
    headers: authHeaders(token),
    data: {
      scheduled_for: scheduledFor,
      notes: "Review symptoms and medication response",
    },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string; scheduled_for: string; status: "scheduled" }>;
}

async function createInvoice(request: APIRequestContext, token: string, patientId: string) {
  const response = await request.post(`${API_BASE_URL}/invoices`, {
    headers: authHeaders(token),
    data: {
      patient_id: patientId,
      payment_status: "paid",
      items: [
        {
          item_type: "service",
          label: "Export Consultation",
          quantity: 1,
          unit_price: 425,
        },
      ],
    },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string; total: number }>;
}

async function finalizeInvoice(request: APIRequestContext, token: string, invoiceId: string) {
  const response = await request.post(`${API_BASE_URL}/invoices/finalize`, {
    headers: authHeaders(token),
    data: { invoice_id: invoiceId },
  });
  expect(response.status()).toBe(200);
}

async function createFollowUpBookingToken(
  request: APIRequestContext,
  orgId: string,
  patientId: string,
  followUpId: string,
) {
  const response = await request.post(`${API_BASE_URL}/__e2e/follow-up-booking-token`, {
    data: {
      org_id: orgId,
      patient_id: patientId,
      follow_up_id: followUpId,
    },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { token: string }).token;
}

async function signIn(page: Page, identifier: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email or phone number").fill(identifier);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function downloadedText(downloadPromise: Promise<import("@playwright/test").Download>) {
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  return {
    filename: download.suggestedFilename(),
    text: await readFile(path!, "utf8"),
  };
}

test.beforeEach(async ({ request }) => {
  const reset = await request.post(`${API_BASE_URL}/__e2e/reset`);
  expect(reset.ok()).toBeTruthy();
});

test("registration in the browser reaches clinic onboarding", async ({ page }) => {
  const label = unique("browser-register");
  const identifier = `${label}@clinic.test`;

  await page.goto("/login");
  await page.getByRole("button", { name: "Create account" }).click();

  await page.getByLabel("Admin name").fill("Dr. Browser Register");
  await page.getByLabel("Clinic name").fill("Browser Registration Clinic");
  await page.getByLabel("Clinic phone").fill("5550102222");
  await page.getByLabel("Clinic address").fill("44 Registration Road");
  await page.getByLabel("Doctor name for letters and PDFs").fill("Dr. Browser Register");
  await page.getByRole("button", { name: "Continue to account setup" }).click();

  await page.getByLabel("Username, email, or phone number").fill(identifier);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create admin account" }).click();

  await expect(page).toHaveURL(/\/onboarding\/setup/);
  await expect(page.getByRole("heading", { name: "Specialty" })).toBeVisible();
});

test("live workspace flow signs in, adds a patient, generates a note, and moves to billing", async ({ page, request }) => {
  const session = await registerClinic(request, unique("browser-workspace"));
  await completeOnboarding(request, session.token);
  const catalogItem = await createCatalogItem(request, session.token);

  await signIn(page, session.identifier, session.password);

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("button", { name: "Add Patient" })).toBeVisible();

  await page.getByRole("button", { name: "Add Patient" }).click();
  await page.getByLabel("Name").fill("Live Patient");
  await page.getByLabel("Phone").fill("5550103333");
  await page.getByLabel("Email").fill("live.patient@example.com");
  await page.getByLabel("Reason for Visit").fill("Headache");
  await page.getByLabel("Weight").fill("70");
  await page.getByLabel("Height").fill("170");
  await page.getByLabel("Temperature").fill("98.6");
  await page.getByRole("button", { name: "Add to Queue" }).click();

  await page.getByRole("button", { name: "Open chart for Live Patient" }).click();
  await page.getByRole("button", { name: "Start consultation" }).click();
  await expect(page.getByRole("complementary").getByText("Consultation", { exact: true })).toBeVisible();

  await page.getByLabel("Symptoms").fill("Headache for three days");
  await page.getByLabel("Diagnosis").fill("Tension headache");
  await page.getByLabel("Medications").fill("Paracetamol");
  await page.getByLabel("Clinical Notes").fill("Hydration and rest advised.");
  await page.getByRole("button", { name: "Generate Note" }).click();

  await expect(page.getByText("Presenting Complaint")).toBeVisible();
  await page.getByRole("button", { name: "Finalize Note" }).click();
  await expect(page.getByRole("button", { name: "Done" })).toBeEnabled();
  await page.getByRole("button", { name: "Done" }).click();

  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Billing queue" }).getByText("Live Patient", { exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Billing" }).click();
  await expect(page.getByRole("heading", { name: "Invoice Items for Live Patient" })).toBeVisible();
  await page.getByRole("button", { name: "Add Live Paracetamol" }).click();
  await expect(page.getByText("Live Paracetamol").first()).toBeVisible();
  await page.getByRole("button", { name: "Create Invoice" }).click();
  await expect(page.getByText("Invoice Created")).toBeVisible();
  await expect(page.getByRole("row", { name: /Live Patient.*Paid.*75\.00/ })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("row", { name: /Live Patient.*Paid.*75\.00/ })).toBeVisible();

  const catalog = await request.get(`${API_BASE_URL}/catalog`, { headers: authHeaders(session.token) });
  expect(catalog.status()).toBe(200);
  const items = await catalog.json() as Array<{ id: string; stock_quantity: number }>;
  expect(items.find((item) => item.id === catalogItem.id)?.stock_quantity).toBe(1);
});

test("staff browser sessions can use the queue but are kept out of admin billing", async ({ page, request }) => {
  const session = await registerClinic(request, unique("staff-boundary"));
  await completeOnboarding(request, session.token);
  const staffIdentifier = `${unique("staff")}@clinic.test`;
  await createStaffUser(request, session.token, staffIdentifier);

  await signIn(page, staffIdentifier);

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("button", { name: "Add Patient" })).toBeVisible();

  await page.goto("/billing");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Waiting" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Invoice Items" })).toHaveCount(0);
});

test("live appointments can be created and checked into the queue from the browser", async ({ page, request }) => {
  const session = await registerClinic(request, unique("appointments"));
  await completeOnboarding(request, session.token);

  await signIn(page, session.identifier, session.password);

  await page.getByRole("link", { name: "Appointments" }).click();
  await expect(page.getByRole("button", { name: "Add appointment" })).toBeVisible();
  await page.getByRole("button", { name: "Add appointment" }).click();
  const createPanel = page.locator("div").filter({ hasText: /^Add appointment$/ }).locator("..");
  await createPanel.getByPlaceholder("Patient name").fill("Scheduled Patient");
  await createPanel.getByRole("textbox", { name: "Phone", exact: true }).fill("5550104444");
  await createPanel.getByPlaceholder("Reason").fill("Scheduled review");
  await createPanel.locator('input[type="date"]').fill(futureIsoDate());
  await createPanel.locator('input[type="time"]').fill("09:30");
  await createPanel.getByRole("button", { name: "Add appointment" }).click();

  await expect(page.getByText("Appointment added.")).toBeVisible();
  const appointmentRow = page.getByRole("button", { name: /Scheduled Patient.*Scheduled review.*scheduled/ });
  await expect(appointmentRow).toBeVisible();
  await appointmentRow.click();
  await page.getByRole("button", { name: "Move to Queue" }).click();

  await expect(page.getByText("Appointment added to the waiting queue.")).toBeVisible();
  await page.getByRole("link", { name: "Queue" }).click();
  await expect(
    page.getByRole("region", { name: "Waiting queue" }).getByText("Scheduled Patient", { exact: true }),
  ).toBeVisible();
});

test("public follow-up booking confirms through the live backend", async ({ page, request }) => {
  const session = await registerClinic(request, unique("public-follow-up"));
  await completeOnboarding(request, session.token);
  const patient = await createPatient(request, session.token);
  const followUp = await createFollowUp(request, session.token, patient.id, futureClinicHourIso(2, 5));
  const bookingToken = await createFollowUpBookingToken(
    request,
    session.user.org_id,
    patient.id,
    followUp.id,
  );

  await page.goto(`/follow-up?token=${encodeURIComponent(bookingToken)}`);

  await expect(page.getByRole("heading", { name: "Confirm or reschedule your review" })).toBeVisible();
  await expect(page.getByText("Live E2E Clinic")).toBeVisible();
  await expect(page.getByText(patient.name)).toBeVisible();
  await page.getByRole("button", { name: /Confirm follow-up/ }).click();
  await expect(page.getByText("Follow-up confirmed. The clinic schedule has been updated.")).toBeVisible();

  const selectedDateTime = await page.getByLabel("Choose follow-up time").inputValue();
  const followUps = await request.get(`${API_BASE_URL}/follow-ups?scheduled_date=${selectedDateTime.slice(0, 10)}`, {
    headers: authHeaders(session.token),
  });
  expect(followUps.status()).toBe(200);
  const rows = await followUps.json() as Array<{ id: string; status: string }>;
  expect(rows.find((row) => row.id === followUp.id)?.status).toBe("completed");

  const appointments = await request.get(`${API_BASE_URL}/appointments?scheduled_date=${selectedDateTime.slice(0, 10)}`, {
    headers: authHeaders(session.token),
  });
  expect(appointments.status()).toBe(200);
  const appointmentRows = await appointments.json() as Array<{ name: string; reason: string }>;
  expect(appointmentRows.some((row) => row.name === patient.name && row.reason.includes("Follow-up"))).toBe(true);
});

test("live CSV export downloads include clinic data", async ({ page, request }) => {
  const session = await registerClinic(request, unique("exports-browser"));
  await completeOnboarding(request, session.token);
  const patient = await createPatient(request, session.token, "CSV Export Patient");
  const invoice = await createInvoice(request, session.token, patient.id);
  await finalizeInvoice(request, session.token, invoice.id);

  await signIn(page, session.identifier, session.password);

  await page.getByRole("link", { name: "Patients" }).click();
  await expect(page.getByText("CSV Export Patient")).toBeVisible();
  const patientsDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export patients" }).click();
  const patientsCsv = await downloadedText(patientsDownload);
  expect(patientsCsv.filename).toBe("patients.csv");
  expect(patientsCsv.text).toContain("CSV Export Patient");
  expect(patientsCsv.text).toContain("5550105555");

  await page.getByRole("link", { name: "History" }).click();
  await expect(page.getByText("CSV Export Patient")).toBeVisible();
  const visitsDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export visits" }).click();
  await page.getByRole("button", { name: "All time" }).click();
  const visitsCsv = await downloadedText(visitsDownload);
  expect(visitsCsv.filename).toBe("visits.csv");
  expect(visitsCsv.text).toContain("CSV Export Patient");
  expect(visitsCsv.text).toContain("Follow-up setup");

  await page.getByRole("link", { name: "Earnings" }).click();
  await expect(page.getByText("CSV Export Patient")).toBeVisible();
  const invoicesDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export invoices" }).click();
  const invoicesCsv = await downloadedText(invoicesDownload);
  expect(invoicesCsv.filename).toBe("invoices.csv");
  expect(invoicesCsv.text).toContain("CSV Export Patient");
  expect(invoicesCsv.text).toContain("425");
});

test("live patient chart attachments upload and open from the browser", async ({ page, request }) => {
  const session = await registerClinic(request, unique("attachments-browser"));
  await completeOnboarding(request, session.token);
  const patient = await createPatient(request, session.token, "Attachment Patient");

  await signIn(page, session.identifier, session.password);

  await page.getByRole("link", { name: "Patients" }).click();
  await expect(page.getByText("1 Patients")).toBeVisible();
  const patientRow = page.getByRole("row", { name: /Attachment Patient.*5550105555.*Follow-up setup/ });
  await expect(patientRow).toBeVisible();
  await patientRow.click();
  await expect(page.getByText("Patient Chart", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Visits" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Visit 1/ })).toBeVisible();

  await page.getByRole("button", { name: "Attachments" }).click();
  const attachmentsPanel = page.locator("section").filter({ hasText: /^Attachments/ });
  await expect(attachmentsPanel.getByText("No attachments yet.")).toBeVisible();
  await attachmentsPanel.locator('input[type="file"]').setInputFiles({
    name: "chart-scan.png",
    mimeType: "image/png",
    buffer: attachmentPng,
  });

  await expect(attachmentsPanel.getByRole("button", { name: /chart-scan\.png/ })).toBeVisible();
  const popupPromise = page.waitForEvent("popup");
  await attachmentsPanel.getByRole("button", { name: /chart-scan\.png/ }).click();
  const viewer = await popupPromise;
  await expect(viewer.getByAltText("Attachment")).toBeVisible();
  await viewer.close();

  const attachments = await request.get(`${API_BASE_URL}/patients/${patient.id}/attachments`, {
    headers: authHeaders(session.token),
  });
  expect(attachments.status()).toBe(200);
  const rows = await attachments.json() as Array<{ id: string; file_name: string }>;
  const uploaded = rows.find((row) => row.file_name === "chart-scan.png");
  expect(uploaded?.id).toBeTruthy();

  const downloaded = await request.get(`${API_BASE_URL}/attachments/${uploaded!.id}/file`, {
    headers: authHeaders(session.token),
  });
  expect(downloaded.status()).toBe(200);
  expect(downloaded.headers()["content-type"]).toContain("image/png");
});

test("live user management creates, promotes, and removes staff", async ({ page, request }) => {
  const session = await registerClinic(request, unique("users-browser"));
  await completeOnboarding(request, session.token);
  const staffIdentifier = `${unique("managed-staff")}@clinic.test`;

  await signIn(page, session.identifier, session.password);

  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Clinic Users" })).toBeVisible();
  await expect(page.getByText("1 total")).toBeVisible();
  await page.getByRole("button", { name: "Add User" }).click();
  await page.getByLabel("Email or phone number").fill(staffIdentifier);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create Staff User" }).click();

  await expect(page.getByText("Staff user added.")).toBeVisible();
  await expect(page.getByText(staffIdentifier)).toBeVisible();
  let users = await listUsers(request, session.token);
  let managedUser = users.find((user) => user.identifier === staffIdentifier);
  expect(managedUser?.role).toBe("staff");

  await page.getByRole("button", { name: new RegExp(staffIdentifier) }).click();
  await expect(page.getByLabel("Status")).toHaveValue("staff");
  await page.getByLabel("Status").selectOption("admin");
  await page.getByRole("button", { name: "Save Role" }).click();
  await expect(page.getByRole("button", { name: "Save Role" })).toBeDisabled();
  users = await listUsers(request, session.token);
  managedUser = users.find((user) => user.identifier === staffIdentifier);
  expect(managedUser?.role).toBe("admin");

  await page.getByRole("button", { name: "Remove User" }).click();
  await expect(page.getByText(staffIdentifier)).toHaveCount(0);
  users = await listUsers(request, session.token);
  expect(users.some((user) => user.identifier === staffIdentifier)).toBe(false);
});

test("live superdashboard shows ops metrics and manages onboarding CIDs", async ({ page, request }) => {
  const ops = await registerClinic(request, "ops-super");
  await completeOnboarding(request, ops.token);
  const managed = await registerClinic(request, unique("super-managed"));
  await completeOnboarding(request, managed.token);

  await signIn(page, ops.identifier, ops.password);
  await page.goto("/superdashboard");

  await expect(page.getByText("ClinicOS Ops")).toBeVisible();
  await expect(page.getByText("Requests (7d)")).toBeVisible();
  await expect(page.getByText("Organizations")).toBeVisible();
  await expect(page.getByText("Live E2E Clinic").first()).toBeVisible();

  await page.getByRole("button", { name: "Onboard" }).click();
  await expect(page.getByText("Pending", { exact: true })).toBeVisible();
  await page.getByLabel("Clinic name").fill("Browser CID Clinic");
  await page.getByLabel("Phone").fill("+91 98765 43210");
  await page.getByLabel("Users").fill("3");
  await page.getByRole("button", { name: "Team workflow" }).click();
  await page.getByRole("button", { name: /Create CID/ }).click();

  await expect(page.getByText(/CID-/)).toBeVisible();
  await expect(page.getByText("Browser CID Clinic")).toBeVisible();
  await expect(page.getByText("+919876543210")).toBeVisible();
  await page.getByRole("button", { name: "Disable" }).click();
  await expect(page.getByText("disabled")).toBeVisible();

  await page.getByRole("button", { name: "Errors" }).click();
  await expect(page.getByRole("heading", { name: "Platform errors" })).toBeVisible();
});
