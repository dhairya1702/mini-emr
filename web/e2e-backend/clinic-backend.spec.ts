import { expect, test, type APIRequestContext } from "@playwright/test";

const expectedReadyStatus = Number(process.env.E2E_EXPECT_HEALTH_READY_STATUS ?? "503");

const signaturePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAAAwCAIAAABVDSmEAAABYElEQVR4nO2a0Q6CMAxFrfH/fxkfMAshyjZoTze858HERKE7dJc5tGVZHiKeZ3YB/4JEQ0g0hERDSDSERENINIREQ0g0hERDjCXazMrrzXhlF/BhJ3d9e6d9GEsfTLV/0yt0ITM6zKwlJaZIkmqROdHxq6zSvBMlSWMfoNFxUNPXMr5+fijduwoPaoNE9yqufjFdd28ThIs+rbjlICm6z82zQNHudtKT5EoBIaJDGzBL98XzOovG5jip2+VcbqL5GAXO6Hg5HUTn3qmCWtv9sJdEj7MY8PUScfHOiHZZsUVwXVBc9PeJHlZx4fQki767tooeX/GWLt3MAqYuepwg7qXFILZMPBI9r+Itv1TCP3z6RM+leEv644VKdJT65lVcyJ2g9Y3/GyheWQfSvoPsS/4zwxTM6IGP9XcDDL69/lQ0j0RDSDSERENINIREQ0g0hERDSDSERENINIREQ0g0xBvJMd4tNZlglAAAAABJRU5ErkJggg==",
  "base64",
);

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function superdashboardAuthHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Cookie: `superdashboard_session=${token}`,
  };
}

