import { authStorage, SESSION_EXPIRED_MESSAGE } from "@/lib/auth";
import {
  AccountUpdatePayload,
  AuditEvent,
  BillingSuggestionsResponse,
  Appointment,
  AppointmentCheckInPayload,
  AppointmentCreatePayload,
  AppointmentUpdatePayload,
  ConsultationNote,
  AuthResponse,
  AuthUser,
  CatalogItem,
  CareProgramOffering,
  CaseStudy,
  CaseStudySavePayload,
  CatalogItemCreatePayload,
  CatalogStockUpdatePayload,
  ClinicSettings,
  ClinicSettingsUpdatePayload,
  CheckInConfig,
  CheckInRequest,
  PublicAppointmentBooking,
  PublicAppointmentSlots,
  PublicCheckInContext,
  ClinicalAnalysisPayload,
  ClinicalAnalysisResponse,
  ClinicalQuestionsPayload,
  ClinicalQuestionsResponse,
  ControlRoomDatabase,
  ControlRoomIncidents,
  ControlRoomRunbooks,
  ControlRoomStatus,
  CustomerOnboarding,
  CustomerOnboardingCreatePayload,
  CustomerOnboardingUpdatePayload,
  FinalizeNotePayload,
  FinalizeInvoicePayload,
  FollowUp,
  FollowUpCreatePayload,
  FollowUpUpdatePayload,
  GenerateLetterPayload,
  GenerateLetterResponse,
  GenerateLetterPdfPayload,
  GenerateParentHandoutPayload,
  GenerateParentHandoutResponse,
  GenerateCaseStudyPayload,
  GenerateCaseStudyResponse,
  GeneratePdfPayload,
  Invoice,
  InvoiceActionResult,
  InvoiceCreatePayload,
  GenerateNotePayload,
  GenerateNoteResponse,
  LongitudinalTrackCreatePayload,
  LongitudinalTrackRecord,
  BinocularVisionEvaluationCreatePayload,
  BinocularVisionEvaluationRecord,
  MobileFinalizeConsultationPayload,
  MobileFinalizeConsultationResponse,
  MyopiaHistory,
  MyopiaMeasurementPayload,
  MyopiaMeasurementRecord,
  PediatricGrowthMeasurementPayload,
  PediatricGrowthMeasurementRecord,
  PediatricGrowthSummary,
  OperationResult,
  Patient,
  PatientAttachment,
  PatientChartVisit,
  PatientInput,
  PatientMatch,
  PatientSummary,
  PatientVisitDetail,
  PatientUpdatePayload,
  PatientVisit,
  PatientTimelineEvent,
  PatientStatus,
  PasswordUpdatePayload,
  PatientCaseStudySource,
  RegisterPayload,
  RegistrationConfig,
  UserRoleUpdatePayload,
  UpdateNoteDraftPayload,
  SendInvoicePayload,
  SendInvoiceWhatsAppPayload,
  SendLetterPayload,
  SendLetterWhatsAppPayload,
  SendNotePayload,
  SendNoteWhatsAppPayload,
  SendPatientAttachmentPayload,
  StaffUserCreatePayload,
  SuperdashboardDashboard,
  SuperdashboardOnboarding,
  SuperdashboardTrends,
  SuperdashboardUsageByOrg,
  SuperuserOrgDetail,
  SuperuserOrgSummary,
  SuperuserOrgUser,
  TbiEvaluationCreatePayload,
  TbiEvaluationRecord,
  PlatformError,
  PlatformEmailSettings,
  PlatformEmailSettingsUpdatePayload,
  ProgramEnrollment,
  ProgramEnrollmentSummary,
  ProgramReport,
  WhatsAppDelivery,
} from "@/lib/types";

function resolveApiBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8001";
  if (typeof window === "undefined") {
    return configured;
  }

  try {
    const configuredUrl = new URL(configured);
    const currentHostname = window.location.hostname;
    const configuredHostname = configuredUrl.hostname;
    const isLoopbackConfigured =
      configuredHostname === "127.0.0.1" || configuredHostname === "localhost";
    const isLoopbackBrowser =
      currentHostname === "127.0.0.1" || currentHostname === "localhost";

    if (
      isLoopbackConfigured &&
      (!isLoopbackBrowser || configuredHostname !== currentHostname)
    ) {
      configuredUrl.hostname = currentHostname;
      return configuredUrl.toString().replace(/\/$/, "");
    }

    return configured.replace(/\/$/, "");
  } catch {
    return configured.replace(/\/$/, "");
  }
}

