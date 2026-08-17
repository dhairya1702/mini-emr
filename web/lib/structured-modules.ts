import type {
  EyeExamEntry,
  EyeExamPayload,
  EyeExamRow,
  EyeExamSection,
  LongitudinalTrackRecord,
} from "@/lib/types";
import type { SpecialtyModuleKey } from "@/lib/specialty";

export const MODULE_LABELS: Record<SpecialtyModuleKey, string> = {
  eye_exam: "Eye Exam",
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

export const EYE_EXAM_SECTIONS: Array<{
  key: EyeExamSection;
  label: string;
  rows: EyeExamRow[];
}> = [
  { key: "objective", label: "Objective", rows: ["right", "left"] },
  { key: "subjective", label: "Subjective", rows: ["right", "left", "distance", "near"] },
  { key: "cycloplegic_dilated", label: "Cycloplegic/Dilated", rows: ["right", "left", "distance", "near"] },
];

function emptyEyeExamEntry(eye: EyeExamRow): EyeExamEntry {
  return { eye, sphere: "", cylinder: "", axis: "", vision: "" };
}

export function createEmptyEyeExam(): EyeExamPayload {
  return {
    version: 2,
    case_sheet: {},
    objective: (["right", "left"] as EyeExamRow[]).map(emptyEyeExamEntry),
    subjective: (["right", "left", "distance", "near"] as EyeExamRow[]).map(emptyEyeExamEntry),
    cycloplegic_dilated: (["right", "left", "distance", "near"] as EyeExamRow[]).map(emptyEyeExamEntry),
  };
}

function normalizeEyeExamSection(raw: unknown, rows: EyeExamRow[]) {
  const entries = Array.isArray(raw) ? raw : [];
  return rows.map((eye) => {
    const saved = entries.find((candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      "eye" in candidate &&
      (candidate as { eye?: unknown }).eye === eye,
    );
    if (!saved || typeof saved !== "object") {
      return emptyEyeExamEntry(eye);
    }
    const candidate = saved as Partial<EyeExamEntry>;
    return {
      eye,
      sphere: typeof candidate.sphere === "string" ? candidate.sphere : "",
      cylinder: typeof candidate.cylinder === "string" ? candidate.cylinder : "",
      axis: typeof candidate.axis === "string" ? candidate.axis : "",
      vision: typeof candidate.vision === "string" ? candidate.vision : "",
    };
  });
}

export function normalizeEyeExamPayload(raw: unknown): EyeExamPayload {
  const payload = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const legacyEntries = Array.isArray(raw)
    ? raw
    : Array.isArray(payload.entries)
      ? payload.entries
      : [];
  return {
    version: 2,
    case_sheet: payload.case_sheet && typeof payload.case_sheet === "object" && !Array.isArray(payload.case_sheet)
      ? { ...(payload.case_sheet as Record<string, unknown>) }
      : {},
    objective: normalizeEyeExamSection(payload.objective ?? legacyEntries, ["right", "left"]),
    subjective: normalizeEyeExamSection(payload.subjective, ["right", "left", "distance", "near"]),
    cycloplegic_dilated: normalizeEyeExamSection(
      payload.cycloplegic_dilated,
      ["right", "left", "distance", "near"],
    ),
  };
}

export function hasEyeExamEntryData(entry: EyeExamEntry) {
  return Boolean(
    entry.sphere.trim() ||
    entry.cylinder.trim() ||
    entry.axis.trim() ||
    entry.vision.trim()
  );
}

export function hasEyeExamData(payload: EyeExamPayload) {
  return flattenValues(payload.case_sheet).some((value) => typeof value === "string" ? Boolean(value.trim()) : value === true) ||
    EYE_EXAM_SECTIONS.some(({ key }) => payload[key].some(hasEyeExamEntryData));
}

export function flattenEyeExamForNote(payload: EyeExamPayload) {
  const sheet = payload.case_sheet ?? {};
  const at = (path: string[]) => {
    let current: unknown = sheet;
    for (const part of path) {
      if (!current || typeof current !== "object") return "";
      current = (current as Record<string, unknown>)[part];
    }
    return typeof current === "string" ? current : "";
  };
  const current = (["right", "left"] as const).flatMap((eye) => {
    const entry: EyeExamEntry = {
      eye,
      section: "subjective",
      sphere: at(["refraction", "dry", eye, "sphere"]),
      cylinder: at(["refraction", "dry", eye, "cylinder"]),
      axis: at(["refraction", "dry", eye, "axis"]),
      vision: at(["refraction", "dry", eye, "distance_vision"]),
    };
    return hasEyeExamEntryData(entry) ? [entry] : [];
  });
  if (current.length) {
    return current;
  }
  return EYE_EXAM_SECTIONS.flatMap(({ key }) =>
    payload[key]
      .filter(hasEyeExamEntryData)
      .map((entry) => ({ ...entry, section: key })),
  );
}

export function buildEyeExamSummary(payload: EyeExamPayload) {
  const at = (path: string[]) => {
    let current: unknown = payload.case_sheet;
    for (const part of path) {
      if (!current || typeof current !== "object") return "";
      current = (current as Record<string, unknown>)[part];
    }
    return typeof current === "string" ? current.trim() : "";
  };
  const sheetParts = [
    at(["visual_acuity", "right", "ucva_distance"]) ? `OD UCVA ${at(["visual_acuity", "right", "ucva_distance"])}` : "",
    at(["visual_acuity", "left", "ucva_distance"]) ? `OS UCVA ${at(["visual_acuity", "left", "ucva_distance"])}` : "",
    at(["refraction", "dry", "right", "distance_vision"]) ? `OD BCVA ${at(["refraction", "dry", "right", "distance_vision"])}` : "",
    at(["refraction", "dry", "left", "distance_vision"]) ? `OS BCVA ${at(["refraction", "dry", "left", "distance_vision"])}` : "",
    at(["examination", "comments"]),
  ].filter(Boolean);
  if (sheetParts.length) {
    return sheetParts.slice(0, 4).join(" · ");
  }
  const parts = EYE_EXAM_SECTIONS.flatMap(({ key, label }) =>
    payload[key].filter(hasEyeExamEntryData).map((entry) => {
      const row = entry.eye === "right" ? "OD" : entry.eye === "left" ? "OS" : entry.eye[0].toUpperCase() + entry.eye.slice(1);
      const refraction = [entry.sphere, entry.cylinder, entry.axis ? `x ${entry.axis}` : ""]
        .map((value) => value.trim())
        .filter(Boolean)
        .join(" ");
      return [`${label} ${row}`, refraction, entry.vision.trim() ? `VA ${entry.vision.trim()}` : ""].filter(Boolean).join(" ");
    }),
  );
  return parts.join(" · ") || "Eye Exam saved.";
}

function flattenValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flattenValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(flattenValues);
  return [value];
}

export function formatModuleSummary(entry: LongitudinalTrackRecord, fallback?: string) {
  const summary = entry.summary_fields?.summary;
  if (typeof summary === "string" && summary.trim()) {
    return summary.trim();
  }
  const result = entry.summary_fields?.result;
  if (typeof result === "string" && result.trim()) {
    return result.trim();
  }
  return fallback ?? `${moduleLabel(entry.track_type as SpecialtyModuleKey)} saved.`;
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
