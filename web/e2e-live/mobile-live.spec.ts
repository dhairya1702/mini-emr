import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API_BASE_URL = "http://127.0.0.1:8014";
const PASSWORD = "password123!";

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Cookie: `clinic_session=${token}`,
  };
}

async function registerClinic(request: APIRequestContext, label = unique("mobile-live")) {
  const identifier = `${label}@clinic.test`;
  const response = await request.post(`${API_BASE_URL}/auth/register`, {
    data: {
      identifier,
      password: PASSWORD,
      admin_name: "Dr. Mobile E2E",
      clinic_name: `Mobile E2E ${label}`,
      clinic_address: "123 Phone Street",
      clinic_phone: "5550100000",
      doctor_name: "Dr. Mobile E2E",
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
      clinic_name: "Mobile Live Clinic",
      clinic_address: "123 Phone Street",
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

async function signInMobile(page: Page, identifier: string, password: string) {
  await page.goto("/login?surface=mobile");
  await page.getByLabel("Email or phone number").fill(identifier);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/m$/);
}

test("mobile live queue, consultation, and chart flow works end to end", async ({ page, request }) => {
  const session = await registerClinic(request);
  await completeOnboarding(request, session.token);
  const patientName = `Mobile Patient ${unique("flow")}`;

  await signInMobile(page, session.identifier, session.password);
  await expect(page.getByRole("heading", { name: "Waiting" })).toBeVisible();
  await page.getByRole("button", { name: "Add patient" }).click();
  await expect(page.getByRole("heading", { name: "Add patient" })).toBeVisible();
  await page.getByLabel("Name").fill(patientName);
  await page.getByLabel("Phone").fill("5550198765");
  await page.getByLabel("Reason").fill("Mobile cough follow up");
  await page.getByLabel("Temp").fill("99.1");
  await page.getByLabel("Height").fill("171");
  await page.getByLabel("Weight").fill("68");
  await page.getByRole("button", { name: "Add to queue" }).click();

  await expect(page.getByRole("link", { name: `Open ${patientName}` })).toBeVisible();
  await page.getByRole("link", { name: `Open ${patientName}` }).click();
  await expect(page.getByRole("heading", { name: patientName })).toBeVisible();

  await page.getByLabel("Complaint").fill("Cough for three days with throat irritation.");
  await page.getByLabel("Diagnosis").fill("Upper respiratory tract infection.");
  await page.getByLabel("Treatment").fill("Warm fluids and paracetamol if fever.");
  await page.getByLabel("Clinical notes").fill("No respiratory distress. Review if symptoms worsen.");
  await page.getByRole("button", { name: "Generate draft" }).click();
  await expect(page.getByText(/Draft (saved|generated)\./)).toBeVisible();
  await expect(page.getByText("Draft note")).toBeVisible();
  await page.getByRole("button", { name: "Finalize" }).click();

  await expect(page).toHaveURL(/\/m$/);
  await expect(page.getByRole("link", { name: `Open ${patientName}` })).toHaveCount(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Patients" }).click();
  await page.getByPlaceholder("Search patients").fill(patientName);
  await expect(page.getByText(patientName)).toBeVisible();
  await page.getByText(patientName).click();
  await expect(page.getByText("Patient chart")).toBeVisible();
  await expect(page.getByRole("button", { name: "Visit 1" })).toBeVisible();
  await page.getByRole("button", { name: "Consultation note" }).click();
  await expect(page.getByText(/Presenting Complaint:\s*Cough for three days/).nth(1)).toBeVisible();
});
