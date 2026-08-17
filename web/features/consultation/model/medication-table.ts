import type { ClinicalExtractions } from "@/lib/types";

export const MEDICATION_TABLE_HEADER = "Medicine | Strength | Dose | Route | Schedule | Duration | Quantity | Instructions";
export const MEDICATION_TABLE_SEPARATOR = "--- | --- | --- | --- | --- | --- | --- | ---";

function noteTableCell(value: string | number | null | undefined) {
  const cleaned = String(value ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
  return cleaned || "—";
}

export function syncDraftMedicationTable(content: string, extractions: ClinicalExtractions) {
  const medicines = extractions.medications_prescribed || [];
  const contentWithoutMedicationTable = content
    .replace(/\n\nMedications Prescribed:\n[\s\S]*?(?=\n\nFollow-up Advice:\n|$)/, "")
    .trim();

  if (!medicines.length) {
    return contentWithoutMedicationTable;
  }

  const medicineRows = medicines.map((medicine) => (
    [
      medicine.name,
      medicine.strength,
      medicine.dose,
      medicine.route,
      medicine.schedule,
      medicine.duration,
      medicine.quantity,
      medicine.instructions,
    ].map(noteTableCell).join(" | ")
  ));
  const medicationSection = [
    "Medications Prescribed:",
    MEDICATION_TABLE_HEADER,
    MEDICATION_TABLE_SEPARATOR,
    ...medicineRows,
  ].join("\n");

  const followUpMatch = contentWithoutMedicationTable.match(/\n\nFollow-up Advice:\n/);
  if (!followUpMatch || followUpMatch.index === undefined) {
    return `${contentWithoutMedicationTable}\n\n${medicationSection}`.trim();
  }

  return [
    contentWithoutMedicationTable.slice(0, followUpMatch.index).trim(),
    medicationSection,
    contentWithoutMedicationTable.slice(followUpMatch.index + 2).trim(),
  ].filter(Boolean).join("\n\n");
}

export function normalizePrescriptionNotes(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function togglePrescriptionNoteValue(currentValue: string, option: string) {
  const current = normalizePrescriptionNotes(currentValue);
  if (current.includes(option)) {
    return current.filter((entry) => entry !== option).join(", ");
  }
  return [...current, option].join(", ");
}
