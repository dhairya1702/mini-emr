import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../web/components/optometry/contact-lens-modal.tsx", import.meta.url), "utf8");

test("contact lens UI preserves all four source case-sheet modules", () => {
  for (const label of ["General CL", "Soft CL", "RGP", "Scleral / Mini-scleral"]) {
    assert.match(source, new RegExp(label.replace("/", "\\/")));
  }
});

test("general case sheet retains source clinical tables", () => {
  for (const label of [
    "Objective Refraction",
    "Subjective Refraction",
    "Corneal Topography and Pachymetry",
    "Tolerance Trial",
    "Fitting / Axis Orientation",
    "Review of lens care and insertion / removal",
  ]) assert.ok(source.includes(label), `Missing General CL field: ${label}`);
});

test("lens-specific sheets retain their defining fitting fields", () => {
  for (const label of [
    "Schirmer's test",
    "Axis Rotation",
    "Fluorescein Pattern",
    "Recommended hours of CL usage",
    "Sagittal value",
    "360 degree landing",
    "360 degree impingement",
  ]) assert.ok(source.includes(label), `Missing lens-specific field: ${label}`);
});
