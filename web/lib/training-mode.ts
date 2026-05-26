import { AuthUser, GenerateNotePayload, Patient, PatientStatus, PatientTimelineEvent } from "@/lib/types";

const TRAINING_MODE_PREFIX = "clinic_training_mode_v1";
const TRAINING_PATIENTS_PREFIX = "clinic_training_patients_v1";
const TRAINING_QUEUE_ORDER_PREFIX = "clinic_training_queue_order_v1";

export function createTrainingScope(user: AuthUser | null) {
  if (!user) {
    return null;
  }
  return `${user.org_id}:${user.id}`;
}

function storageKey(prefix: string, scope: string) {
  return `${prefix}:${scope}`;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function readTrainingMode(scope: string | null) {
  if (!scope || typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(storageKey(TRAINING_MODE_PREFIX, scope)) === "true";
}

export function writeTrainingMode(scope: string | null, enabled: boolean) {
  if (!scope || typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(storageKey(TRAINING_MODE_PREFIX, scope), enabled ? "true" : "false");
}

export function trainingPatientsStorageKey(scope: string) {
  return storageKey(TRAINING_PATIENTS_PREFIX, scope);
}

export function trainingQueueOrderStorageKey(scope: string) {
  return storageKey(TRAINING_QUEUE_ORDER_PREFIX, scope);
}

export function readTrainingPatients(scope: string | null) {
  if (!scope) {
    return [];
  }
  const patients = readJson<Patient[]>(trainingPatientsStorageKey(scope), []);
  return patients.filter((patient) => patient && typeof patient.id === "string");
}

export function writeTrainingPatients(scope: string | null, patients: Patient[]) {
  if (!scope) {
    return;
  }
  writeJson(trainingPatientsStorageKey(scope), patients);
}

export function resetTrainingData(scope: string | null) {
  if (!scope || typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(trainingPatientsStorageKey(scope));
  window.localStorage.removeItem(trainingQueueOrderStorageKey(scope));
}

export function createTrainingPatient(payload: {
  id?: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  reason: string;
  age: number | null;
  weight: number | null;
  height: number | null;
  temperature: number | null;
  status?: PatientStatus;
}) {
  const now = new Date().toISOString();
  return {
    id: payload.id ?? createTrainingId("patient"),
    created_at: now,
    last_visit_at: now,
    status: payload.status ?? "waiting",
    billed: false,
    name: payload.name,
    phone: payload.phone,
    email: payload.email,
    address: payload.address,
    reason: payload.reason,
    age: payload.age,
    weight: payload.weight,
    height: payload.height,
    temperature: payload.temperature,
  } satisfies Patient;
}

export function createTrainingId(prefix: string) {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return `training-${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `training-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createTrainingTimeline(patient: Patient): PatientTimelineEvent[] {
  const events: PatientTimelineEvent[] = [
    {
      id: `${patient.id}:created`,
      type: "patient_created",
      title: "Training patient added",
      timestamp: patient.created_at,
      description: `${patient.name} was added inside Training Mode.`,
      entity_type: "training_patient",
      entity_id: patient.id,
    },
  ];

  if (patient.status === "consultation" || patient.status === "done") {
    events.push({
      id: `${patient.id}:visit`,
      type: "visit_recorded",
      title: "Practice visit started",
      timestamp: patient.last_visit_at,
      description: patient.reason || "Training visit recorded.",
      entity_type: "training_visit",
      entity_id: patient.id,
    });
  }

  if (patient.status === "done") {
    events.push({
      id: `${patient.id}:done`,
      type: "consultation_note",
      title: "Practice consultation completed",
      timestamp: new Date().toISOString(),
      description: "This event exists only in Training Mode.",
      entity_type: "training_note",
      entity_id: patient.id,
    });
  }

  return events;
}

export function createTrainingNote(payload: GenerateNotePayload) {
  const sections = [
    "TRAINING MODE NOTE",
    "",
    "Subjective",
    payload.symptoms.trim() || "No symptoms entered.",
    "",
    "Assessment",
    payload.diagnosis.trim() || "No diagnosis entered.",
    "",
    "Plan",
    payload.medications.trim() || "No medicines entered.",
    payload.notes.trim() ? `Notes: ${payload.notes.trim()}` : "No additional notes entered.",
  ];

  return {
    noteId: payload.note_id || createTrainingId("note"),
    content: sections.join("\n"),
    status: "final" as const,
  };
}
