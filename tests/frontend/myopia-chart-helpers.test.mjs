import test from "node:test";
import assert from "node:assert/strict";

import { importWebModule } from "./load-web-module.mjs";

const { buildMyopiaChartModel } = await importWebModule("lib/optometry/myopia/chart.ts");
const EPSILON = 1e-9;

test("buildMyopiaChartModel returns null for empty history", () => {
  assert.equal(buildMyopiaChartModel(null), null);
  assert.equal(
    buildMyopiaChartModel({
      patient_id: "patient-1",
      records: [],
      baseline_delta: null,
      last_delta: null,
      annualized_growth: null,
      overlay_version: "clinic-reference-v1",
    }),
    null,
  );
});

test("buildMyopiaChartModel computes projections and modeled overlays", () => {
  const history = {
    patient_id: "patient-1",
    records: [
      {
        id: "r1",
        org_id: "org-1",
        patient_id: "patient-1",
        measured_at: "2026-01-01T10:00:00+00:00",
        age_years: 11.0,
        axial_length_right_mm: 24.10,
        axial_length_left_mm: 24.04,
        treatment_type: "Observation",
        treatment_notes: "Baseline",
        visit_notes: "Initial measurement",
        refraction_right: "-1.50 DS",
        refraction_left: "-1.25 DS",
        created_at: "2026-01-01T10:05:00+00:00",
      },
      {
        id: "r2",
        org_id: "org-1",
        patient_id: "patient-1",
        measured_at: "2026-07-01T10:00:00+00:00",
        age_years: 11.5,
        axial_length_right_mm: 24.22,
        axial_length_left_mm: 24.16,
        treatment_type: "Atropine 0.01%",
        treatment_notes: "Started treatment",
        visit_notes: "Compliance reviewed",
        refraction_right: "-2.00 DS",
        refraction_left: "-1.75 DS",
        created_at: "2026-07-01T10:05:00+00:00",
      },
    ],
    baseline_delta: { right_mm: 0.12, left_mm: 0.12 },
    last_delta: { right_mm: 0.12, left_mm: 0.12 },
    annualized_growth: { right_mm: 0.24, left_mm: 0.20 },
    overlay_version: "clinic-reference-v1",
  };

  const model = buildMyopiaChartModel(history);

  assert.ok(model);
  assert.ok(Math.abs(model.projectedSixMonthRight - 24.34) < EPSILON);
  assert.ok(Math.abs(model.projectedSixMonthLeft - 24.26) < EPSILON);
  assert.ok(Math.abs(model.projectedTwelveMonthRight - 24.46) < EPSILON);
  assert.ok(Math.abs(model.projectedTwelveMonthLeft - 24.36) < EPSILON);
  assert.equal(model.overlayVersion, "clinic-reference-v1");
  assert.equal(model.modeledUntreatedPoints.length, 4);
  assert.equal(model.modeledTreatedPoints.length, 4);
  assert.match(model.projectedRightPath, /^M /);
  assert.match(model.projectedLeftPath, /^M /);
  assert.match(model.referenceBandPath, /Z$/);
  assert.equal(model.latestRecord?.id, "r2");
  assert.ok(model.expectedUntreatedDelta);
  assert.ok(model.expectedTreatedDelta);
  assert.notEqual(model.efficacyRight, null);
  assert.notEqual(model.efficacyLeft, null);
  assert.ok(model.xForAge(11.0) < model.xForAge(12.0));
  assert.ok(model.yForMm(24.8) < model.yForMm(24.1));
});
