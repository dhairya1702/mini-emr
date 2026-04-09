import { authStorage } from "@/lib/auth";
import {
  AuditEvent,
  Appointment,
  AuthResponse,
  AuthUser,
  CatalogItem,
  ClinicSettings,
  FollowUp,
  GenerateLetterPayload,
  Invoice,
  GenerateNotePayload,
  Patient,
  PatientMatch,
  PatientTimelineEvent,
  PatientStatus,
  RegisterPayload,
} from "@/lib/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8001";
const REQUEST_TIMEOUT_MS = 15000;

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = authStorage.getToken();
  const timeout = typeof window !== "undefined" ? createTimeoutSignal() : null;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      ...(timeout ? { signal: timeout.signal } : {}),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...((init?.headers as Record<string, string> | undefined) || {}),
      },
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

    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  const token = authStorage.getToken();
  const timeout = typeof window !== "undefined" ? createTimeoutSignal() : null;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      ...(timeout ? { signal: timeout.signal } : {}),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...((init?.headers as Record<string, string> | undefined) || {}),
      },
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

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(raw || "Request failed.");
  }

  return response.blob();
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
  getCurrentUser: () => request<AuthUser>("/auth/me"),
  listUsers: () => request<AuthUser[]>("/users"),
  listAuditEvents: (params?: { limit?: number }) =>
    request<AuditEvent[]>(withQuery("/audit-events", params ?? {})),
  createStaffUser: (payload: { identifier: string; password: string }) =>
    request<AuthUser>("/users/staff", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listCatalogItems: () => request<CatalogItem[]>("/catalog"),
  createCatalogItem: (payload: {
    name: string;
    item_type: "service" | "medicine";
    default_price: number;
    track_inventory: boolean;
    stock_quantity: number;
    low_stock_threshold: number;
    unit: string;
  }) =>
    request<CatalogItem>("/catalog", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateCatalogStock: (itemId: string, payload: { delta: number }) =>
    request<CatalogItem>(`/catalog/${itemId}/stock`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteCatalogItem: (itemId: string) =>
    request<void>(`/catalog/${itemId}`, {
      method: "DELETE",
    }),
  listInvoices: () => request<Invoice[]>("/invoices"),
  createInvoice: (payload: {
    patient_id: string;
    items: Array<{
      catalog_item_id?: string | null;
      item_type: "service" | "medicine";
      label: string;
      quantity: number;
      unit_price: number;
    }>;
    payment_status: "paid";
  }) =>
    request<Invoice>("/invoices", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  generateInvoicePdf: (invoiceId: string) =>
    requestBlob(`/invoices/${invoiceId}/pdf`),
  sendInvoice: (payload: { invoice_id: string; recipient: string }) =>
    request<{ success: boolean; message: string }>("/send-invoice", {
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
  createAppointment: (payload: {
    name: string;
    phone: string;
    reason: string;
    age: number | null;
    weight: number | null;
    height: number | null;
    temperature: number | null;
    scheduled_for: string;
  }) =>
    request<Appointment>("/appointments", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateAppointment: (appointmentId: string, payload: {
    scheduled_for?: string;
    status?: "scheduled" | "checked_in" | "cancelled";
  }) =>
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
      body: JSON.stringify({ existing_patient_id: existingPatientId }),
    }),
  createFollowUp: (
    patientId: string,
    payload: { scheduled_for: string; notes: string },
  ) =>
    request<FollowUp>(`/patients/${patientId}/follow-ups`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateFollowUp: (followUpId: string, payload: {
    status?: "scheduled" | "completed" | "cancelled";
    scheduled_for?: string;
    notes?: string;
  }) =>
    request<FollowUp>(`/follow-ups/${followUpId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  listPatients: () => request<Patient[]>("/patients"),
  createPatient: (
    payload: Pick<
      Patient,
      "name" | "phone" | "reason" | "age" | "weight" | "height" | "temperature"
    >,
  ) =>
    request<Patient>("/patients", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  lookupPatientsByPhone: (phone: string, limit = 10) =>
    request<PatientMatch[]>(withQuery("/patients/lookup", { phone, limit })),
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
  generateNote: (payload: GenerateNotePayload) =>
    request<{ content: string }>("/generate-note", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  generateLetter: (payload: GenerateLetterPayload) =>
    request<{ content: string }>("/generate-letter", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  generateNotePdf: (payload: { patient_id: string; content: string }) =>
    requestBlob("/generate-note-pdf", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  generateLetterPdf: (payload: { content: string }) =>
    requestBlob("/generate-letter-pdf", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  sendLetter: (payload: { recipient: string; content: string }) =>
    request<{ success: boolean; message: string }>("/send-letter", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getClinicSettings: () => request<ClinicSettings>("/settings/clinic"),
  updateClinicSettings: (
    payload: Omit<ClinicSettings, "id" | "org_id" | "updated_at">,
  ) =>
    request<ClinicSettings>("/settings/clinic", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  sendNote: (payload: { patient_id: string; phone: string; content: string }) =>
    request<{ success: boolean; message: string }>("/send-note", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
