import { expect, test } from "@playwright/test";

import { createEmptyConsultationForm } from "@/features/consultation/model/consultation-form";
import {
  syncDraftMedicationTable,
  togglePrescriptionNoteValue,
} from "@/features/consultation/model/medication-table";
import {
  buildConsultationNotePayload,
  buildMedicationTreatmentPayload,
  buildStructuredModulePayloads,
} from "@/features/consultation/model/note-payload";
import {
  buildAutoDraftInvoiceItems,
  extractStructuredPrescriptionItems,
} from "@/features/dashboard/billing/billing-draft";
import type {
  BillingSuggestionsResponse,
  CatalogItem,
  ClinicalExtractions,
  ConsultationNote,
  Patient,
} from "@/lib/types";

function buildCatalogItem(overrides: Partial<CatalogItem>): CatalogItem {
  return {
    id: "catalog-item",
    org_id: "org-1",
    name: "Catalog item",
    item_type: "service",
    default_price: 0,
    track_inventory: false,
    stock_quantity: 0,
    low_stock_threshold: 0,
    unit: "unit",
    hsn_sac_code: "",
    gst_rate: null,
    aliases: [],
    created_at: "2026-08-17T00:00:00.000Z",
    ...overrides,
  };
}

function buildNote(content: string, snapshotContent: string | null = null): ConsultationNote {
  return {
    id: "note-1",
    patient_id: "patient-1",
    visit_id: "visit-1",
    content,
    status: "draft",
    version_number: 1,
    root_note_id: null,
    amended_from_note_id: null,
    snapshot_content: snapshotContent,
    finalized_at: null,
    sent_at: null,
    sent_by: null,
    sent_to: null,
    created_at: "2026-08-17T00:00:00.000Z",
  };
}

test.describe("consultation model extraction", () => {
  test("creates a deterministic empty consultation form", () => {
    const form = createEmptyConsultationForm({
      now: new Date("2026-08-17T10:30:00.000Z"),
      createId: () => "test-score-1",
    });

    expect(form.testScores).toEqual([{ id: "test-score-1", label: "", value: "" }]);
    expect(form.prescriptions).toEqual([]);
    expect(form.assets).toEqual([]);
    expect(form.growthMeasurement.measured_at).toBeTruthy();
    expect(form.wellChildVisit.visit_band).toBe("school_age");
  });

  test("combines medication and treatment text without losing section labels", () => {
    expect(buildMedicationTreatmentPayload(" Amoxicillin ", " Hydration ")).toBe(
      "Medications:\nAmoxicillin\n\nTreatment:\nHydration",
    );
    expect(buildMedicationTreatmentPayload("", " Rest ")).toBe("Treatment:\nRest");
    expect(buildMedicationTreatmentPayload("", "")).toBe("");
  });

  test("inserts and replaces the extracted medication table before follow-up advice", () => {
    const extractions: ClinicalExtractions = {
      services_performed: [],
      medications_prescribed: [{
        name: "Amox|icillin",
        strength: "500 mg",
        dose: "1 capsule",
        route: "Oral",
        schedule: "Morning and night",
        duration: "5 days",
        quantity: "10",
        instructions: "After food",
      }],
    };
    const original = "Assessment text\n\nFollow-up Advice:\nReturn in five days.";
    const first = syncDraftMedicationTable(original, extractions);
    const second = syncDraftMedicationTable(first, extractions);

    expect(first).toContain("Amox/icillin | 500 mg | 1 capsule | Oral");
    expect(first.indexOf("Medications Prescribed:")).toBeLessThan(first.indexOf("Follow-up Advice:"));
    expect(second).toBe(first);
    expect(togglePrescriptionNoteValue("Before food, PRN", "PRN")).toBe("Before food");
  });

  test("builds pediatric modules and the note API payload from explicit state", () => {
    const form = createEmptyConsultationForm({ createId: () => "score-empty" });
    form.symptoms = "Fever";
    form.diagnosis = "Viral illness";
    form.medications = "Paracetamol";
    form.treatment = "Fluids";
    form.bloodPressureSystolic = "120";
    form.testScores = [
      { id: "score-1", label: "  Pain  ", value: "  4/10 " },
      { id: "score-2", label: "", value: "ignored" },
    ];
    form.growthMeasurement = {
      measured_at: "2026-08-17T10:30:00.000Z",
      height_cm: "120",
      weight_kg: "24",
      head_circumference_cm: "",
      visit_notes: " routine measurement ",
      savedRecord: null,
    };
    form.prescriptions = [{
      itemId: "medicine-1",
      name: "Paracetamol",
      unit: "tablet",
      quantity: " 6 ",
      duration: " 3 days ",
      notes: " After food ",
      morning: true,
      afternoon: false,
      night: true,
    }];

    const modules = buildStructuredModulePayloads({
      form,
      currentModules: [{ module_type: "existing", payload: { retained: true } }],
      isPediatricsClinic: true,
    });
    const payload = buildConsultationNotePayload({
      patientId: "patient-1",
      visitId: "visit-1",
      form,
      currentModules: modules.slice(0, 1),
      isPediatricsClinic: true,
      currentNoteId: "draft-note-1",
      noteStatus: "draft",
      includeNoteId: true,
    });

    expect(modules.map((entry) => entry.module_type)).toContain("pediatric_growth_measurement");
    expect(payload.note_id).toBe("draft-note-1");
    expect(payload.medications).toBe("Medications:\nParacetamol\n\nTreatment:\nFluids");
    expect(payload.blood_pressure_systolic).toBe(120);
    expect(payload.test_scores).toEqual([{ label: "Pain", value: "4/10" }]);
    expect(payload.prescriptions?.[0]).toMatchObject({
      schedule: "Morning, Night",
      duration: "3 days",
      quantity: "6",
      instructions: "After food",
    });
  });
});