function withIdempotencyKey<T extends { idempotency_key?: string }>(payload: T): T {
  const key =
    payload.idempotency_key ||
    globalThis.crypto?.randomUUID?.() ||
    `wa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return { ...payload, idempotency_key: key };
}

const API_BASE_URL = resolveApiBaseUrl();
const REQUEST_TIMEOUT_MS = 15000;
const LONG_REQUEST_TIMEOUT_MS = 60000;
const SAFE_REQUEST_RETRY_ATTEMPTS = 2;
const SAFE_REQUEST_RETRY_DELAY_MS = 350;
const SESSION_TOKEN_HEADER = "x-session-token";
const SESSION_EXPIRES_AT_HEADER = "x-session-expires-at";

export function resolveApiAssetUrl(path: string | null | undefined) {
  if (!path) {
    return "";
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function isSessionErrorMessage(message: string) {
  return (
    message === "Authentication required." ||
    message === "Invalid token." ||
    message === "Token expired." ||
    message === "Session expired." ||
    message === SESSION_EXPIRED_MESSAGE
  );
}

function shouldClearSessionOnError(message: string) {
  return (
    message === "Invalid token." ||
    message === "Token expired." ||
    message === "Session expired." ||
    message === SESSION_EXPIRED_MESSAGE
  );
}

function getActiveToken(path: string) {
  void path;
  authStorage.clearExpiredSession();
  return "";
}

function syncSessionFromResponse(response: Response) {
  const refreshedToken = response.headers.get(SESSION_TOKEN_HEADER);
  const refreshedExpiry = response.headers.get(SESSION_EXPIRES_AT_HEADER);
  // The browser relies on the HttpOnly cookie. The exposed token header is
  // retained for non-browser API clients but must not enter browser storage.
  void refreshedToken;
  authStorage.setSessionExpiry(refreshedExpiry ? Number(refreshedExpiry) : null);
}

function withQuery(path: string, params: Record<string, string | number | undefined>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") {
      continue;
    }
    searchParams.set(key, String(value));
  }
  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

function createTimeoutSignal(timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => window.clearTimeout(timeoutId),
  };
}

function getRequestMethod(init?: RequestInit) {
  return (init?.method || "GET").toUpperCase();
}

function canRetrySafely(init?: RequestInit) {
  const method = getRequestMethod(init);
  return method === "GET" || method === "HEAD";
}

async function delay(ms: number) {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function performFetch(
  path: string,
  init: RequestInit | undefined,
  headers: Record<string, string>,
  options?: { timeoutMs?: number },
) {
  const maxAttempts = canRetrySafely(init) ? SAFE_REQUEST_RETRY_ATTEMPTS : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const timeout = typeof window !== "undefined" ? createTimeoutSignal(options?.timeoutMs) : null;
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        ...(timeout ? { signal: timeout.signal } : {}),
        credentials: "include",
        headers,
        cache: "no-store",
      });
      timeout?.cleanup();

      if (
        attempt < maxAttempts &&
        [502, 503, 504].includes(response.status)
      ) {
        await delay(SAFE_REQUEST_RETRY_DELAY_MS);
        continue;
      }

      return response;
    } catch (error) {
      timeout?.cleanup();
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Request timed out. Check the backend and refresh.");
      }

      if (attempt < maxAttempts && error instanceof TypeError) {
        await delay(SAFE_REQUEST_RETRY_DELAY_MS);
        continue;
      }

      if (error instanceof TypeError) {
        throw new Error("Server disconnected. Please try again.");
      }

      throw error;
    }
  }

  throw new Error("Server disconnected. Please try again.");
}

function buildRequestHeaders(
  path: string,
  init?: RequestInit,
  options?: { includeJsonContentType?: boolean },
) {
  const token = getActiveToken(path);
  const headers = {
    ...((options?.includeJsonContentType ?? true) ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((init?.headers as Record<string, string> | undefined) || {}),
  };

  return { token, headers };
}

async function request<T>(path: string, init?: RequestInit, options?: { timeoutMs?: number }): Promise<T> {
  const { token, headers } = buildRequestHeaders(path, init);
  const response = await performFetch(path, init, headers, options);
  syncSessionFromResponse(response);

  if (!response.ok) {
    const raw = await response.text();
    let message = "Request failed.";

    try {
      const parsed = JSON.parse(raw) as {
        detail?: string | Array<{ msg?: string; type?: string; loc?: Array<string | number> }> | { message?: string };
      };
      if (typeof parsed.detail === "string") {
        message = parsed.detail;
      } else if (parsed.detail && typeof parsed.detail === "object" && "message" in parsed.detail) {
        message = parsed.detail.message || message;
      } else if (Array.isArray(parsed.detail) && parsed.detail[0]?.msg) {
        const firstError = parsed.detail[0];
        const fieldName = String(firstError.loc?.[firstError.loc.length - 1] || "");
        if (
          firstError.type === "string_too_short" &&
          ["password", "current_password", "new_password"].includes(fieldName)
        ) {
          message = "Password must be at least 12 characters.";
        } else {
          message = firstError.msg as string;
        }
      } else if (raw) {
        message = raw;
      }
    } catch {
      if (raw) {
        message = raw;
      }
    }

    if (isSessionErrorMessage(message)) {
      const currentToken = authStorage.getToken();
      if (shouldClearSessionOnError(message) && (!currentToken || currentToken === token)) {
        authStorage.clear();
      }
      if (message === "Token expired." || message === "Session expired.") {
        throw new Error(SESSION_EXPIRED_MESSAGE);
      }
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const raw = await response.text();
  if (!raw) {
    return undefined as T;
  }
  return JSON.parse(raw) as T;
}

async function requestBlob(path: string, init?: RequestInit, options?: { timeoutMs?: number }): Promise<Blob> {
  const { token, headers } = buildRequestHeaders(path, init);
  const response = await performFetch(path, init, headers, options);
  syncSessionFromResponse(response);

  if (!response.ok) {
    const raw = await response.text();
    const message = raw || "Request failed.";
    if (isSessionErrorMessage(message)) {
      const currentToken = authStorage.getToken();
      if (shouldClearSessionOnError(message) && (!currentToken || currentToken === token)) {
        authStorage.clear();
      }
      if (message === "Token expired." || message === "Session expired.") {
        throw new Error(SESSION_EXPIRED_MESSAGE);
      }
    }
    throw new Error(message);
  }

  return response.blob();
}

async function requestForm<T>(path: string, formData: FormData, init?: RequestInit, options?: { timeoutMs?: number }): Promise<T> {
  const { token, headers } = buildRequestHeaders(path, init, { includeJsonContentType: false });
  const response = await performFetch(path, { ...init, body: formData }, headers, options);
  syncSessionFromResponse(response);

  if (!response.ok) {
    const raw = await response.text();
    const message = raw || "Request failed.";
    if (isSessionErrorMessage(message)) {
      const currentToken = authStorage.getToken();
      if (shouldClearSessionOnError(message) && (!currentToken || currentToken === token)) {
        authStorage.clear();
      }
      if (message === "Token expired." || message === "Session expired.") {
        throw new Error(SESSION_EXPIRED_MESSAGE);
      }
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const api = {
  getPublicCheckInContext: (token: string) =>
    request<PublicCheckInContext>(withQuery("/public/check-in", { token })),
  submitPublicCheckIn: (payload: {
    token: string;
    name: string;
    phone: string;
    email: string;
    date_of_birth: string;
    sex_at_birth: "female" | "male" | "other";
    reason: string;
  }) =>
    request<{ id: string; status: string; clinic_name: string }>("/public/check-in", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getPublicAppointmentSlots: (token: string) =>
    request<PublicAppointmentSlots>(
      withQuery("/public/check-in/appointment-slots", { token }),
    ),
  bookPublicAppointment: (payload: {
    token: string;
    name: string;
    phone: string;
    email: string;
    date_of_birth: string;
    sex_at_birth: "female" | "male" | "other";
    reason: string;
    scheduled_for: string;
  }) =>
    request<PublicAppointmentBooking>("/public/check-in/appointment", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getPublicAppointment: (bookingToken: string) =>
    request<PublicAppointmentBooking>(
      withQuery("/public/check-in/appointment", { booking_token: bookingToken }),
    ),
  reschedulePublicAppointment: (bookingToken: string, scheduledFor: string) =>
    request<PublicAppointmentBooking>("/public/check-in/appointment/reschedule", {
      method: "POST",
      body: JSON.stringify({
        booking_token: bookingToken,
        scheduled_for: scheduledFor,
      }),
    }),
  cancelPublicAppointment: (bookingToken: string) =>
    request<PublicAppointmentBooking>("/public/check-in/appointment/cancel", {
      method: "POST",
      body: JSON.stringify({ booking_token: bookingToken }),
    }),
  getRegistrationConfig: () => request<RegistrationConfig>("/auth/registration-config"),
  login: (payload: { identifier: string; password: string }) =>
    request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  register: (payload: RegisterPayload) =>
    request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  logout: () =>
    request<void>("/auth/logout", {
      method: "POST",
    }),
  getCurrentUser: () => request<AuthUser>("/auth/me"),
  updateMyAccount: (payload: AccountUpdatePayload) =>
    request<AuthUser>("/auth/me", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  updateMyPassword: (payload: PasswordUpdatePayload) =>
    request<void>("/auth/me/password", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  uploadMySignature: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return requestForm<AuthUser>("/auth/me/signature", formData, {
      method: "POST",
    });
  },
  downloadMySignature: () =>
    requestBlob("/auth/me/signature/file"),
  removeMySignature: () =>
    request<AuthUser>("/auth/me/signature", {
      method: "DELETE",
    }),
  listUsers: () => request<AuthUser[]>("/users"),
  deleteUser: (userId: string) =>
    request<void>(`/users/${userId}`, {
      method: "DELETE",
    }),
  updateUserRole: (userId: string, payload: UserRoleUpdatePayload) =>
    request<AuthUser>(`/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  uploadUserSignature: (userId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return requestForm<AuthUser>(`/users/${userId}/signature`, formData, {
      method: "POST",
    });
  },
  removeUserSignature: (userId: string) =>
    request<AuthUser>(`/users/${userId}/signature`, {
      method: "DELETE",
    }),
  listAuditEvents: (params?: { limit?: number }) =>
    request<AuditEvent[]>(withQuery("/audit-events", params ?? {})),
  createStaffUser: (payload: StaffUserCreatePayload) =>
    request<AuthUser>("/users/staff", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listCatalogItems: () => request<CatalogItem[]>("/catalog"),
  createCatalogItem: (payload: CatalogItemCreatePayload) =>
    request<CatalogItem>("/catalog", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateCatalogStock: (itemId: string, payload: CatalogStockUpdatePayload) =>
    request<CatalogItem>(`/catalog/${itemId}/stock`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteCatalogItem: (itemId: string) =>
    request<void>(`/catalog/${itemId}`, {
      method: "DELETE",
    }),
  listInvoices: (options?: { limit?: number; offset?: number }) =>
    request<Invoice[]>(withQuery("/invoices", options ?? {})),
  listAllInvoices: async () => {
    const rows: Invoice[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await request<Invoice[]>(withQuery("/invoices", { limit: 500, offset }));
      rows.push(...page);
      if (page.length < 500) return rows;
    }
  },
  getSuperdashboardDashboard: () => request<SuperdashboardDashboard>("/superdashboard/dashboard"),
  getSuperdashboardTrends: () => request<SuperdashboardTrends>("/superdashboard/dashboard/trends"),
  getSuperdashboardUsageByOrg: () =>
    request<SuperdashboardUsageByOrg>("/superdashboard/dashboard/usage-by-org"),
  getSuperdashboardOnboarding: () => request<SuperdashboardOnboarding>("/superdashboard/onboarding"),
  getPlatformEmailSettings: () =>
    request<PlatformEmailSettings>("/superdashboard/settings/email"),
  testPlatformEmailSettings: (payload: { sender_email?: string; sender_email_app_password?: string }) =>
    request<{ success: boolean; message: string }>("/superdashboard/settings/email/test", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updatePlatformEmailSettings: (payload: PlatformEmailSettingsUpdatePayload) =>
    request<PlatformEmailSettings>("/superdashboard/settings/email", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  createSuperdashboardCustomer: (payload: CustomerOnboardingCreatePayload) =>
    request<CustomerOnboarding>("/superdashboard/onboarding/customers", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateSuperdashboardCustomer: (customerId: string, payload: CustomerOnboardingUpdatePayload) =>
    request<CustomerOnboarding>(`/superdashboard/onboarding/customers/${customerId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  updateSuperdashboardOrgWorkspaceMode: (orgId: string, workspaceMode: "solo" | "team") =>
    request<{ org_id: string; workspace_mode: "solo" | "team" }>(`/superdashboard/orgs/${orgId}/workspace-mode`, {
      method: "PATCH",
      body: JSON.stringify({ workspace_mode: workspaceMode }),
    }),
  updateSuperdashboardOrgUsersAllowed: (orgId: string, usersAllowed: number) =>
    request<{ org_id: string; users_allowed: number }>(`/superdashboard/orgs/${orgId}/users-allowed`, {
      method: "PATCH",
      body: JSON.stringify({ users_allowed: usersAllowed }),
    }),
  disableSuperdashboardCustomer: (customerId: string) =>
    request<CustomerOnboarding>(`/superdashboard/onboarding/customers/${customerId}/disable`, {
      method: "POST",
    }),
  listSuperdashboardOrgs: () => request<SuperuserOrgSummary[]>("/superdashboard/orgs"),
  getSuperdashboardOrgDetail: (orgId: string) => request<SuperuserOrgDetail>(`/superdashboard/orgs/${orgId}`),
  updateSuperdashboardOrgSettings: (orgId: string, payload: Partial<ClinicSettingsUpdatePayload>) =>
    request<ClinicSettings>(`/superdashboard/orgs/${orgId}/settings`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  updateSuperdashboardUserRole: (userId: string, payload: UserRoleUpdatePayload) =>
    request<SuperuserOrgUser>(`/superdashboard/users/${userId}/role`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  listPlatformErrors: (limit = 100) => request<PlatformError[]>(withQuery("/superdashboard/errors", { limit })),
  getControlRoomStatus: () => request<ControlRoomStatus>("/controlroom/status"),
  getControlRoomDatabase: () => request<ControlRoomDatabase>("/controlroom/database"),
  getControlRoomIncidents: (windowHours = 24) =>
    request<ControlRoomIncidents>(withQuery("/controlroom/incidents", { window_hours: windowHours })),
  getControlRoomRunbooks: () => request<ControlRoomRunbooks>("/controlroom/runbooks"),
  listSuperuserOrgs: () => request<SuperuserOrgSummary[]>("/superdashboard/orgs"),
  getSuperuserOrgDetail: (orgId: string) => request<SuperuserOrgDetail>(`/superdashboard/orgs/${orgId}`),
  deleteSuperuserUser: (userId: string) =>
    request<void>(`/superdashboard/users/${userId}`, {
      method: "DELETE",
    }),
  deleteSuperuserOrg: (orgId: string) =>
    request<void>(`/superdashboard/orgs/${orgId}`, {
      method: "DELETE",
    }),
  createInvoice: (payload: InvoiceCreatePayload) =>
    request<Invoice>("/invoices", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  finalizeInvoice: (payload: FinalizeInvoicePayload) =>
    request<InvoiceActionResult>("/invoices/finalize", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateInvoicePayment: (invoiceId: string, amountPaid: number) =>
    request<InvoiceActionResult>(`/invoices/${invoiceId}/payment`, {
      method: "PATCH",
      body: JSON.stringify({ amount_paid: amountPaid }),
    }),
  listCareProgramOfferings: () =>
    request<CareProgramOffering[]>("/care-programs/offerings"),
  saveMyopiaCareOffering: (payload: {
    name: string;
    description: string;
    default_price: number;
    duration_days: number;
    reviews: Array<{ key: string; label: string; offset_days: number }>;
    is_active: boolean;
  }) =>
    request<CareProgramOffering>("/care-programs/offerings/myopia-care", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  listCareProgramEnrollments: (params?: { patient_id?: string; status?: string }) =>
    request<ProgramEnrollmentSummary[]>(withQuery("/care-programs/enrollments", params ?? {})),
  getCareProgramEnrollment: (enrollmentId: string) =>
    request<ProgramEnrollment>(`/care-programs/enrollments/${enrollmentId}`),
  assignCareProgramEnrollment: (enrollmentId: string, responsibleUserId: string) =>
    request<ProgramEnrollment>(`/care-programs/enrollments/${enrollmentId}/assignee`, {
      method: "PATCH",
      body: JSON.stringify({ responsible_user_id: responsibleUserId }),
    }),
  cancelCareProgramEnrollment: (enrollmentId: string, reason: string) =>
    request<ProgramEnrollment>(`/care-programs/enrollments/${enrollmentId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  completeCareProgramReview: (enrollmentId: string, eventId: string, measurementId: string) =>
    request<ProgramEnrollment>(`/care-programs/enrollments/${enrollmentId}/reviews/${eventId}/complete`, {
      method: "POST",
      body: JSON.stringify({ myopia_measurement_id: measurementId }),
    }),
  createCareProgramReport: (enrollmentId: string, eventId: string, clinicianComment = "") =>
    request<ProgramReport>(`/care-programs/enrollments/${enrollmentId}/reviews/${eventId}/reports`, {
      method: "POST",
      body: JSON.stringify({ clinician_comment: clinicianComment }),
    }),
  getCareProgramReportPdf: (reportId: string) =>
    requestBlob(`/care-program-reports/${reportId}/pdf`),
  sendCareProgramReportWhatsApp: (reportId: string, recipientPhone?: string) =>
    request<{ success: boolean; message_id: string }>(`/care-program-reports/${reportId}/send-whatsapp`, {
      method: "POST",
      body: JSON.stringify({ recipient_phone: recipientPhone || null }),
    }),
  generateInvoicePdf: (invoiceId: string) =>
    requestBlob(`/invoices/${invoiceId}/pdf`),
  exportPatientsCsv: () => requestBlob("/exports/patients.csv"),
  exportVisitsCsv: (params?: { range?: "today" | "7d" | "30d" | "month" | "all" }) =>
    requestBlob(withQuery("/exports/visits.csv", params ?? {})),
  exportInvoicesCsv: () => requestBlob("/exports/invoices.csv"),
  sendInvoice: (payload: SendInvoicePayload) =>
    request<InvoiceActionResult>("/send-invoice", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  sendInvoiceWhatsApp: (payload: SendInvoiceWhatsAppPayload) =>
    request<InvoiceActionResult>("/send-invoice-whatsapp", {
      method: "POST",
      body: JSON.stringify(withIdempotencyKey(payload)),
    }),
  listFollowUps: (params?: {
    status?: "scheduled" | "completed" | "cancelled";
    q?: string;
    scheduled_date?: string;
    limit?: number;
  }) => request<FollowUp[]>(withQuery("/follow-ups", params ?? {})),
  listAppointments: (params?: {
    status?: "scheduled" | "checked_in" | "cancelled";
    q?: string;
    scheduled_date?: string;
    limit?: number;
  }) => request<Appointment[]>(withQuery("/appointments", params ?? {})),
  createAppointment: (payload: AppointmentCreatePayload) =>
    request<Appointment>("/appointments", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateAppointment: (appointmentId: string, payload: AppointmentUpdatePayload) =>
    request<Appointment>(`/appointments/${appointmentId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  checkInAppointment: (appointmentId: string, options?: { force_new?: boolean }) =>
    request<Patient>(`/appointments/${appointmentId}/check-in`, {
      method: "POST",
      body: JSON.stringify({ force_new: options?.force_new ?? false }),
    }),
  previewAppointmentCheckIn: (appointmentId: string) =>
    request<PatientMatch[]>(`/appointments/${appointmentId}/check-in-preview`),
  checkInAppointmentWithPatient: (appointmentId: string, existingPatientId: string) =>
    request<Patient>(`/appointments/${appointmentId}/check-in`, {
      method: "POST",
      body: JSON.stringify({ existing_patient_id: existingPatientId } satisfies AppointmentCheckInPayload),
    }),
  createFollowUp: (patientId: string, payload: FollowUpCreatePayload) =>
    request<FollowUp>(`/patients/${patientId}/follow-ups`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateFollowUp: (followUpId: string, payload: FollowUpUpdatePayload) =>
    request<FollowUp>(`/follow-ups/${followUpId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  listPatients: (options?: { activeOnly?: boolean; q?: string; limit?: number; offset?: number }) =>
    request<Patient[]>(withQuery("/patients", {
      active_only: options?.activeOnly ? "true" : undefined,
      q: options?.q,
      limit: options?.limit,
      offset: options?.offset,
    })),
  listAllPatients: async () => {
    const rows: Patient[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await request<Patient[]>(withQuery("/patients", { limit: 500, offset }));
      rows.push(...page);
      if (page.length < 500) return rows;
    }
  },
  listQueuePatients: () =>
    request<Patient[]>(withQuery("/patients", { active_only: "true", limit: 500 })),
  getPatient: (patientId: string) => request<Patient>(`/patients/${patientId}`),
  createPatient: (payload: PatientInput) =>
    request<Patient>("/patients", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  createPatientVisit: (patientId: string, payload: PatientInput) =>
    request<Patient>(`/patients/${patientId}/visits`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  lookupPatientsByPhone: (phone: string, limit = 10) =>
    request<PatientMatch[]>(withQuery("/patients/lookup", { phone, limit })),
  listPatientVisits: () => request<PatientVisit[]>("/visits"),
  updatePatientStatus: (patientId: string, status: PatientStatus) =>
    request<Patient>(`/patients/${patientId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  updateQueueOrder: (columns: Record<PatientStatus, string[]>) =>
    request<Patient[]>("/patients/queue/order", {
      method: "PUT",
      body: JSON.stringify({ columns }),
    }),
  updatePatient: (
    patientId: string,
    payload: PatientUpdatePayload,
  ) =>
    request<Patient>(`/patients/${patientId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  uploadPatientProfilePhoto: (patientId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return requestForm<Patient>(`/patients/${patientId}/profile-photo`, formData, {
      method: "POST",
    });
  },
  removePatientProfilePhoto: (patientId: string) =>
    request<Patient>(`/patients/${patientId}/profile-photo`, {
      method: "DELETE",
    }),
  getPatientProfilePhoto: (patientId: string) =>
    requestBlob(`/patients/${patientId}/profile-photo/file`),
  listPatientChartVisits: (patientId: string) =>
    request<PatientChartVisit[]>(`/patients/${patientId}/visits`),
  getPatientVisitDetail: (patientId: string, visitId: string) =>
    request<PatientVisitDetail>(`/patients/${patientId}/visits/${visitId}/details`),
  getPatientTimeline: (patientId: string) =>
    request<PatientTimelineEvent[]>(`/patients/${patientId}/timeline`),
  getPatientSummary: (patientId: string) =>
    request<PatientSummary>(`/patients/${patientId}/summary`, undefined, {
      timeoutMs: LONG_REQUEST_TIMEOUT_MS,
    }),
  regeneratePatientSummary: (patientId: string) =>
    request<PatientSummary>(`/patients/${patientId}/summary/regenerate`, {
      method: "POST",
    }, { timeoutMs: LONG_REQUEST_TIMEOUT_MS }),
  getPatientMyopiaHistory: (patientId: string) =>
    request<MyopiaHistory>(`/patients/${patientId}/myopia-history`),
  getPatientGrowthHistory: (patientId: string) =>
    request<PediatricGrowthSummary>(`/patients/${patientId}/growth-history`),
  listPatientTbiEvaluations: (patientId: string) =>
    request<TbiEvaluationRecord[]>(`/patients/${patientId}/tbi-evaluations`),
  listPatientBinocularVisionEvaluations: (patientId: string) =>
    request<BinocularVisionEvaluationRecord[]>(`/patients/${patientId}/binocular-vision-evaluations`),
  listPatientModuleEntries: (patientId: string) =>
    request<LongitudinalTrackRecord[]>(`/patients/${patientId}/module-entries`),
  createPatientModuleEntry: (patientId: string, payload: LongitudinalTrackCreatePayload) =>
    request<LongitudinalTrackRecord>(`/patients/${patientId}/module-entries`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  createPatientTbiEvaluation: (patientId: string, payload: TbiEvaluationCreatePayload) =>
    request<TbiEvaluationRecord>(`/patients/${patientId}/tbi-evaluations`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  createPatientBinocularVisionEvaluation: (patientId: string, payload: BinocularVisionEvaluationCreatePayload) =>
    request<BinocularVisionEvaluationRecord>(`/patients/${patientId}/binocular-vision-evaluations`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  createPatientMyopiaRecord: (patientId: string, payload: MyopiaMeasurementPayload) =>
    request<MyopiaMeasurementRecord>(`/patients/${patientId}/myopia-records`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  createPatientGrowthRecord: (patientId: string, payload: PediatricGrowthMeasurementPayload) =>
    request<PediatricGrowthMeasurementRecord>(`/patients/${patientId}/growth-records`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updatePatientGrowthRecord: (patientId: string, recordId: string, payload: PediatricGrowthMeasurementPayload) =>
    request<PediatricGrowthMeasurementRecord>(`/patients/${patientId}/growth-records/${recordId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  updatePatientMyopiaRecord: (patientId: string, recordId: string, payload: Partial<MyopiaMeasurementPayload>) =>
    request<MyopiaMeasurementRecord>(`/patients/${patientId}/myopia-records/${recordId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  listPatientNotes: (patientId: string) =>
    request<ConsultationNote[]>(`/patients/${patientId}/notes`),
  listPatientAttachments: (patientId: string) =>
    request<PatientAttachment[]>(`/patients/${patientId}/attachments`),
  uploadPatientAttachment: (patientId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return requestForm<PatientAttachment>(`/patients/${patientId}/attachments`, formData, {
      method: "POST",
    });
  },
  deletePatientAttachment: (patientId: string, attachmentId: string) =>
    request<PatientAttachment>(`/patients/${patientId}/attachments/${attachmentId}`, {
      method: "DELETE",
    }),
  sendPatientAttachment: (patientId: string, attachmentId: string, payload: SendPatientAttachmentPayload) =>
    request<OperationResult>(`/patients/${patientId}/attachments/${attachmentId}/send`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  downloadPatientAttachment: (attachmentId: string) =>
    requestBlob(`/attachments/${attachmentId}/file`),
  listPatientInvoices: (patientId: string) =>
    request<Invoice[]>(`/patients/${patientId}/invoices`),
  getPatientCaseStudySource: (patientId: string) =>
    request<PatientCaseStudySource>(`/patients/${patientId}/case-study-source`),
  listCaseStudies: () =>
    request<CaseStudy[]>("/case-studies"),
  getCaseStudy: (caseStudyId: string) =>
    request<CaseStudy>(`/case-studies/${caseStudyId}`),
  generateCaseStudy: (payload: GenerateCaseStudyPayload) =>
    request<GenerateCaseStudyResponse>("/generate-case-study", {
      method: "POST",
      body: JSON.stringify(payload),
    }, { timeoutMs: LONG_REQUEST_TIMEOUT_MS }),
  createCaseStudy: (payload: CaseStudySavePayload) =>
    request<CaseStudy>("/case-studies", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateCaseStudy: (caseStudyId: string, payload: Partial<CaseStudySavePayload>) =>
    request<CaseStudy>(`/case-studies/${caseStudyId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  generateCaseStudyPdf: (caseStudyId: string) =>
    requestBlob(`/case-studies/${caseStudyId}/pdf`),
  generateNote: (payload: GenerateNotePayload) =>
    request<GenerateNoteResponse>("/generate-note", {
      method: "POST",
      body: JSON.stringify(payload),
    }, { timeoutMs: LONG_REQUEST_TIMEOUT_MS }),
  getNoteBillingSuggestions: (noteId: string) =>
    request<BillingSuggestionsResponse>(`/notes/${noteId}/billing-suggestions`),
  generateClinicalQuestions: (payload: ClinicalQuestionsPayload) =>
    request<ClinicalQuestionsResponse>("/ai/clinical-questions", {
      method: "POST",
      body: JSON.stringify(payload),
    }, { timeoutMs: LONG_REQUEST_TIMEOUT_MS }),
  generateClinicalAnalysis: (payload: ClinicalAnalysisPayload) =>
    request<ClinicalAnalysisResponse>("/ai/clinical-analysis", {
      method: "POST",
      body: JSON.stringify(payload),
    }, { timeoutMs: LONG_REQUEST_TIMEOUT_MS }),
  finalizeNote: (noteId: string) =>
    request<ConsultationNote>("/notes/finalize", {
      method: "POST",
      body: JSON.stringify({ note_id: noteId } satisfies FinalizeNotePayload),
    }),
  updateNoteDraft: (noteId: string, payload: UpdateNoteDraftPayload) =>
    request<ConsultationNote>(`/notes/${noteId}/draft`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  finalizeMobileConsultation: (patientId: string, noteId: string) =>
    request<MobileFinalizeConsultationResponse>("/mobile/consultations/finalize", {
      method: "POST",
      body: JSON.stringify({ patient_id: patientId, note_id: noteId } satisfies MobileFinalizeConsultationPayload),
    }),
  generateLetter: (payload: GenerateLetterPayload) =>
    request<GenerateLetterResponse>("/generate-letter", {
      method: "POST",
      body: JSON.stringify(payload),
    }, { timeoutMs: LONG_REQUEST_TIMEOUT_MS }),
  generateParentHandout: (payload: GenerateParentHandoutPayload) =>
    request<GenerateParentHandoutResponse>("/generate-parent-handout", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  generateNotePdf: (payload: GeneratePdfPayload) =>
    requestBlob("/generate-note-pdf", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  generateSavedNotePdf: (noteId: string) =>
    requestBlob(`/notes/${noteId}/pdf`),
  generateLetterPdf: (payload: GenerateLetterPdfPayload) =>
    requestBlob("/generate-letter-pdf", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  sendLetter: (payload: SendLetterPayload) =>
    request<OperationResult>("/send-letter", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  sendLetterWhatsApp: (payload: SendLetterWhatsAppPayload) =>
    request<OperationResult>("/send-letter-whatsapp", {
      method: "POST",
      body: JSON.stringify(withIdempotencyKey(payload)),
    }),
  getClinicSettings: () => request<ClinicSettings>("/settings/clinic"),
  getCheckInConfig: () => request<CheckInConfig>("/check-in/config"),
  updateCheckInConfig: (enabled: boolean) =>
    request<CheckInConfig>("/check-in/config", {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  regenerateCheckInConfig: () =>
    request<CheckInConfig>("/check-in/config/regenerate", { method: "POST" }),
  listCheckInRequests: () => request<CheckInRequest[]>("/check-in/requests"),
  approveCheckInRequest: (
    requestId: string,
    payload: { existing_patient_id?: string | null; force_new: boolean },
  ) =>
    request<Patient>(`/check-in/requests/${requestId}/approve`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  rejectCheckInRequest: (requestId: string, reason = "") =>
    request<CheckInRequest>(`/check-in/requests/${requestId}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  updateClinicSettings: (payload: ClinicSettingsUpdatePayload) =>
    request<ClinicSettings>("/settings/clinic", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  completeClinicOnboarding: () =>
    request<ClinicSettings>("/settings/clinic/onboarding/complete", {
      method: "POST",
    }),
  uploadClinicDocumentTemplate: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return requestForm<ClinicSettings>("/settings/clinic/document-template", formData, {
      method: "POST",
    });
  },
  downloadClinicDocumentTemplate: () =>
    requestBlob("/settings/clinic/document-template/file"),
  previewClinicDocumentTemplateNote: () =>
    requestBlob("/settings/clinic/document-template/preview-note"),
  removeClinicDocumentTemplate: () =>
    request<ClinicSettings>("/settings/clinic/document-template", {
      method: "DELETE",
    }),
  sendNote: (payload: SendNotePayload) =>
    request<OperationResult>("/send-note", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  sendNoteWhatsApp: (payload: SendNoteWhatsAppPayload) =>
    request<OperationResult>("/send-note-whatsapp", {
      method: "POST",
      body: JSON.stringify(withIdempotencyKey(payload)),
    }),
  getWhatsAppDocumentDelivery: (documentType: string, documentId: string) =>
    request<WhatsAppDelivery>(
      `/whatsapp/document-deliveries/${encodeURIComponent(documentType)}/${encodeURIComponent(documentId)}`,
    ),
};
