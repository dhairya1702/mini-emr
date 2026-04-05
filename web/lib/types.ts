export type PatientStatus = "waiting" | "consultation" | "done";

export interface Patient {
  id: string;
  name: string;
  phone: string;
  reason: string;
  age: number | null;
  weight: number | null;
  height: number | null;
  temperature: number | null;
  status: PatientStatus;
  created_at: string;
}

export interface GenerateNotePayload {
  patient_id?: string;
  symptoms: string;
  diagnosis: string;
  medications: string;
  notes: string;
}

export interface GenerateLetterPayload {
  to: string;
  subject: string;
  content: string;
}

export interface ClinicSettings {
  id: string;
  org_id: string;
  clinic_name: string;
  clinic_address: string;
  clinic_phone: string;
  doctor_name: string;
  custom_header: string;
  custom_footer: string;
  updated_at: string | null;
}

export type UserRole = "admin" | "staff";

export interface AuthUser {
  id: string;
  org_id: string;
  name: string;
  identifier: string;
  role: UserRole;
  created_at: string;
}

export interface RegisterPayload {
  identifier: string;
  password: string;
  clinic_name: string;
  clinic_address: string;
  clinic_phone: string;
  doctor_name: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}
