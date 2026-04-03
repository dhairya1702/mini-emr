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
