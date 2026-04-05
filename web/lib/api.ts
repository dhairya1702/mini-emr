import { authStorage } from "@/lib/auth";
import {
  AuthResponse,
  AuthUser,
  ClinicSettings,
  GenerateLetterPayload,
  GenerateNotePayload,
  Patient,
  PatientStatus,
  RegisterPayload,
} from "@/lib/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = authStorage.getToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const raw = await response.text();
    let message = "Request failed.";

    try {
      const parsed = JSON.parse(raw) as {
        detail?: string | Array<{ msg?: string }>;
      };
      if (typeof parsed.detail === "string") {
        message = parsed.detail;
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

  return response.json();
}

async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  const token = authStorage.getToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

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
  createStaffUser: (payload: { identifier: string; password: string }) =>
    request<AuthUser>("/users/staff", {
      method: "POST",
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
