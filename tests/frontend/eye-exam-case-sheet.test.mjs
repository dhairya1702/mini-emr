import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../web/components/optometry/eye-exam-modal.tsx", import.meta.url), "utf8");

test("eye exam uses the seven-page clinical workflow", () => {
  for (const label of [
    "Visual acuity",
    "Refraction",
    "Glasses prescriptions",
    "PMT and Keratometry",
    "IOP",
    "Ocular",
    "Additional tests",
  ]) assert.ok(source.includes(label), `Missing eye exam page: ${label}`);
});

test("eye exam retains the source clinical assessments", () => {
  for (const label of [
    "UCVA",
    "Pinhole",
    "Intraocular Pressure",
    "Autorefraction",
    "Dry Refraction",
    "Dilated / Cycloplegic Refraction",
    "Distance/Near",
    "Distance VA",
    "ADD",
    "Near VA",
    "Post-mydriatic Test",
    "Keratometry",
    "Amsler",
    "Quick Contact Lens Measurements",
    "Colour vision",
    "Contrast",
    "Orthoptic screening",
    "Anterior chamber (AC)",
    "Fundus",
  ]) assert.ok(source.toLowerCase().includes(label.toLowerCase()), `Missing eye exam field: ${label}`);
});

test("removed eye exam sections are no longer rendered", () => {
  for (const label of [
    'label="Refraction comments"',
    "Present Glasses Prescription 1",
    "Present Glasses Prescription 2",
    "Horizontal meridian",
    '"Injury"',
    '"Intraocular pressure (IOP)"',
  ]) assert.equal(source.includes(label), false, `Removed eye exam field is still present: ${label}`);
});

test("signed prescription powers remain free-text fields", () => {
  assert.ok(source.includes('placeholder={["SPH", "CYL", "ADD"].includes(column) ? "+ / -"'));
});

test("ocular structures are not silently defaulted normal", () => {
  assert.ok(source.includes('<option value="">Not examined</option>'));
  assert.ok(source.includes("Mark all structures normal"));
});
