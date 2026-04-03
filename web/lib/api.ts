import { GenerateNotePayload, Patient, PatientStatus } from "@/lib/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
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
  generateNotePdf: (payload: { patient_id: string; content: string }) =>
    requestBlob("/generate-note-pdf", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  sendNote: (payload: { patient_id: string; phone: string; content: string }) =>
    request<{ success: boolean; message: string }>("/send-note", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
