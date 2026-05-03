export function formatMillimeterDelta(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)} mm`;
}

export function formatMillimeterValue(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${value.toFixed(2)} mm`;
}

export function estimateUntreatedAnnualElongation(ageYears: number) {
  if (ageYears < 9) return 0.22;
  if (ageYears < 10) return 0.20;
  if (ageYears < 11) return 0.18;
  if (ageYears < 12) return 0.16;
  if (ageYears < 13) return 0.14;
  if (ageYears < 14) return 0.12;
  if (ageYears < 15) return 0.10;
  return 0.08;
}

export function estimateTreatmentEffectiveness(treatmentType: string) {
  const normalized = treatmentType.trim().toLowerCase();
  if (!normalized || normalized === "observation" || normalized === "none") {
    return 0;
  }
  if (normalized.includes("dims")) return 0.50;
  if (normalized.includes("ortho")) return 0.45;
  if (normalized.includes("misight")) return 0.45;
  if (normalized.includes("multifocal")) return 0.40;
  if (normalized.includes("atropine 0.05")) return 0.55;
  if (normalized.includes("atropine 0.025")) return 0.45;
  if (normalized.includes("atropine 0.01")) return 0.30;
  if (normalized.includes("atropine")) return 0.35;
  return 0.25;
}

export function formatLocalDateTimeInput(value?: Date) {
  const date = value ?? new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
