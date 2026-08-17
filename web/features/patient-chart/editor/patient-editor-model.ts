import type { Patient, SexAtBirth } from "@/lib/types";

export type PatientEditForm = {
  name: string;
  phone: string;
  email: string;
  address: string;
  reason: string;
  dateOfBirth: string;
  sexAtBirth: "" | SexAtBirth;
  genderIdentity: string;
  weight: string;
  height: string;
  temperature: string;
};

export type PatientEditSavePayload = {
  name: string;
  phone: string;
  email: string;
  address: string;
  reason: string;
  date_of_birth?: string | null;
  sex_at_birth?: SexAtBirth | null;
  gender_identity?: string;
  age: number | null;
  weight: number | null;
  height: number | null;
  temperature: number | null;
};

export function createPatientEditForm(patient: Patient | null): PatientEditForm {
  return {
    name: patient?.name ?? "",
    phone: patient?.phone ?? "",
    email: patient?.email ?? "",
    address: patient?.address ?? "",
    reason: patient?.reason ?? "",
    dateOfBirth: patient?.date_of_birth ?? "",
    sexAtBirth: patient?.sex_at_birth ?? "",
    genderIdentity: patient?.gender_identity ?? "",
    weight: patient?.weight?.toString() ?? "",
    height: patient?.height?.toString() ?? "",
    temperature: patient?.temperature?.toString() ?? "",
  };
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function buildPatientEditPayload(form: PatientEditForm): { payload: PatientEditSavePayload | null; error: string } {
  const weight = form.weight.trim() ? Number(form.weight) : null;
  const temperature = form.temperature.trim() ? Number(form.temperature) : null;
  const height = form.height.trim() ? Number(form.height) : null;
  const normalizedEmail = form.email.trim().toLowerCase();

  if (!form.name.trim()) return { payload: null, error: "Name is required." };
  if (phoneDigits(form.phone).length !== 10) return { payload: null, error: "Phone number must be exactly 10 digits." };
  if (!form.reason.trim()) return { payload: null, error: "Reason for visit is required." };
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { payload: null, error: "Enter a valid email address." };
  }
  if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) {
    return { payload: null, error: "Enter a valid weight." };
  }
  if (temperature !== null && (!Number.isFinite(temperature) || temperature < 90 || temperature > 110)) {
    return { payload: null, error: "Enter a valid temperature in F." };
  }
  if (height !== null && (!Number.isFinite(height) || height <= 0)) {
    return { payload: null, error: "Enter a valid height." };
  }

  return {
    error: "",
    payload: {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: normalizedEmail,
      address: form.address.trim(),
      reason: form.reason.trim(),
      date_of_birth: form.dateOfBirth || null,
      sex_at_birth: form.sexAtBirth || null,
      gender_identity: form.genderIdentity.trim(),
      age: null,
      weight,
      height,
      temperature,
    },
  };
}
