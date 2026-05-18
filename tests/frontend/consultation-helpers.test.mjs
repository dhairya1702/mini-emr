import test from "node:test";
import assert from "node:assert/strict";

import { importWebModule } from "./load-web-module.mjs";

const consultation = await importWebModule("lib/optometry/consultation.ts");

test("contact lens helpers treat empty payload as no data and eye values as data", () => {
  const payload = consultation.createEmptyContactLens();
  assert.equal(consultation.hasContactLensData(payload), false);

  payload.eyes[0].sphere = "-2.00";
  assert.equal(consultation.hasContactLensData(payload), true);
  assert.equal(consultation.hasContactLensEyeData(payload.eyes[0]), true);
});

test("binocular vision helpers surface saved data and compact summary", () => {
  const payload = consultation.createEmptyBinocularVision();
  assert.equal(consultation.hasBinocularVisionData(payload), false);

  payload.working_diagnosis = "Convergence insufficiency";
  payload.npc_break_cm = "12";
  payload.stereo_result_arcsec = "80";
  assert.equal(consultation.hasBinocularVisionData(payload), true);
  assert.equal(
    consultation.buildBinocularVisionSummary(payload),
    "Convergence insufficiency · NPC 12 cm · Stereo 80 arc sec",
  );
});

test("low vision helpers report boolean and textual data and build summary", () => {
  const payload = consultation.createEmptyLowVision();
  assert.equal(consultation.hasLowVisionData(payload), false);

  payload.primary_complaint = "Difficulty reading";
  payload.distance_visual_acuity = "6/18";
  payload.near_visual_acuity = "N10";
  payload.device_recommended = "Stand magnifier";
  assert.equal(consultation.hasLowVisionData(payload), true);
  assert.equal(
    consultation.buildLowVisionSummary(payload),
    "Difficulty reading · DVA 6/18 · NVA N10",
  );
});

test("myopia management helpers detect entered measurements and summarize them", () => {
  const payload = consultation.createEmptyMyopiaManagement();
  assert.equal(consultation.hasMyopiaManagementData(payload), false);

  payload.axial_length_right_mm = 24.22;
  payload.axial_length_left_mm = 24.16;
  payload.treatment_type = "Atropine 0.01%";
  assert.equal(consultation.hasMyopiaManagementData(payload), true);
  assert.equal(
    consultation.buildMyopiaManagementSummary(payload),
    "OD 24.22 mm · OS 24.16 mm · Atropine 0.01%",
  );
});
