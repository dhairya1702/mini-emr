import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../web/components/optometry/eye-exam-modal.tsx", import.meta.url), "utf8");

test("eye exam retains all six source workflow pages", () => {
  for (const label of [
    "Visual acuity",
    "IOP & refraction",
    "Glasses prescriptions",
    "Retinoscopy & keratometry",
    "Additional tests",
    "Ocular examination",
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
    "Present Glasses Prescription 1",
    "Near Glasses Prescription",
    "Post-mydriatic Test",
    "Retinoscopy",
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

test("ocular structures are not silently defaulted normal", () => {
  assert.ok(source.includes('<option value="">Not examined</option>'));
  assert.ok(source.includes("Mark all structures normal"));
});
