import { authStorage, SESSION_EXPIRED_MESSAGE } from "@/lib/auth";
import {
  AuditEvent,
  Appointment,
  AppointmentCheckInPayload,
  AppointmentCreatePayload,
  AppointmentUpdatePayload,
  ConsultationNote,
  AuthResponse,
  AuthUser,
  CatalogItem,
  CatalogItemCreatePayload,
  CatalogStockUpdatePayload,
  ClinicSettings,
  ClinicSettingsUpdatePayload,
  FinalizeNotePayload,
  FollowUp,
  FollowUpCreatePayload,
  FollowUpUpdatePayload,
  GenerateLetterPayload,
  GenerateLetterResponse,
  GenerateLetterPdfPayload,
  GeneratePdfPayload,
  Invoice,
  InvoiceCreatePayload,
  GenerateNotePayload,
  GenerateNoteResponse,
  OperationResult,
  Patient,
  PatientInput,
  PatientMatch,
  PatientVisit,
  PatientTimelineEvent,
  PatientStatus,
  RegisterPayload,
  SendInvoicePayload,
  SendLetterPayload,
  SendNotePayload,
  StaffUserCreatePayload,
} from "@/lib/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8001";
const REQUEST_TIMEOUT_MS = 15000;
const SESSION_TOKEN_HEADER = "x-session-token";
const SESSION_EXPIRES_AT_HEADER = "x-session-expires-at";

function shouldAttachAuth(path: string) {
  return path !== "/auth/login" && path !== "/auth/register";
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

function getActiveToken(path: string) {
  if (!shouldAttachAuth(path)) {
    return "";
  }
  if (authStorage.clearExpiredSession()) {
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }
  return authStorage.getToken();
}

function syncSessionFromResponse(response: Response) {
  const refreshedToken = response.headers.get(SESSION_TOKEN_HEADER);
  const refreshedExpiry = response.headers.get(SESSION_EXPIRES_AT_HEADER);
  if (refreshedToken) {
    authStorage.setToken(refreshedToken);
  }
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

function createTimeoutSignal() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return {
    signal: controller.signal,
    cleanup: () => window.clearTimeout(timeoutId),
  };
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { token, headers } = buildRequestHeaders(path, init);
  const timeout = typeof window !== "undefined" ? createTimeoutSignal() : null;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      ...(timeout ? { signal: timeout.signal } : {}),
      credentials: "include",
      headers,
      cache: "no-store",
    });
  } catch (error) {
    timeout?.cleanup();
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Check the backend and refresh.");
    }
    throw error;
  }
  timeout?.cleanup();
  syncSessionFromResponse(response);

  if (!response.ok) {
    const raw = await response.text();
    let message = "Request failed.";

    try {
      const parsed = JSON.parse(raw) as {
        detail?: string | Array<{ msg?: string }> | { message?: string };
      };
      if (typeof parsed.detail === "string") {
        message = parsed.detail;
      } else if (parsed.detail && typeof parsed.detail === "object" && "message" in parsed.detail) {
        message = parsed.detail.message || message;
      } else if (Array.isArray(parsed.detail) && parsed.detail[0]?.msg) {
        message = parsed.detail[0].msg as string;
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
      if (!currentToken || currentToken === token) {
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

async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  const { token, headers } = buildRequestHeaders(path, init);
  const timeout = typeof window !== "undefined" ? createTimeoutSignal() : null;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      ...(timeout ? { signal: timeout.signal } : {}),
      credentials: "include",
      headers,
      cache: "no-store",
    });
  } catch (error) {
    timeout?.cleanup();
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Check the backend and refresh.");
    }
    throw error;
  }
  timeout?.cleanup();
  syncSessionFromResponse(response);

  if (!response.ok) {
    const raw = await response.text();
    const message = raw || "Request failed.";
    if (isSessionErrorMessage(message)) {
      const currentToken = authStorage.getToken();
      if (!currentToken || currentToken === token) {
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

async function requestForm<T>(path: string, formData: FormData, init?: RequestInit): Promise<T> {
  const { token, headers } = buildRequestHeaders(path, init, { includeJsonContentType: false });
  const timeout = typeof window !== "undefined" ? createTimeoutSignal() : null;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      ...(timeout ? { signal: timeout.signal } : {}),
      body: formData,
      credentials: "include",
      headers,
      cache: "no-store",
    });
  } catch (error) {
    timeout?.cleanup();
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Check the backend and refresh.");
    }
    throw error;
  }
  timeout?.cleanup();
  syncSessionFromResponse(response);

  if (!response.ok) {
    const raw = await response.text();
    const message = raw || "Request failed.";
    if (isSessionErrorMessage(message)) {
      const currentToken = authStorage.getToken();
      if (!currentToken || currentToken === token) {
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
  listUsers: () => request<AuthUser[]>("/users"),
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
  listInvoices: () => request<Invoice[]>("/invoices"),
  createInvoice: (payload: InvoiceCreatePayload) =>
    request<Invoice>("/invoices", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  generateInvoicePdf: (invoiceId: string) =>
    requestBlob(`/invoices/${invoiceId}/pdf`),
  exportPatientsCsv: () => requestBlob("/exports/patients.csv"),
  exportVisitsCsv: (params?: { range?: "today" | "7d" | "30d" | "month" | "all" }) =>
    requestBlob(withQuery("/exports/visits.csv", params ?? {})),
  exportInvoicesCsv: () => requestBlob("/exports/invoices.csv"),
  sendInvoice: (payload: SendInvoicePayload) =>
    request<OperationResult>("/send-invoice", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listFollowUps: (params?: {
    status?: "scheduled" | "completed" | "cancelled";
    q?: string;
    limit?: number;
  }) => request<FollowUp[]>(withQuery("/follow-ups", params ?? {})),
  listAppointments: (params?: {
    status?: "scheduled" | "checked_in" | "cancelled";
    q?: string;
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
  listPatients: () => request<Patient[]>("/patients"),
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
  updatePatient: (
    patientId: string,
    payload: Pick<
      Patient,
      "name" | "phone" | "reason" | "age" | "weight" | "height" | "temperature"
    >,
  ) =>
    request<Patient>(`/patients/${patientId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  getPatientTimeline: (patientId: string) =>
    request<PatientTimelineEvent[]>(`/patients/${patientId}/timeline`),
  listPatientNotes: (patientId: string) =>
    request<ConsultationNote[]>(`/patients/${patientId}/notes`),
  listPatientInvoices: (patientId: string) =>
    request<Invoice[]>(`/patients/${patientId}/invoices`),
  generateNote: (payload: GenerateNotePayload) =>
    request<GenerateNoteResponse>("/generate-note", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  finalizeNote: (noteId: string) =>
    request<ConsultationNote>("/notes/finalize", {
      method: "POST",
      body: JSON.stringify({ note_id: noteId } satisfies FinalizeNotePayload),
    }),
  generateLetter: (payload: GenerateLetterPayload) =>
    request<GenerateLetterResponse>("/generate-letter", {
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
  getClinicSettings: () => request<ClinicSettings>("/settings/clinic"),
  updateClinicSettings: (payload: ClinicSettingsUpdatePayload) =>
    request<ClinicSettings>("/settings/clinic", {
      method: "PUT",
      body: JSON.stringify(payload),
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
  removeClinicDocumentTemplate: () =>
    request<ClinicSettings>("/settings/clinic/document-template", {
      method: "DELETE",
    }),
  sendNote: (payload: SendNotePayload) =>
    request<OperationResult>("/send-note", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