async function registerClinic(request: APIRequestContext, label = unique("clinic")) {
  const identifier = `${label}@clinic.test`;
  const response = await request.post("/auth/register", {
    data: {
      identifier,
      email: identifier,
      phone: "5550100000",
      password: "password123!",
      admin_name: "Dr. Backend E2E",
      clinic_name: `Backend E2E ${label}`,
      clinic_address: "123 Test Street",
      clinic_phone: "5550100000",
      doctor_name: "Dr. Backend E2E",
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.token).toBeTruthy();
  expect(body.user.identifier).toBe(identifier);
  return { ...body, identifier, password: "password123!" };
}

async function createPatient(request: APIRequestContext, token: string, overrides: Record<string, unknown> = {}) {
  const response = await request.post("/patients", {
    headers: authHeaders(token),
    data: {
      name: "Backend Patient",
      phone: "5550101010",
      email: "patient@example.com",
      address: "456 Patient Road",
      reason: "Review visit",
      age: 31,
      weight: 70,
      height: 170,
      temperature: 98.6,
      ...overrides,
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

test.beforeEach(async ({ request }) => {
  const reset = await request.post("/__e2e/reset");
  expect(reset.ok()).toBeTruthy();
});

test("auth lifecycle registers, logs in, reads current user, and revokes sessions on logout", async ({ request }) => {
  const session = await registerClinic(request, unique("auth"));

  const me = await request.get("/auth/me", { headers: authHeaders(session.token) });
  expect(me.status()).toBe(200);
  expect((await me.json()).identifier).toBe(session.identifier);
  expect(me.headers()["x-session-token"]).toBeTruthy();

  const login = await request.post("/auth/login", {
    data: { identifier: session.identifier, password: session.password },
  });
  expect(login.status()).toBe(200);
  const loginBody = await login.json();
  expect(loginBody.user.identifier).toBe(session.identifier);

  const logout = await request.post("/auth/logout", { headers: authHeaders(loginBody.token) });
  expect(logout.status()).toBe(204);

  const revoked = await request.get("/auth/me", { headers: authHeaders(loginBody.token) });
  expect(revoked.status()).toBe(401);
});

test("settings and signature upload persist through real backend routes", async ({ request }) => {
  const session = await registerClinic(request, unique("settings"));
  const headers = authHeaders(session.token);

  const updateSettings = await request.put("/settings/clinic", {
    headers,
    data: {
      clinic_name: "Backend Verified Clinic",
      clinic_address: "789 Settings Lane",
      clinic_phone: "5550109090",
      clinic_specialty: "optometry",
      timezone: "Asia/Kolkata",
      appointment_start_time: "09:30",
      appointment_end_time: "18:30",
      appointments_per_hour: 3,
      sender_name: "Backend Clinic",
      sender_email: "clinic@example.com",
      custom_header: "Header",
      custom_footer: "Footer",
      document_template_notes_enabled: false,
      document_template_letters_enabled: false,
      document_template_invoices_enabled: false,
    },
  });
  expect(updateSettings.status()).toBe(200);
  const settings = await updateSettings.json();
  expect(settings.clinic_name).toBe("Backend Verified Clinic");
  expect(settings.clinic_specialty).toBe("optometry");

  const signatureUpload = await request.post("/auth/me/signature", {
    headers,
    multipart: {
      file: {
        name: "signature.png",
        mimeType: "image/png",
        buffer: signaturePng,
      },
    },
  });
  expect(signatureUpload.status()).toBe(200);
  expect((await signatureUpload.json()).doctor_signature_url).toContain("/signature/file");

  const signatureDownload = await request.get("/auth/me/signature/file", { headers });
  expect(signatureDownload.status()).toBe(200);
  expect(signatureDownload.headers()["content-type"]).toContain("image/png");

  const templateUpload = await request.post("/settings/clinic/document-template", {
    headers,
    multipart: {
      file: {
        name: "letterhead.png",
        mimeType: "image/png",
        buffer: signaturePng,
      },
    },
  });
  expect(templateUpload.status()).toBe(200);
  expect((await templateUpload.json()).document_template_url).toBe("/settings/clinic/document-template/file");
});

test("patient attachment, note, invoice, and PDF routes work together", async ({ request }) => {
  const session = await registerClinic(request, unique("clinical"));
  const headers = authHeaders(session.token);
  const patient = await createPatient(request, session.token, { name: "Clinical Backend Patient" });

  const attachmentUpload = await request.post(`/patients/${patient.id}/attachments`, {
    headers,
    multipart: {
      file: {
        name: "scan.png",
        mimeType: "image/png",
        buffer: signaturePng,
      },
    },
  });
  expect(attachmentUpload.status()).toBe(201);
  const attachment = await attachmentUpload.json();
  expect(attachment.file_name).toBe("scan.png");

  const attachments = await request.get(`/patients/${patient.id}/attachments`, { headers });
  expect(attachments.status()).toBe(200);
  expect((await attachments.json()).map((row: { id: string }) => row.id)).toContain(attachment.id);

  const attachmentDownload = await request.get(`/attachments/${attachment.id}/file`, { headers });
  expect(attachmentDownload.status()).toBe(200);
  expect(attachmentDownload.headers()["content-type"]).toContain("image/png");

  const noteResponse = await request.post("/generate-note", {
    headers,
    data: {
      patient_id: patient.id,
      symptoms: "Headache for three days",
      diagnosis: "Tension headache",
      medications: "Paracetamol",
      notes: "Hydration and rest advised.",
    },
  });
  expect(noteResponse.status()).toBe(200);
  const note = await noteResponse.json();
  expect(note.note_id).toBeTruthy();
  expect(note.content).toContain("Presenting Complaint");

  const finalized = await request.post("/notes/finalize", {
    headers,
    data: { note_id: note.note_id },
  });
  expect(finalized.status()).toBe(200);

  const notePdf = await request.get(`/notes/${note.note_id}/pdf`, { headers });
  expect(notePdf.status()).toBe(200);
  expect(notePdf.headers()["content-type"]).toContain("application/pdf");

  const invoiceResponse = await request.post("/invoices", {
    headers,
    data: {
      patient_id: patient.id,
      payment_status: "paid",
      items: [
        {
          item_type: "service",
          label: "Consultation",
          quantity: 1,
          unit_price: 500,
        },
      ],
    },
  });
  expect(invoiceResponse.status()).toBe(201);
  const invoice = await invoiceResponse.json();
  expect(invoice.total).toBe(500);

  const finalizeInvoice = await request.post("/invoices/finalize", {
    headers,
    data: { invoice_id: invoice.id },
  });
  expect(finalizeInvoice.status()).toBe(200);
  expect((await finalizeInvoice.json()).success).toBe(true);

  const invoicePdf = await request.get(`/invoices/${invoice.id}/pdf`, { headers });
  expect(invoicePdf.status()).toBe(200);
  expect(invoicePdf.headers()["content-type"]).toContain("application/pdf");
});

test("tenant boundaries reject cross-organization patient and attachment access", async ({ request }) => {
  const first = await registerClinic(request, unique("tenant-a"));
  const second = await registerClinic(request, unique("tenant-b"));
  const firstPatient = await createPatient(request, first.token, { name: "Tenant A Patient" });

  const firstPatients = await request.get("/patients", { headers: authHeaders(first.token) });
  expect(firstPatients.status()).toBe(200);
  expect((await firstPatients.json()).items.map((patient: { name: string }) => patient.name)).toContain("Tenant A Patient");

  const secondPatients = await request.get("/patients", { headers: authHeaders(second.token) });
  expect(secondPatients.status()).toBe(200);
  expect((await secondPatients.json()).items.map((patient: { name: string }) => patient.name)).not.toContain("Tenant A Patient");

  const foreignPatientRead = await request.get(`/patients/${firstPatient.id}`, {
    headers: authHeaders(second.token),
  });
  expect(foreignPatientRead.status()).toBe(400);

  const attachmentUpload = await request.post(`/patients/${firstPatient.id}/attachments`, {
    headers: authHeaders(first.token),
    multipart: {
      file: {
        name: "tenant-scan.png",
        mimeType: "image/png",
        buffer: signaturePng,
      },
    },
  });
  expect(attachmentUpload.status()).toBe(201);
  const attachment = await attachmentUpload.json();

  const foreignAttachmentDownload = await request.get(`/attachments/${attachment.id}/file`, {
    headers: authHeaders(second.token),
  });
  expect(foreignAttachmentDownload.status()).toBe(400);
});

test("admin user management enforces staff permissions and supports role changes", async ({ request }) => {
  const session = await registerClinic(request, unique("users"));
  const headers = authHeaders(session.token);

  const createStaff = await request.post("/users/staff", {
    headers,
    data: {
      identifier: "staff-e2e@clinic.test",
      email: "staff-e2e@clinic.test",
      phone: "5550103000",
      password: "password123!",
    },
  });
  expect(createStaff.status()).toBe(201);
  const staff = await createStaff.json();
  expect(staff.role).toBe("staff");

  const staffLogin = await request.post("/auth/login", {
    data: { identifier: "staff-e2e@clinic.test", password: "password123!" },
  });
  expect(staffLogin.status()).toBe(200);
  const staffToken = (await staffLogin.json()).token;

  const forbiddenCatalog = await request.get("/catalog", { headers: authHeaders(staffToken) });
  expect(forbiddenCatalog.status()).toBe(403);

  const promote = await request.patch(`/users/${staff.id}`, {
    headers,
    data: { role: "admin" },
  });
  expect(promote.status()).toBe(200);
  expect((await promote.json()).role).toBe("admin");

  const deleteStaff = await request.delete(`/users/${staff.id}`, { headers });
  expect(deleteStaff.status()).toBe(204);

  const users = await request.get("/users", { headers });
  expect(users.status()).toBe(200);
  expect((await users.json()).map((user: { identifier: string }) => user.identifier)).not.toContain("staff-e2e@clinic.test");
});

test("catalog stock and invoice finalization cover inventory-backed billing", async ({ request }) => {
  const session = await registerClinic(request, unique("catalog"));
  const headers = authHeaders(session.token);
  const patient = await createPatient(request, session.token, { name: "Inventory Billing Patient" });

  const createItem = await request.post("/catalog", {
    headers,
    data: {
      name: "Trial lens",
      item_type: "medicine",
      default_price: 125,
      track_inventory: true,
      stock_quantity: 10,
      low_stock_threshold: 2,
      unit: "pc",
      aliases: ["lens"],
    },
  });
  expect(createItem.status()).toBe(201);
  const item = await createItem.json();
  expect(item.stock_quantity).toBe(10);

  const stockUpdate = await request.patch(`/catalog/${item.id}/stock`, {
    headers,
    data: { delta: 5 },
  });
  expect(stockUpdate.status()).toBe(200);
  expect((await stockUpdate.json()).stock_quantity).toBe(15);

  const invoiceResponse = await request.post("/invoices", {
    headers,
    data: {
      patient_id: patient.id,
      payment_status: "paid",
      items: [
        {
          catalog_item_id: item.id,
          item_type: "medicine",
          label: "Trial lens",
          quantity: 2,
          unit_price: 125,
        },
      ],
    },
  });
  expect(invoiceResponse.status()).toBe(201);
  const invoice = await invoiceResponse.json();
  expect(invoice.total).toBe(250);

  const finalized = await request.post("/invoices/finalize", {
    headers,
    data: { invoice_id: invoice.id },
  });
  expect(finalized.status()).toBe(200);

  const catalog = await request.get("/catalog", { headers });
  expect(catalog.status()).toBe(200);
  const refreshedItem = (await catalog.json()).find((row: { id: string }) => row.id === item.id);
  expect(refreshedItem.stock_quantity).toBe(13);
});

test("appointments, check-in, follow-ups, and public booking run through backend workflows", async ({ request }) => {
  const session = await registerClinic(request, unique("schedule"));
  const headers = authHeaders(session.token);
  const scheduledFor = futureClinicHourIso(2, 10);

  const appointmentResponse = await request.post("/appointments", {
    headers,
    data: {
      name: "Appointment Patient",
      phone: "5550102020",
      email: "appointment@example.com",
      address: "10 Appointment Ave",
      reason: "Scheduled review",
      age: 42,
      scheduled_for: scheduledFor,
    },
  });
  expect(appointmentResponse.status()).toBe(201);
  const appointment = await appointmentResponse.json();

  const preview = await request.get(`/appointments/${appointment.id}/check-in-preview`, { headers });
  expect(preview.status()).toBe(200);

  const checkedIn = await request.post(`/appointments/${appointment.id}/check-in`, {
    headers,
    data: { force_new: true },
  });
  expect(checkedIn.status()).toBe(200);
  const patient = await checkedIn.json();
  expect(patient.name).toBe("Appointment Patient");

  const followUpResponse = await request.post(`/patients/${patient.id}/follow-ups`, {
    headers,
    data: {
      scheduled_for: scheduledFor,
      notes: "Return after one week",
    },
  });
  expect(followUpResponse.status()).toBe(201);
  const followUp = await followUpResponse.json();
  expect(followUp.status).toBe("scheduled");

  const tokenResponse = await request.post("/__e2e/follow-up-booking-token", {
    data: {
      org_id: session.user.org_id,
      patient_id: patient.id,
      follow_up_id: followUp.id,
    },
  });
  expect(tokenResponse.status()).toBe(200);
  const bookingToken = (await tokenResponse.json()).token;

  const publicContext = await request.get(`/public/follow-up-booking?token=${bookingToken}`);
  expect(publicContext.status()).toBe(200);
  expect((await publicContext.json()).patient_name).toBe("Appointment Patient");

  const rescheduledFor = futureClinicHourIso(2, 11);
  const publicBook = await request.post("/public/follow-up-booking", {
    data: {
      token: bookingToken,
      scheduled_for: rescheduledFor,
    },
  });
  expect(publicBook.status()).toBe(204);
});

test("exports write audit events and return clinic-scoped CSV content", async ({ request }) => {
  const session = await registerClinic(request, unique("exports"));
  const headers = authHeaders(session.token);

  const updateSettings = await request.put("/settings/clinic", {
    headers,
    data: {
      clinic_name: "Export Coverage Clinic",
      clinic_specialty: "general_physician",
      timezone: "UTC",
      appointment_start_time: "09:00",
      appointment_end_time: "17:00",
      appointments_per_hour: 2,
    },
  });
  expect(updateSettings.status()).toBe(200);
  const settingsRead = await request.get("/settings/clinic", { headers });
  expect(settingsRead.status()).toBe(200);
  expect((await settingsRead.json()).clinic_name).toBe("Export Coverage Clinic");
  const completeOnboarding = await request.post("/settings/clinic/onboarding/complete", { headers });
  expect(completeOnboarding.status()).toBe(200);

  const patient = await createPatient(request, session.token, { name: "Export Patient", phone: "5550103030" });

  const consultationItem = await request.post("/catalog", {
    headers,
    data: {
      name: "Consultation",
      item_type: "service",
      default_price: 500,
      track_inventory: false,
      stock_quantity: 0,
      low_stock_threshold: 0,
      unit: "visit",
      aliases: ["consult"],
    },
  });
  expect(consultationItem.status()).toBe(201);

  const noteDraft = await request.post("/generate-note", {
    headers,
    data: {
      patient_id: patient.id,
      symptoms: "Export cough",
      diagnosis: "Upper respiratory infection",
      medications: "Hydration",
      notes: "Create records for companion endpoints.",
    },
  });
  expect(noteDraft.status()).toBe(200);
  const note = await noteDraft.json();
  const finalizeNote = await request.post("/notes/finalize", {
    headers,
    data: {
      note_id: note.note_id,
    },
  });
  expect(finalizeNote.status()).toBe(200);

  const billingSuggestions = await request.get(`/notes/${note.note_id}/billing-suggestions`, { headers });
  expect(billingSuggestions.status()).toBe(200);
  expect((await billingSuggestions.json()).suggestions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: "default_consultation",
        status: "auto_add",
      }),
    ]),
  );

  const invoiceResponse = await request.post("/invoices", {
    headers,
    data: {
      patient_id: patient.id,
      payment_status: "paid",
      items: [
        {
          item_type: "service",
          label: "Consultation",
          quantity: 1,
          unit_price: 500,
        },
      ],
    },
  });
  expect(invoiceResponse.status()).toBe(201);
  const invoice = await invoiceResponse.json();

  const exportResponse = await request.get("/exports/patients.csv", { headers });
  expect(exportResponse.status()).toBe(200);
  expect(exportResponse.headers()["content-type"]).toContain("text/csv");
  expect(await exportResponse.text()).toContain("Export Patient");

  const visitsExport = await request.get("/exports/visits.csv?range=all", { headers });
  expect(visitsExport.status()).toBe(200);
  expect(await visitsExport.text()).toContain("Export Patient");

  const invoicesExport = await request.get("/exports/invoices.csv", { headers });
  expect(invoicesExport.status()).toBe(200);
  expect(await invoicesExport.text()).toContain("Export Patient");

  const patientNotes = await request.get(`/patients/${patient.id}/notes`, { headers });
  expect(patientNotes.status()).toBe(200);
  expect((await patientNotes.json()).some((row: { id: string }) => row.id === note.note_id)).toBe(true);

  const patientInvoices = await request.get(`/patients/${patient.id}/invoices`, { headers });
  expect(patientInvoices.status()).toBe(200);
  expect((await patientInvoices.json()).some((row: { id: string }) => row.id === invoice.id)).toBe(true);

  const invoices = await request.get("/invoices?limit=10&offset=0", { headers });
  expect(invoices.status()).toBe(200);
  expect((await invoices.json()).some((row: { id: string }) => row.id === invoice.id)).toBe(true);

  const auditEvents = await request.get("/audit-events", { headers });
  expect(auditEvents.status()).toBe(200);
  expect((await auditEvents.json()).map((event: { action: string }) => event.action)).toEqual(
    expect.arrayContaining(["patients_exported", "visits_exported", "invoices_exported"]),
  );
});

test("account, media, specialty records, and mobile finalize routes work together", async ({ request }) => {
  const session = await registerClinic(request, unique("account-media"));
  const headers = authHeaders(session.token);

  const updateAccount = await request.patch("/auth/me", {
    headers,
    data: {
      name: "Dr. Updated E2E",
      doctor_dob: "1988-03-04",
      doctor_address: "88 Updated Lane",
    },
  });
  expect(updateAccount.status()).toBe(200);
  expect((await updateAccount.json()).name).toBe("Dr. Updated E2E");
  expect(updateAccount.headers()["x-session-token"]).toBeTruthy();

  const ownSignatureDelete = await request.delete("/auth/me/signature", { headers });
  expect(ownSignatureDelete.status()).toBe(200);
  expect((await ownSignatureDelete.json()).doctor_signature_url).toBeNull();
  const missingOwnSignature = await request.get("/auth/me/signature/file", { headers });
  expect(missingOwnSignature.status()).toBe(404);

  const passwordUpdate = await request.post("/auth/me/password", {
    headers,
    data: {
      current_password: session.password,
      new_password: "password456!",
    },
  });
  expect(passwordUpdate.status()).toBe(204);

  const oldLogin = await request.post("/auth/login", {
    data: { identifier: session.identifier, password: session.password },
  });
  expect(oldLogin.status()).toBe(401);
  const newLogin = await request.post("/auth/login", {
    data: { identifier: session.identifier, password: "password456!" },
  });
  expect(newLogin.status()).toBe(200);
  const refreshedToken = (await newLogin.json()).token as string;
  const refreshedHeaders = authHeaders(refreshedToken);

  const staffResponse = await request.post("/users/staff", {
    headers: refreshedHeaders,
    data: {
      name: "Signature Staff",
      identifier: `${unique("signature-staff")}@clinic.test`,
      email: `${unique("signature-email")}@clinic.test`,
      phone: "5550103001",
      password: "password12345",
    },
  });
  expect(staffResponse.status()).toBe(201);
  const staff = await staffResponse.json();
  const staffSignature = await request.post(`/users/${staff.id}/signature`, {
    headers: refreshedHeaders,
    multipart: {
      file: {
        name: "staff-signature.png",
        mimeType: "image/png",
        buffer: signaturePng,
      },
    },
  });
  expect(staffSignature.status()).toBe(200);
  const staffSignatureFile = await request.get(`/users/${staff.id}/signature/file`, { headers: refreshedHeaders });
  expect(staffSignatureFile.status()).toBe(200);
  expect(staffSignatureFile.headers()["content-type"]).toContain("image/png");
  const staffSignatureDelete = await request.delete(`/users/${staff.id}/signature`, { headers: refreshedHeaders });
  expect(staffSignatureDelete.status()).toBe(200);
  const missingStaffSignature = await request.get(`/users/${staff.id}/signature/file`, { headers: refreshedHeaders });
  expect(missingStaffSignature.status()).toBe(404);

  const templateUpload = await request.post("/settings/clinic/document-template", {
    headers: refreshedHeaders,
    multipart: {
      file: {
        name: "template.png",
        mimeType: "image/png",
        buffer: signaturePng,
      },
    },
  });
  expect(templateUpload.status()).toBe(200);
  const templateDelete = await request.delete("/settings/clinic/document-template", { headers: refreshedHeaders });
  expect(templateDelete.status()).toBe(200);
  expect((await templateDelete.json()).document_template_url).toBeNull();
  const missingTemplate = await request.get("/settings/clinic/document-template/file", { headers: refreshedHeaders });
  expect(missingTemplate.status()).toBe(404);

  const patient = await createPatient(request, refreshedToken, {
    name: "Specialty Media Patient",
    date_of_birth: "2016-02-01",
    age: 8,
  });

  const profilePhoto = await request.post(`/patients/${patient.id}/profile-photo`, {
    headers: refreshedHeaders,
    multipart: {
      file: {
        name: "profile.png",
        mimeType: "image/png",
        buffer: signaturePng,
      },
    },
  });
  expect(profilePhoto.status()).toBe(200);
  const photoFile = await request.get(`/patients/${patient.id}/profile-photo/file`, { headers: refreshedHeaders });
  expect(photoFile.status()).toBe(200);
  expect(photoFile.headers()["content-type"]).toContain("image/png");
  const deletePhoto = await request.delete(`/patients/${patient.id}/profile-photo`, { headers: refreshedHeaders });
  expect(deletePhoto.status()).toBe(200);
  const missingPhoto = await request.get(`/patients/${patient.id}/profile-photo/file`, { headers: refreshedHeaders });
  expect(missingPhoto.status()).toBe(400);

  const measuredAt = new Date().toISOString();
  const growth = await request.post(`/patients/${patient.id}/growth-records`, {
    headers: refreshedHeaders,
    data: {
      measured_at: measuredAt,
      height_cm: 128,
      weight_kg: 28,
      head_circumference_cm: 51,
      visit_notes: "Tracking growth",
    },
  });
  expect(growth.status()).toBe(201);
  const growthRecord = await growth.json();
  expect(growthRecord.bmi).toBeGreaterThan(0);
  const growthPatch = await request.patch(`/patients/${patient.id}/growth-records/${growthRecord.track_id}`, {
    headers: refreshedHeaders,
    data: {
      measured_at: measuredAt,
      height_cm: 128,
      weight_kg: 29,
      head_circumference_cm: 51,
      visit_notes: "Tracking growth after update",
    },
  });
  expect(growthPatch.status()).toBe(200);
  const growthHistory = await request.get(`/patients/${patient.id}/growth-history`, { headers: refreshedHeaders });
  expect(growthHistory.status()).toBe(200);
  expect((await growthHistory.json()).latest_measurement.weight_kg).toBe(29);

  const myopia = await request.post(`/patients/${patient.id}/myopia-records`, {
    headers: refreshedHeaders,
    data: {
      measured_at: measuredAt,
      age_years: 8,
      axial_length_right_mm: 24.1,
      axial_length_left_mm: 24,
      treatment_type: "Atropine",
      treatment_notes: "Nightly",
      visit_notes: "Baseline",
      refraction_right: "-2.00",
      refraction_left: "-1.75",
    },
  });
  expect(myopia.status()).toBe(201);
  const myopiaRecord = await myopia.json();
  const myopiaPatch = await request.patch(`/patients/${patient.id}/myopia-records/${myopiaRecord.id}`, {
    headers: refreshedHeaders,
    data: { treatment_notes: "Nightly low-dose atropine" },
  });
  expect(myopiaPatch.status()).toBe(200);
  const myopiaHistory = await request.get(`/patients/${patient.id}/myopia-history`, { headers: refreshedHeaders });
  expect(myopiaHistory.status()).toBe(200);
  expect((await myopiaHistory.json()).records).toHaveLength(1);

  const draft = await request.post("/generate-note", {
    headers: refreshedHeaders,
    data: {
      patient_id: patient.id,
      symptoms: "Mobile cough",
      diagnosis: "Viral URTI",
      medications: "Supportive care",
      notes: "Finalize through mobile API.",
    },
  });
  expect(draft.status()).toBe(200);
  const draftBody = await draft.json();
  const mobileFinalize = await request.post("/mobile/consultations/finalize", {
    headers: refreshedHeaders,
    data: {
      patient_id: patient.id,
      note_id: draftBody.note_id,
    },
  });
  expect(mobileFinalize.status()).toBe(200);
  const finalized = await mobileFinalize.json();
  expect(finalized.note.status).toBe("final");
  expect(finalized.patient.status).toBe("done");

  const summary = await request.get(`/patients/${patient.id}/summary`, { headers: refreshedHeaders });
  expect(summary.status()).toBe(200);
  const regeneratedSummary = await request.post(`/patients/${patient.id}/summary/regenerate`, { headers: refreshedHeaders });
  expect(regeneratedSummary.status()).toBe(200);
  expect((await regeneratedSummary.json()).summary).toBeTruthy();
});

test("case study and clinical assistant routes return durable fallback outputs", async ({ request }) => {
  const session = await registerClinic(request, unique("case-ai"));
  const headers = authHeaders(session.token);
  const patient = await createPatient(request, session.token, {
    name: "Case Study Patient",
    reason: "Progressive myopia",
    age: 12,
  });

  const questions = await request.post("/ai/clinical-questions", {
    headers,
    data: {
      patient_id: patient.id,
      consultation: {
        symptoms: "Blurry distance vision",
        diagnosis: "Progressive myopia",
        medications: "",
        notes: "Parent concerned about worsening prescription.",
      },
    },
  });
  expect(questions.status()).toBe(200);
  const questionBody = await questions.json();
  expect(questionBody.used_fallback).toBe(true);
  expect(questionBody.questions.length).toBeGreaterThan(0);

  const analysis = await request.post("/ai/clinical-analysis", {
    headers,
    data: {
      patient_id: patient.id,
      consultation: {
        symptoms: "Blurry distance vision",
        diagnosis: "Progressive myopia",
        medications: "",
        notes: "Parent concerned about worsening prescription.",
      },
      answers: [
        {
          question_id: questionBody.questions[0].id,
          label: questionBody.questions[0].label,
          answer: "Symptoms have progressed over six months.",
        },
      ],
    },
  });
  expect(analysis.status()).toBe(200);
  const analysisBody = await analysis.json();
  expect(analysisBody.used_fallback).toBe(true);
  expect(analysisBody.possibilities.length).toBeGreaterThan(0);

  const source = await request.get(`/patients/${patient.id}/case-study-source`, { headers });
  expect(source.status()).toBe(200);
  expect((await source.json()).patient.name).toBe("Case Study Patient");

  const generated = await request.post("/generate-case-study", {
    headers,
    data: {
      patient_id: patient.id,
      title: "Myopia Control Case",
      template_key: "conference_presentation",
      anonymized: true,
      author_instructions: "Emphasize longitudinal management.",
    },
  });
  expect(generated.status()).toBe(200);
  const generatedBody = await generated.json();
  expect(generatedBody.title).toBe("Myopia Control Case");
  expect(generatedBody.content).toContain("Myopia Control Case");

  const createCaseStudy = await request.post("/case-studies", {
    headers,
    data: {
      patient_id: patient.id,
      title: generatedBody.title,
      status: "draft",
      template_key: "conference_presentation",
      anonymized: true,
      author_instructions: "Emphasize longitudinal management.",
      generated_content: generatedBody.content,
      source_snapshot: generatedBody.source,
    },
  });
  expect(createCaseStudy.status()).toBe(201);
  const caseStudy = await createCaseStudy.json();

  const updateCaseStudy = await request.patch(`/case-studies/${caseStudy.id}`, {
    headers,
    data: {
      status: "final",
      title: "Final Myopia Control Case",
    },
  });
  expect(updateCaseStudy.status()).toBe(200);
  expect((await updateCaseStudy.json()).status).toBe("final");

  const readCaseStudy = await request.get(`/case-studies/${caseStudy.id}`, { headers });
  expect(readCaseStudy.status()).toBe(200);
  expect((await readCaseStudy.json()).title).toBe("Final Myopia Control Case");

  const listCaseStudies = await request.get("/case-studies", { headers });
  expect(listCaseStudies.status()).toBe(200);
  expect((await listCaseStudies.json()).map((row: { id: string }) => row.id)).toContain(caseStudy.id);

  const pdf = await request.get(`/case-studies/${caseStudy.id}/pdf`, { headers });
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
});

test("superdashboard routes manage onboarding, organizations, users, and access control", async ({ request }) => {
  const ops = await registerClinic(request, "ops-super");
  const managed = await registerClinic(request, unique("managed-org"));
  const aliasManaged = await registerClinic(request, unique("alias-managed-org"));
  const opsLogin = await request.post("/superdashboard/auth/login", {
    data: { identifier: ops.identifier, password: ops.password },
  });
  expect(opsLogin.status()).toBe(200);
  const opsHeaders = superdashboardAuthHeaders((await opsLogin.json()).token);
  const managedHeaders = authHeaders(managed.token);
  const aliasManagedHeaders = authHeaders(aliasManaged.token);

  const forbidden = await request.get("/superdashboard/orgs", { headers: managedHeaders });
  expect(forbidden.status()).toBe(401);

  const flushMetrics = await request.post("/__e2e/flush-request-metrics");
  expect(flushMetrics.ok()).toBeTruthy();
  const dashboard = await request.get("/superdashboard/dashboard", { headers: opsHeaders });
  expect(dashboard.status()).toBe(200);
  expect((await dashboard.json()).org_count).toBeGreaterThanOrEqual(2);
  const trends = await request.get("/superdashboard/dashboard/trends", { headers: opsHeaders });
  expect(trends.status()).toBe(200);
  expect((await trends.json()).requests.length).toBeGreaterThan(0);
  const usageByOrg = await request.get("/superdashboard/dashboard/usage-by-org", { headers: opsHeaders });
  expect(usageByOrg.status()).toBe(200);
  expect((await usageByOrg.json()).ai_usage).toBeTruthy();

  const createCustomer = await request.post("/superdashboard/onboarding/customers", {
    headers: opsHeaders,
    data: {
      customer_name: "Bluebird E2E Clinic",
      phone: "+91 98765 43210",
      users_allowed: 3,
      workspace_mode: "team",
    },
  });
  expect(createCustomer.status()).toBe(201);
  const customer = await createCustomer.json();
  expect(customer.customer_id).toContain("CID-");
  expect(customer.phone).toBe("+919876543210");

  const updateCustomer = await request.patch(`/superdashboard/onboarding/customers/${customer.id}`, {
    headers: opsHeaders,
    data: {
      customer_name: "Bluebird E2E Updated",
      users_allowed: 4,
      workspace_mode: "solo",
    },
  });
  expect(updateCustomer.status()).toBe(200);
  expect((await updateCustomer.json()).users_allowed).toBe(4);
  const disableCustomer = await request.post(`/superdashboard/onboarding/customers/${customer.id}/disable`, {
    headers: opsHeaders,
  });
  expect(disableCustomer.status()).toBe(200);
  expect((await disableCustomer.json()).status).toBe("disabled");
  const onboarding = await request.get("/superdashboard/onboarding", { headers: opsHeaders });
  expect(onboarding.status()).toBe(200);
  expect((await onboarding.json()).summary.disabled_count).toBeGreaterThanOrEqual(1);

  const orgs = await request.get("/superdashboard/orgs", { headers: opsHeaders });
  expect(orgs.status()).toBe(200);
  expect((await orgs.json()).map((row: { org_id: string }) => row.org_id)).toContain(managed.user.org_id);
  const aliasOrgs = await request.get("/superuser/orgs", { headers: opsHeaders });
  expect(aliasOrgs.status()).toBe(200);
  expect((await aliasOrgs.json()).map((row: { org_id: string }) => row.org_id)).toContain(aliasManaged.user.org_id);

  const detail = await request.get(`/superdashboard/orgs/${managed.user.org_id}`, { headers: opsHeaders });
  expect(detail.status()).toBe(200);
  const detailBody = await detail.json();
  expect(detailBody.summary.org_id).toBe(managed.user.org_id);
  expect(detailBody.users.map((user: { identifier: string }) => user.identifier)).toContain(managed.identifier);
  const aliasDetail = await request.get(`/superuser/orgs/${aliasManaged.user.org_id}`, { headers: opsHeaders });
  expect(aliasDetail.status()).toBe(200);
  expect((await aliasDetail.json()).summary.org_id).toBe(aliasManaged.user.org_id);

  const workspace = await request.patch(`/superdashboard/orgs/${managed.user.org_id}/workspace-mode`, {
    headers: opsHeaders,
    data: { workspace_mode: "team" },
  });
  expect(workspace.status()).toBe(200);
  expect((await workspace.json()).workspace_mode).toBe("team");

  const usersAllowed = await request.patch(`/superdashboard/orgs/${managed.user.org_id}/users-allowed`, {
    headers: opsHeaders,
    data: { users_allowed: 4 },
  });
  expect(usersAllowed.status()).toBe(200);
  expect((await usersAllowed.json()).users_allowed).toBe(4);

  const settings = await request.patch(`/superdashboard/orgs/${managed.user.org_id}/settings`, {
    headers: opsHeaders,
    data: {
      clinic_name: "Managed E2E Renamed",
      clinic_phone: "+91 90000 11111",
      clinic_specialty: "pediatrics",
      timezone: "Asia/Kolkata",
      appointment_start_time: "10:00",
      appointment_end_time: "18:00",
      appointments_per_hour: 3,
      doctor_name: "Dr Managed Ops",
    },
  });
  expect(settings.status()).toBe(200);
  expect((await settings.json()).clinic_name).toBe("Managed E2E Renamed");
  const aliasSettings = await request.patch(`/superuser/orgs/${aliasManaged.user.org_id}/settings`, {
    headers: opsHeaders,
    data: {
      clinic_name: "Alias Managed E2E Renamed",
      clinic_specialty: "dentistry",
      timezone: "UTC",
      appointment_start_time: "09:00",
      appointment_end_time: "17:00",
      appointments_per_hour: 2,
    },
  });
  expect(aliasSettings.status()).toBe(200);
  expect((await aliasSettings.json()).clinic_name).toBe("Alias Managed E2E Renamed");

  const staff = await request.post("/users/staff", {
    headers: managedHeaders,
    data: {
      identifier: `${unique("managed-staff")}@clinic.test`,
      email: `${unique("managed-staff-email")}@clinic.test`,
      phone: "5550103002",
      password: "password123!",
    },
  });
  expect(staff.status()).toBe(201);
  const staffBody = await staff.json();
  const aliasStaff = await request.post("/users/staff", {
    headers: aliasManagedHeaders,
    data: {
      identifier: `${unique("alias-managed-staff")}@clinic.test`,
      email: `${unique("alias-managed-staff-email")}@clinic.test`,
      phone: "5550103003",
      password: "password123!",
    },
  });
  expect(aliasStaff.status()).toBe(201);
  const aliasStaffBody = await aliasStaff.json();
  const roleUpdate = await request.patch(`/superdashboard/users/${staffBody.id}/role`, {
    headers: opsHeaders,
    data: { role: "admin" },
  });
  expect(roleUpdate.status()).toBe(200);
  expect((await roleUpdate.json()).role).toBe("admin");
  const aliasRoleUpdate = await request.patch(`/superuser/users/${aliasStaffBody.id}/role`, {
    headers: opsHeaders,
    data: { role: "admin" },
  });
  expect(aliasRoleUpdate.status()).toBe(200);
  expect((await aliasRoleUpdate.json()).role).toBe("admin");

  const errors = await request.get("/superdashboard/errors", { headers: opsHeaders });
  expect(errors.status()).toBe(200);
  expect(Array.isArray(await errors.json())).toBe(true);
  const aliasErrors = await request.get("/superuser/errors", { headers: opsHeaders });
  expect(aliasErrors.status()).toBe(200);
  expect(Array.isArray(await aliasErrors.json())).toBe(true);

  const aliasDeleteUser = await request.delete(`/superuser/users/${aliasStaffBody.id}`, { headers: opsHeaders });
  expect(aliasDeleteUser.status()).toBe(200);
  const deleteUser = await request.delete(`/superdashboard/users/${staffBody.id}`, { headers: opsHeaders });
  expect(deleteUser.status()).toBe(200);
  const aliasDeleteOrg = await request.delete(`/superuser/orgs/${aliasManaged.user.org_id}`, { headers: opsHeaders });
  expect(aliasDeleteOrg.status()).toBe(200);
  const deleteOrg = await request.delete(`/superdashboard/orgs/${managed.user.org_id}`, { headers: opsHeaders });
  expect(deleteOrg.status()).toBe(200);
  const deletedAgain = await request.delete(`/superdashboard/orgs/${managed.user.org_id}`, { headers: opsHeaders });
  expect(deletedAgain.status()).toBe(404);
});

test("document generation, send failures, attachment cleanup, and catalog deletion are explicit", async ({ request }) => {
  const session = await registerClinic(request, unique("documents"));
  const headers = authHeaders(session.token);
  const patient = await createPatient(request, session.token, {
    name: "Document Backend Patient",
    age: 9,
    date_of_birth: "2015-05-01",
  });

  const draft = await request.post("/generate-note", {
    headers,
    data: {
      patient_id: patient.id,
      symptoms: "Fever and cough",
      diagnosis: "Viral URI",
      medications: "Paracetamol",
      notes: "Hydration and rest.",
    },
  });
  expect(draft.status()).toBe(200);
  const draftBody = await draft.json();
  expect(draftBody.note_id).toBeTruthy();

  const updateDraft = await request.patch(`/notes/${draftBody.note_id}/draft`, {
    headers,
    data: {
      content: "Edited consultation note content.\n\nMedication: Paracetamol.",
      extractions: {
        services_performed: [{ name: "Consultation", quantity: 1, evidence: "Edited consultation note content." }],
        medications_prescribed: [
          {
            name: "Paracetamol",
            strength: "500 mg",
            dose: "1 tablet",
            route: "oral",
            schedule: "twice daily",
            duration: "3 days",
            quantity: "6 tablets",
            instructions: "Take after food.",
            evidence: "Medication: Paracetamol.",
          },
        ],
      },
    },
  });
  expect(updateDraft.status()).toBe(200);
  expect((await updateDraft.json()).content).toContain("Edited consultation note content");

  const generatedNotePdf = await request.post("/generate-note-pdf", {
    headers,
    data: {
      patient_id: patient.id,
      content: "Printable note body",
      assets: [
        {
          id: "asset-1",
          kind: "attachment",
          name: "pixel.png",
          content_type: "image/png",
          data_base64: signaturePng.toString("base64"),
        },
      ],
    },
  });
  expect(generatedNotePdf.status()).toBe(200);
  expect(generatedNotePdf.headers()["content-type"]).toContain("application/pdf");

  const letter = await request.post("/generate-letter", {
    headers,
    data: {
      to: "Parent",
      subject: "School note",
      content: "Please excuse the patient from sports today.",
    },
  });
  expect(letter.status()).toBe(200);
  const letterContent = (await letter.json()).content as string;
  expect(letterContent).toContain("School note");

  const letterPdf = await request.post("/generate-letter-pdf", {
    headers,
    data: { content: letterContent },
  });
  expect(letterPdf.status()).toBe(200);
  expect(letterPdf.headers()["content-type"]).toContain("application/pdf");

  const handout = await request.post("/generate-parent-handout", {
    headers,
    data: {
      patient_id: patient.id,
      template_key: "fever_home_care",
      instructions: "Return if fever persists.",
    },
  });
  expect(handout.status()).toBe(200);
  const handoutBody = await handout.json();
  expect(handoutBody.title).toBe("Fever Home Care");
  expect(handoutBody.content).toContain("Return if fever persists.");

  const finalized = await request.post("/notes/finalize", {
    headers,
    data: { note_id: draftBody.note_id },
  });
  expect(finalized.status()).toBe(200);

  const sendNote = await request.post("/send-note", {
    headers,
    data: {
      note_id: draftBody.note_id,
      patient_id: patient.id,
      recipient_email: "parent@example.com",
    },
  });
  expect(sendNote.status()).toBe(400);
  expect((await sendNote.json()).detail).toBe("Clinic sender email is not configured.");

  const sendLetter = await request.post("/send-letter", {
    headers,
    data: {
      recipient_email: "parent@example.com",
      subject: "School note",
      content: letterContent,
    },
  });
  expect(sendLetter.status()).toBe(400);
  expect((await sendLetter.json()).detail).toBe("Clinic sender email is not configured.");

  const invoiceResponse = await request.post("/invoices", {
    headers,
    data: {
      patient_id: patient.id,
      payment_status: "paid",
      items: [
        {
          item_type: "service",
          label: "Document consultation",
          quantity: 1,
          unit_price: 300,
        },
      ],
    },
  });
  expect(invoiceResponse.status()).toBe(201);
  const invoice = await invoiceResponse.json();
  const sendInvoice = await request.post("/send-invoice", {
    headers,
    data: {
      invoice_id: invoice.id,
      recipient_email: "parent@example.com",
    },
  });
  expect(sendInvoice.status()).toBe(400);
  expect((await sendInvoice.json()).detail).toBe("Clinic sender email is not configured.");

  const attachmentUpload = await request.post(`/patients/${patient.id}/attachments`, {
    headers,
    multipart: {
      file: {
        name: "cleanup.png",
        mimeType: "image/png",
        buffer: signaturePng,
      },
    },
  });
  expect(attachmentUpload.status()).toBe(201);
  const attachment = await attachmentUpload.json();
  const sendAttachment = await request.post(`/patients/${patient.id}/attachments/${attachment.id}/send`, {
    headers,
    data: {
      recipient_email: "parent@example.com",
      subject: "Attachment",
      message: "Please review.",
    },
  });
  expect(sendAttachment.status()).toBe(400);
  expect((await sendAttachment.json()).detail).toBe("Clinic sender email is not configured.");

  const deleteAttachment = await request.delete(`/patients/${patient.id}/attachments/${attachment.id}`, { headers });
  expect(deleteAttachment.status()).toBe(200);
  const missingAttachment = await request.get(`/attachments/${attachment.id}/file`, { headers });
  expect(missingAttachment.status()).toBe(400);

  const catalogItem = await request.post("/catalog", {
    headers,
    data: {
      name: "Disposable syringe",
      item_type: "medicine",
      default_price: 20,
      track_inventory: false,
      stock_quantity: 0,
      low_stock_threshold: 0,
      unit: "pc",
      aliases: [],
    },
  });
  expect(catalogItem.status()).toBe(201);
  const item = await catalogItem.json();
  const deleteCatalog = await request.delete(`/catalog/${item.id}`, { headers });
  expect(deleteCatalog.status()).toBe(204);
  const catalog = await request.get("/catalog", { headers });
  expect(catalog.status()).toBe(200);
  expect((await catalog.json()).some((row: { id: string }) => row.id === item.id)).toBe(false);
});

test("queue ordering, lookup, visit details, patches, health, and internal reminders are covered", async ({ request }) => {
  const registrationConfig = await request.get("/auth/registration-config");
  expect(registrationConfig.status()).toBe(200);
  expect((await registrationConfig.json()).customer_id_required).toBe(false);

  const live = await request.get("/health/live");
  expect(live.status()).toBe(200);
  const ready = await request.get("/health");
  expect(ready.status()).toBe(expectedReadyStatus);
  const readyAlias = await request.get("/health/ready");
  expect(readyAlias.status()).toBe(expectedReadyStatus);

  const session = await registerClinic(request, unique("workflow"));
  const headers = authHeaders(session.token);
  const firstPatient = await createPatient(request, session.token, {
    name: "Queue First Patient",
    phone: "5551110001",
    reason: "Queue first",
  });
  const secondPatient = await createPatient(request, session.token, {
    name: "Queue Second Patient",
    phone: "5551110002",
    reason: "Queue second",
  });

  const queueOrder = await request.put("/patients/queue/order", {
    headers,
    data: {
      columns: {
        waiting: [secondPatient.id],
        consultation: [firstPatient.id],
        done: [],
      },
    },
  });
  expect(queueOrder.status()).toBe(200);
  const orderedPatients = await queueOrder.json();
  const movedFirst = orderedPatients.find((row: { id: string }) => row.id === firstPatient.id);
  const movedSecond = orderedPatients.find((row: { id: string }) => row.id === secondPatient.id);
  expect(movedFirst.status).toBe("consultation");
  expect(movedSecond.status).toBe("waiting");

  const activePatients = await request.get("/patients?limit=10", { headers });
  expect(activePatients.status()).toBe(200);
  expect((await activePatients.json()).items.map((row: { id: string }) => row.id)).toContain(firstPatient.id);

  const lookup = await request.get("/patients/lookup?phone=5551110001", { headers });
  expect(lookup.status()).toBe(200);
  expect((await lookup.json()).map((row: { id: string }) => row.id)).toContain(firstPatient.id);

  const updatePatient = await request.patch(`/patients/${firstPatient.id}`, {
    headers,
    data: {
      reason: "Updated queue reason",
      status: "done",
      billed: true,
    },
  });
  expect(updatePatient.status()).toBe(200);
  expect((await updatePatient.json()).reason).toBe("Updated queue reason");

  const newVisit = await request.post(`/patients/${firstPatient.id}/visits`, {
    headers,
    data: {
      name: "Queue First Patient",
      phone: "5551110001",
      reason: "Second visit reason",
      age: 45,
      weight: 72,
      temperature: 98.4,
      height: 171,
    },
  });
  expect(newVisit.status()).toBe(200);

  const visits = await request.get("/visits", { headers });
  expect(visits.status()).toBe(200);
  expect((await visits.json()).some((row: { reason: string }) => row.reason === "Second visit reason")).toBe(true);

  const chartVisits = await request.get(`/patients/${firstPatient.id}/visits`, { headers });
  expect(chartVisits.status()).toBe(200);
  const chartVisitRows = await chartVisits.json();
  expect(chartVisitRows.length).toBeGreaterThanOrEqual(2);
  const latestVisit = chartVisitRows[0];
  const visitDetail = await request.get(`/patients/${firstPatient.id}/visits/${latestVisit.id}/details`, { headers });
  expect(visitDetail.status()).toBe(200);
  expect((await visitDetail.json()).visit_id).toBe(latestVisit.id);

  const timeline = await request.get(`/patients/${firstPatient.id}/timeline`, { headers });
  expect(timeline.status()).toBe(200);
  expect(Array.isArray(await timeline.json())).toBe(true);

  const scheduledFor = futureClinicHourIso(2, 5);
  const appointment = await request.post("/appointments", {
    headers,
    data: {
      name: "Patch Appointment Patient",
      phone: "5551110099",
      reason: "Patch appointment",
      scheduled_for: scheduledFor,
    },
  });
  expect(appointment.status()).toBe(201);
  const appointmentBody = await appointment.json();
  const patchedAppointmentDate = futureClinicHourIso(3, 5);
  const patchedAppointment = await request.patch(`/appointments/${appointmentBody.id}`, {
    headers,
    data: {
      scheduled_for: patchedAppointmentDate,
      status: "cancelled",
    },
  });
  expect(patchedAppointment.status()).toBe(200);
  expect((await patchedAppointment.json()).status).toBe("cancelled");
  const cancelledAppointments = await request.get(`/appointments?status=cancelled&q=Patch&scheduled_date=${patchedAppointmentDate.slice(0, 10)}`, { headers });
  expect(cancelledAppointments.status()).toBe(200);
  expect((await cancelledAppointments.json()).map((row: { id: string }) => row.id)).toContain(appointmentBody.id);

  const followUp = await request.post(`/patients/${firstPatient.id}/follow-ups`, {
    headers,
    data: {
      scheduled_for: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      notes: "Initial follow up",
    },
  });
  expect(followUp.status()).toBe(201);
  const followUpBody = await followUp.json();
  const patchedFollowUp = await request.patch(`/follow-ups/${followUpBody.id}`, {
    headers,
    data: {
      status: "completed",
      notes: "Completed by phone",
    },
  });
  expect(patchedFollowUp.status()).toBe(200);
  expect((await patchedFollowUp.json()).status).toBe("completed");
  const completedFollowUps = await request.get("/follow-ups?status=completed&q=Queue", { headers });
  expect(completedFollowUps.status()).toBe(200);
  expect((await completedFollowUps.json()).map((row: { id: string }) => row.id)).toContain(followUpBody.id);

  const reminderForbidden = await request.post("/internal/run-follow-up-reminders", {
    headers: { "X-Internal-Token": "wrong-token" },
  });
  expect(reminderForbidden.status()).toBe(403);
  const reminderRun = await request.post("/internal/run-follow-up-reminders", {
    headers: { "X-Internal-Token": "playwright-internal-token" },
  });
  expect(reminderRun.status()).toBe(200);
  expect((await reminderRun.json()).processed_orgs).toBeGreaterThanOrEqual(1);
});