test.describe("billing draft extraction", () => {
  const patient = { id: "patient-1" } as Patient;
  const consultation = buildCatalogItem({
    id: "service-1",
    name: "Consultation",
    item_type: "service",
    default_price: 500,
  });
  const medicine = buildCatalogItem({
    id: "medicine-1",
    name: "Amoxicillin",
    item_type: "medicine",
    default_price: 25,
  });

  test("prefers structured prescription quantities over free-text matching", () => {
    const note = buildNote([
      "Medicine | Quantity | Schedule | Duration | Notes",
      "--- | --- | --- | --- | ---",
      "Amoxicillin | 2 tablets | Morning | 5 days | After food",
      "",
      "Amoxicillin is also mentioned later.",
    ].join("\n"));
    let id = 0;
    const createId = () => `item-${++id}`;

    expect(extractStructuredPrescriptionItems(note, [medicine], createId)).toMatchObject([
      { label: "Amoxicillin", quantity: 2, unit_price: 25 },
    ]);
    expect(buildAutoDraftInvoiceItems(
      patient,
      note,
      [consultation],
      [medicine],
      null,
      createId,
    )).toMatchObject([
      { label: "Consultation", quantity: 1, unit_price: 500 },
      { label: "Amoxicillin", quantity: 2, unit_price: 25 },
    ]);
  });

  test("uses only auto-add billing suggestions when suggestions are present", () => {
    const suggestions: BillingSuggestionsResponse = {
      note_id: "note-1",
      visit_id: "visit-1",
      suggestions: [
        {
          source: "default_consultation",
          extraction_name: "Consultation",
          status: "auto_add",
          catalog_match: null,
        },
        {
          source: "prescribed_medicine",
          extraction_name: "Amoxicillin",
          status: "possible_match",
          catalog_match: {
            catalog_item_id: medicine.id,
            label: medicine.name,
            item_type: medicine.item_type,
            quantity: 1,
            unit_price: medicine.default_price,
            match_type: "fuzzy",
            confidence: 0.8,
            available: true,
          },
        },
      ],
    };

    expect(buildAutoDraftInvoiceItems(
      patient,
      buildNote("Amoxicillin"),
      [consultation],
      [medicine],
      suggestions,
      () => "suggestion-1",
    )).toEqual([{
      id: "suggestion-1",
      catalog_item_id: null,
      item_type: "service",
      label: "Consultation",
      quantity: 1,
      unit_price: 0,
    }]);
  });
});
