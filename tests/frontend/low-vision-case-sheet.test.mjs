import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../web/components/optometry/low-vision-modal.tsx", import.meta.url), "utf8");

test("low vision module retains all eight source pages", () => {
  for (const label of [
    "Initial assessment",
    "Devices & distance tasks",
    "Near tasks & mobility",
    "Daily living & behaviour",
    "Visual acuity & refraction",
    "Fields & visual function",
    "Low vision device trials",
    "Rehabilitation plan",
  ]) assert.ok(source.includes(label), `Missing low vision page: ${label}`);
});

test("low vision module retains source clinical assessments", () => {
  for (const label of [
    "Family History",
    "Additional Disabilities",
    "Current and Last Used Devices",
    "Difficulty with distance vision tasks",
    "Activities of daily living",
    "Dry Refraction",
    "Cycloplegic Refraction and Acceptance",
    "Visual Field Testing",
    "Trial of Low Vision Devices",
    "Preference of absorptive lenses",
    "Low Vision Rehabilitation Plan and Management",
  ]) assert.ok(source.toLowerCase().includes(label.toLowerCase()), `Missing low vision field: ${label}`);
});
