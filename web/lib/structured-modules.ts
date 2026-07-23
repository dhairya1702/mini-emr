import type { EyeExamEntry, LongitudinalTrackRecord } from "@/lib/types";
import type { SpecialtyModuleKey } from "@/lib/specialty";

export const MODULE_LABELS: Record<SpecialtyModuleKey, string> = {
  eye_exam: "Refraction",
  contact_lens: "Contact lens",
  binocular_vision: "Binocular vision",
  low_vision: "Low vision",
  myopia_management: "Myopia",
  tbi_evaluation: "Neurovision / TBI",
  pediatric_growth_measurement: "Growth",
  well_child_visit: "Well-child",
  parent_handout_request: "Parent handout",
  pediatric_follow_up_plan: "Pediatric follow-up",
};

export function moduleLabel(moduleKey: SpecialtyModuleKey) {
  return MODULE_LABELS[moduleKey] ?? moduleKey.replaceAll("_", " ");
}

export function createEmptyEyeExam(): EyeExamEntry[] {
  return [
    { eye: "right", sphere: "", cylinder: "", axis: "", vision: "" },
    { eye: "left", sphere: "", cylinder: "", axis: "", vision: "" },
  ];
}

export function hasEyeExamData(entries: EyeExamEntry[]) {
  return entries.some((entry) =>
    entry.sphere.trim() ||
    entry.cylinder.trim() ||
    entry.axis.trim() ||
    entry.vision.trim(),
  );
}

export function buildEyeExamSummary(entries: EyeExamEntry[]) {
  const parts = entries
    .filter((entry) => entry.sphere.trim() || entry.cylinder.trim() || entry.axis.trim() || entry.vision.trim())
    .map((entry) => {
      const eye = entry.eye === "right" ? "OD" : "OS";
      const refraction = [entry.sphere, entry.cylinder, entry.axis ? `x ${entry.axis}` : ""]
        .map((value) => value.trim())
        .filter(Boolean)
        .join(" ");
      return [eye, refraction, entry.vision.trim() ? `VA ${entry.vision.trim()}` : ""].filter(Boolean).join(" ");
    });
  return parts.join(" · ") || "Refraction saved.";
}

export function formatModuleSummary(entry: LongitudinalTrackRecord) {
  const summary = entry.summary_fields?.summary;
  if (typeof summary === "string" && summary.trim()) {
    return summary.trim();
  }
  const result = entry.summary_fields?.result;
  if (typeof result === "string" && result.trim()) {
    return result.trim();
  }
  return `${moduleLabel(entry.track_type as SpecialtyModuleKey)} saved.`;
}

export function moduleEntriesFor(moduleEntries: LongitudinalTrackRecord[], moduleKey: SpecialtyModuleKey) {
  return moduleEntries
    .filter((entry) => entry.track_type === moduleKey)
    .sort((left, right) => new Date(right.measured_at).getTime() - new Date(left.measured_at).getTime());
}

export function genericStructuredSummary(payload: Record<string, unknown>) {
  const summary = payload.summary;
  if (typeof summary === "string" && summary.trim()) {
    return summary.trim();
  }
  const notes = payload.notes;
  if (typeof notes === "string" && notes.trim()) {
    return notes.trim();
  }
  return "Evaluation saved.";
}
