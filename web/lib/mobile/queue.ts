import type { Patient } from "@/lib/types";

export const mobileQueueStatuses = new Set(["waiting", "consultation"]);

export function isMobileQueuePatient(patient: Patient) {
  return mobileQueueStatuses.has(patient.status);
}

export function getMobileQueuePatients(patients: Patient[]) {
  return patients
    .filter(isMobileQueuePatient)
    .sort((left, right) => {
      const rightTime = Date.parse(right.last_visit_at || right.created_at || "");
      const leftTime = Date.parse(left.last_visit_at || left.created_at || "");
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    });
}
