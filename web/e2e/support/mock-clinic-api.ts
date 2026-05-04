import { Page, Route } from "@playwright/test";

const API_ORIGIN = "http://127.0.0.1:8001";
const DEFAULT_TOKEN = "playwright-session-token";
const DEFAULT_EXPIRY_SECONDS = Math.floor(Date.now() / 1000) + 60 * 60;

type UserRole = "admin" | "staff";
type ClinicSpecialty = "general_physician" | "optometry" | null;

export type MockAuthUser = {
  id: string;
  org_id: string;
  name: string;
  identifier: string;
  role: UserRole;
  doctor_dob?: string | null;
  doctor_address?: string;
  doctor_signature_name?: string | null;
  doctor_signature_url?: string | null;
  doctor_signature_content_type?: string | null;
  created_at: string;
};

export type MockClinicSettings = {
  id: string;
  org_id: string;
  clinic_name: string;
  clinic_address: string;
  clinic_phone: string;
  clinic_specialty: ClinicSpecialty;
  appointment_start_time: string;
  appointment_end_time: string;
  appointments_per_hour: number;
  doctor_name: string;
  sender_name: string;
  sender_email: string;
  email_configured: boolean;
  custom_header: string;
  custom_footer: string;
  document_template_name: string | null;
  document_template_url: string | null;
  document_template_notes_enabled: boolean;
  document_template_letters_enabled: boolean;
  document_template_invoices_enabled: boolean;
  document_template_margin_top: number;
  document_template_margin_right: number;
  document_template_margin_bottom: number;
  document_template_margin_left: number;
  updated_at: string | null;
};

export type MockPatient = {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  reason: string;
  age: number | null;
  weight: number | null;
  height: number | null;
  temperature: number | null;
  status: "waiting" | "consultation" | "done";
  billed: boolean;
  created_at: string;
  last_visit_at: string;
};

