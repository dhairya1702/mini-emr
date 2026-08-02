import test from "node:test";
import assert from "node:assert/strict";

import { importWebModule } from "./load-web-module.mjs";

const eyeExam = await importWebModule("lib/structured-modules.ts");

test("eye exam creates a versioned case sheet while retaining legacy rows", () => {
  const payload = eyeExam.createEmptyEyeExam();

  assert.equal(payload.version, 2);
  assert.deepEqual(payload.case_sheet, {});
  assert.deepEqual(payload.objective.map((entry) => entry.eye), ["right", "left"]);
  assert.deepEqual(payload.subjective.map((entry) => entry.eye), ["right", "left", "distance", "near"]);
  assert.deepEqual(payload.cycloplegic_dilated.map((entry) => entry.eye), ["right", "left", "distance", "near"]);
  assert.equal(eyeExam.hasEyeExamData(payload), false);
});

test("eye exam normalizes and summarizes version 2 case-sheet values", () => {
  const payload = eyeExam.normalizeEyeExamPayload({
    version: 2,
    case_sheet: {
      visual_acuity: {
        right: { ucva_distance: "6/12" },
        left: { ucva_distance: "6/9" },
      },
      refraction: {
        dry: {
          right: { sphere: "-1.25", cylinder: "-0.50", axis: "90", distance_vision: "6/6" },
          left: { sphere: "-1.00", cylinder: "", axis: "", distance_vision: "6/6" },
        },
      },
    },
  });

  assert.equal(eyeExam.hasEyeExamData(payload), true);
  assert.equal(eyeExam.buildEyeExamSummary(payload), "OD UCVA 6/12 · OS UCVA 6/9 · OD BCVA 6/6 · OS BCVA 6/6");
  assert.deepEqual(eyeExam.flattenEyeExamForNote(payload), [
    { eye: "right", section: "subjective", sphere: "-1.25", cylinder: "-0.50", axis: "90", vision: "6/6" },
    { eye: "left", section: "subjective", sphere: "-1.00", cylinder: "", axis: "", vision: "6/6" },
  ]);
});

test("eye exam normalizes legacy right and left entries into Objective", () => {
  const payload = eyeExam.normalizeEyeExamPayload({
    entries: [
      { eye: "right", sphere: "-1.25", cylinder: "-0.50", axis: "90", vision: "6/6" },
      { eye: "left", sphere: "-1.00", cylinder: "", axis: "", vision: "6/6" },
    ],
  });

  assert.equal(payload.objective[0].sphere, "-1.25");
  assert.equal(payload.objective[1].sphere, "-1.00");
  assert.equal(eyeExam.hasEyeExamData(payload), true);
  assert.equal(payload.subjective.length, 4);
  assert.equal(payload.subjective.every((entry) => entry.sphere === ""), true);
});

test("eye exam flattens sectioned values for note generation", () => {
  const payload = eyeExam.createEmptyEyeExam();
  payload.subjective[2].vision = "6/9";
  payload.cycloplegic_dilated[3].sphere = "+1.00";

  assert.deepEqual(eyeExam.flattenEyeExamForNote(payload), [
    {
      eye: "distance",
      section: "subjective",
      sphere: "",
      cylinder: "",
      axis: "",
      vision: "6/9",
    },
    {
      eye: "near",
      section: "cycloplegic_dilated",
      sphere: "+1.00",
      cylinder: "",
      axis: "",
      vision: "",
    },
  ]);
});