type MockCaseStudy = {
  id: string;
  org_id: string;
  patient_id: string;
  patient_name: string | null;
  title: string;
  status: "draft" | "final";
  template_key: "conference_presentation" | "teaching_rounds" | "hospital_case_discussion";
  anonymized: boolean;
  author_instructions: string;
  generated_content: string;
  source_snapshot: Record<string, unknown>;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type MockCaseStudySource = {
  patient: MockPatient;
  visits: Array<Record<string, unknown>>;
  timeline: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
  myopia_history: Record<string, unknown> | null;
};

function jsonHeaders() {
  return {
    "content-type": "application/json",
    "x-session-token": DEFAULT_TOKEN,
    "x-session-expires-at": String(DEFAULT_EXPIRY_SECONDS),
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

function nowIso() {
  return "2026-05-03T10:00:00.000Z";
}

export function buildUser(overrides: Partial<MockAuthUser> = {}): MockAuthUser {
  return {
    id: "user-admin-1",
    org_id: "org-1",
    name: "Dr. Rivera",
    identifier: "admin@clinic.test",
    role: "admin",
    doctor_dob: null,
    doctor_address: "",
    doctor_signature_name: null,
    doctor_signature_url: null,
    doctor_signature_content_type: null,
    created_at: nowIso(),
    ...overrides,
  };
}

export function buildClinicSettings(overrides: Partial<MockClinicSettings> = {}): MockClinicSettings {
  return {
    id: "settings-1",
    org_id: "org-1",
    clinic_name: "Bluebird Clinic",
    clinic_address: "1 Demo Street",
    clinic_phone: "5550102020",
    clinic_specialty: "general_physician",
    appointment_start_time: "09:00",
    appointment_end_time: "17:00",
    appointments_per_hour: 4,
    doctor_name: "Dr. Rivera",
    sender_name: "Bluebird Clinic",
    sender_email: "clinic@example.com",
    email_configured: true,
    custom_header: "",
    custom_footer: "",
    document_template_name: null,
    document_template_url: null,
    document_template_notes_enabled: false,
    document_template_letters_enabled: false,
    document_template_invoices_enabled: false,
    document_template_margin_top: 54,
    document_template_margin_right: 54,
    document_template_margin_bottom: 54,
    document_template_margin_left: 54,
    updated_at: nowIso(),
    ...overrides,
  };
}

export function buildPatient(overrides: Partial<MockPatient> = {}): MockPatient {
  return {
    id: "patient-1",
    name: "Jamie Carter",
    phone: "5550101111",
    email: "jamie@example.com",
    address: "22 Oak Avenue",
    reason: "Fever",
    age: 28,
    weight: 70,
    height: 172,
    temperature: 99.1,
    status: "waiting",
    billed: false,
    created_at: nowIso(),
    last_visit_at: nowIso(),
    ...overrides,
  };
}

export function buildCaseStudySource(patient: MockPatient): MockCaseStudySource {
  return {
    patient,
    visits: [
      {
        id: "visit-1",
        patient_id: patient.id,
        name: patient.name,
        phone: patient.phone,
        email: patient.email,
        address: patient.address,
        reason: patient.reason,
        age: patient.age,
        weight: patient.weight,
        height: patient.height,
        temperature: patient.temperature,
        source: "queue",
        appointment_id: null,
        created_at: nowIso(),
        status: patient.status,
        billed: patient.billed,
        last_visit_at: patient.last_visit_at,
      },
    ],
    timeline: [
      {
        id: "timeline-1",
        type: "visit_recorded",
        title: "Visit",
        timestamp: nowIso(),
        description: `${patient.reason} visit recorded.`,
      },
    ],
    notes: [
      {
        id: "note-1",
        patient_id: patient.id,
        content: "Clinical summary for case study source.",
        status: "final",
        version_number: 1,
        root_note_id: null,
        amended_from_note_id: null,
        snapshot_content: null,
        asset_payload: [],
        snapshot_asset_payload: [],
        finalized_at: nowIso(),
        sent_at: null,
        sent_by: null,
        sent_by_name: null,
        sent_to: null,
        created_at: nowIso(),
      },
    ],
    myopia_history: null,
  };
}

export async function seedSession(
  page: Page,
  options: {
    user?: MockAuthUser;
    token?: string;
    expiresAtMs?: number;
    specialtyOnboardingPending?: boolean;
  } = {},
) {
  const user = options.user ?? buildUser();
  const token = options.token ?? DEFAULT_TOKEN;
  const expiresAtMs = options.expiresAtMs ?? Date.now() + 60 * 60 * 1000;
  const specialtyOnboardingPending = options.specialtyOnboardingPending ?? false;

  await page.addInitScript(
    ({ sessionUser, sessionToken, sessionExpiry, onboardingPending }) => {
      window.localStorage.setItem("clinic_auth_token", sessionToken);
      window.localStorage.setItem("clinic_auth_user", JSON.stringify(sessionUser));
      window.localStorage.setItem("clinic_session_expires_at", String(sessionExpiry));
      if (onboardingPending) {
        window.localStorage.setItem("clinic_specialty_onboarding_pending", "1");
      } else {
        window.localStorage.removeItem("clinic_specialty_onboarding_pending");
      }
    },
    {
      sessionUser: user,
      sessionToken: token,
      sessionExpiry: expiresAtMs,
      onboardingPending: specialtyOnboardingPending,
    },
  );
}

export async function mockClinicBootstrap(
  page: Page,
  options: {
    user?: MockAuthUser;
    clinicSettings?: MockClinicSettings;
    patients?: MockPatient[];
    caseStudies?: MockCaseStudy[];
    caseStudySource?: MockCaseStudySource | null;
  } = {},
) {
  const user = options.user ?? buildUser();
  let clinicSettings = options.clinicSettings ?? buildClinicSettings();
  const patients = options.patients ?? [];
  const caseStudies = options.caseStudies ?? [];
  const caseStudySource = options.caseStudySource ?? (patients[0] ? buildCaseStudySource(patients[0]) : null);

  await page.route(`${API_ORIGIN}/auth/me`, async (route) => {
    await fulfillJson(route, user);
  });
  await page.route(`${API_ORIGIN}/settings/clinic`, async (route) => {
    if (route.request().method() === "PUT") {
      const payload = JSON.parse(route.request().postData() || "{}");
      clinicSettings = { ...clinicSettings, ...payload };
      await fulfillJson(route, clinicSettings);
      return;
    }
    await fulfillJson(route, clinicSettings);
  });
  await page.route(`${API_ORIGIN}/patients`, async (route) => {
    await fulfillJson(route, patients);
  });
  await page.route(new RegExp(`${API_ORIGIN}/patients/[^/]+$`), async (route) => {
    if (route.request().method() === "PATCH") {
      const patientId = route.request().url().split("/").pop() || "";
      const payload = JSON.parse(route.request().postData() || "{}");
      const patient = patients.find((entry) => entry.id === patientId);
      if (!patient) {
        await route.fulfill({ status: 404, body: JSON.stringify({ detail: "Patient not found." }) });
        return;
      }
      Object.assign(patient, payload, { last_visit_at: nowIso() });
      await fulfillJson(route, patient);
      return;
    }
    await route.fallback();
  });
  await page.route(new RegExp(`${API_ORIGIN}/patients/[^/]+/timeline$`), async (route) => {
    const patientId = route.request().url().split("/").slice(-2)[0] || "";
    const patient = patients.find((entry) => entry.id === patientId) ?? buildPatient({ id: patientId });
    await fulfillJson(route, [
      {
        id: "visit-evt-1",
        type: "visit_recorded",
        title: "Visit recorded",
        timestamp: nowIso(),
        description: `${patient.reason} visit recorded.`,
        details: {
          reason: patient.reason,
          source: "queue",
          age: patient.age,
          weight: patient.weight,
          height: patient.height,
          temperature: patient.temperature,
        },
      },
    ]);
  });
  await page.route(new RegExp(`${API_ORIGIN}/patients/[^/]+/myopia-history$`), async (route) => {
    const patientId = route.request().url().split("/").slice(-2)[0] || "";
    await fulfillJson(route, {
      patient_id: patientId,
      records: [],
      baseline_delta: null,
      last_delta: null,
      annualized_growth: null,
      overlay_version: "clinic-reference-v1",
    });
  });
  await page.route(`${API_ORIGIN}/users`, async (route) => {
    await fulfillJson(route, [user]);
  });
  await page.route(`${API_ORIGIN}/audit-events*`, async (route) => {
    await fulfillJson(route, []);
  });
  await page.route(`${API_ORIGIN}/catalog`, async (route) => {
    await fulfillJson(route, []);
  });
  await page.route(`${API_ORIGIN}/appointments*`, async (route) => {
    await fulfillJson(route, []);
  });
  await page.route(`${API_ORIGIN}/follow-ups*`, async (route) => {
    await fulfillJson(route, []);
  });
  await page.route(`${API_ORIGIN}/case-studies`, async (route) => {
    if (route.request().method() === "POST") {
      const payload = JSON.parse(route.request().postData() || "{}");
      const created: MockCaseStudy = {
        id: "case-study-1",
        org_id: user.org_id,
        patient_id: payload.patient_id,
        patient_name: patients.find((patient) => patient.id === payload.patient_id)?.name ?? null,
        title: payload.title,
        status: payload.status,
        template_key: payload.template_key,
        anonymized: payload.anonymized,
        author_instructions: payload.author_instructions,
        generated_content: payload.generated_content,
        source_snapshot: payload.source_snapshot ?? {},
        created_by: user.id,
        created_by_name: user.name,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      caseStudies.unshift(created);
      await fulfillJson(route, created, 201);
      return;
    }
    await fulfillJson(route, caseStudies);
  });
  await page.route(new RegExp(`${API_ORIGIN}/patients/[^/]+/case-study-source$`), async (route) => {
    await fulfillJson(route, caseStudySource ?? buildCaseStudySource(patients[0] ?? buildPatient()));
  });
  await page.route(`${API_ORIGIN}/generate-case-study`, async (route) => {
    const payload = JSON.parse(route.request().postData() || "{}");
    await fulfillJson(route, {
      title: payload.title || "Generated Case Study",
      content: "Generated case study content.\n\nAssessment and management summary.",
      source: caseStudySource ?? buildCaseStudySource(patients[0] ?? buildPatient()),
    });
  });
}

export async function mockLoginFlow(
  page: Page,
  options: {
    user?: MockAuthUser;
    clinicSettings?: MockClinicSettings;
    patients?: MockPatient[];
  } = {},
) {
  const user = options.user ?? buildUser();
  const clinicSettings = options.clinicSettings ?? buildClinicSettings();
  const patients = options.patients ?? [];
  let isLoggedIn = false;

  await page.route(`${API_ORIGIN}/auth/login`, async (route) => {
    isLoggedIn = true;
    await fulfillJson(route, {
      token: DEFAULT_TOKEN,
      user,
    });
  });

  await page.route(`${API_ORIGIN}/auth/me`, async (route) => {
    if (!isLoggedIn) {
      await route.fulfill({
        status: 401,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ detail: "Authentication required." }),
      });
      return;
    }
    await fulfillJson(route, user);
  });

  await page.route(`${API_ORIGIN}/settings/clinic`, async (route) => {
    await fulfillJson(route, clinicSettings);
  });
  await page.route(`${API_ORIGIN}/patients`, async (route) => {
    await fulfillJson(route, patients);
  });
  await page.route(`${API_ORIGIN}/audit-events*`, async (route) => {
    await fulfillJson(route, []);
  });
  await page.route(`${API_ORIGIN}/catalog`, async (route) => {
    await fulfillJson(route, []);
  });
}

export async function mockQueueIntake(page: Page, initialPatients: MockPatient[] = []) {
  const patients = [...initialPatients];

  await page.route(`${API_ORIGIN}/patients/lookup*`, async (route) => {
    await fulfillJson(route, []);
  });

  await page.route(`${API_ORIGIN}/patients`, async (route) => {
    if (route.request().method() === "POST") {
      const payload = JSON.parse(route.request().postData() || "{}");
      const created = buildPatient({
        id: `patient-${patients.length + 1}`,
        name: payload.name,
        phone: payload.phone,
        email: payload.email,
        address: payload.address,
        reason: payload.reason,
        age: payload.age,
        weight: payload.weight,
        height: payload.height,
        temperature: payload.temperature,
      });
      patients.unshift(created);
      await fulfillJson(route, created, 201);
      return;
    }
    await fulfillJson(route, patients);
  });
}

export async function mockConsultationFlow(page: Page) {
  let noteCounter = 1;

  await page.route(`${API_ORIGIN}/generate-note`, async (route) => {
    const payload = JSON.parse(route.request().postData() || "{}");
    const diagnosis = payload.diagnosis || "Assessment";
    const symptoms = payload.symptoms || "Symptoms";
    await fulfillJson(route, {
      note_id: `note-${noteCounter++}`,
      status: "final",
      content: `Assessment: ${diagnosis}\nPresenting Complaint: ${symptoms}\nPlan: Hydration and observation.`,
    });
  });

  await page.route(`${API_ORIGIN}/send-note`, async (route) => {
    await fulfillJson(route, {
      success: true,
      message: "Consultation note sent.",
    });
  });
}

export async function mockPublicFollowUpBooking(page: Page) {
  let scheduledFor = "2026-05-20T14:00:00.000Z";

  await page.route(`${API_ORIGIN}/public/follow-up-booking?token=valid-token`, async (route) => {
    await fulfillJson(route, {
      follow_up_id: "follow-up-1",
      patient_name: "Jamie Carter",
      clinic_name: "Bluebird Clinic",
      scheduled_for: scheduledFor,
      notes: "Review symptoms and blood pressure",
      booking_token: "valid-token",
      suggested_slots: [
        "2026-05-20T14:30:00.000Z",
        "2026-05-20T15:00:00.000Z",
      ],
    });
  });

  await page.route(`${API_ORIGIN}/public/follow-up-booking`, async (route) => {
    const payload = JSON.parse(route.request().postData() || "{}");
    scheduledFor = payload.scheduled_for;
    await fulfillJson(route, { success: true, scheduled_for: scheduledFor });
  });
}
