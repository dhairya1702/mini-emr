import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(relativePath) {
  return readFile(new URL(`../../web/${relativePath}`, import.meta.url), "utf8");
}

test("patient chart and structured tests use full viewport shells", async () => {
  const patientChart = await source("components/patient-details-drawer.tsx");
  assert.ok(patientChart.includes('fixed inset-0 z-30 flex h-[100dvh] flex-col bg-white'));
  assert.ok(patientChart.includes('flex h-[100dvh] w-full flex-col overflow-hidden bg-white'));
  assert.equal(patientChart.includes("max-h-[95vh] w-full max-w-7xl"), false);
});

test("shared and case-sheet test shells are edge-to-edge", async () => {
  const modalShell = await source("components/optometry/optometry-modal-shell.tsx");
  const contactLens = await source("components/optometry/contact-lens-modal.tsx");
  const lowVision = await source("components/optometry/low-vision-modal.tsx");
  const eyeExam = await source("components/optometry/eye-exam-modal.tsx");
  assert.ok(modalShell.includes('flex h-[100dvh] w-full flex-col overflow-hidden bg-white'));
  assert.ok(contactLens.includes('className="w-full bg-white text-slate-950"'));
  assert.ok(lowVision.includes('className="w-full bg-white text-slate-950"'));
  assert.ok(eyeExam.includes('className="w-full bg-white text-slate-950"'));
});

test("binocular, neurovision and myopia workspaces are full screen", async () => {
  for (const path of [
    "components/optometry/binocular-vision-modal.tsx",
    "components/optometry/tbi-evaluation-modal.tsx",
    "components/optometry/myopia/myopia-management-modal.tsx",
  ]) {
    const contents = await source(path);
    assert.ok(contents.includes("h-[100dvh] w-full"), `${path} is not full viewport`);
  }
  const myopiaEntry = await source("components/optometry/myopia/historical-myopia-modal.tsx");
  assert.ok(myopiaEntry.includes("OptometryModalShell"));
});

test("myopia history uses the compact clinical dashboard layout", async () => {
  const workspace = await source("components/optometry/myopia/myopia-management-modal.tsx");
  const chart = await source("components/optometry/myopia/myopia-progression-chart.tsx");

  assert.equal(
    workspace.includes("Review axial-length progression, treatment changes, and backfilled records in one place."),
    false,
  );
  assert.equal(workspace.includes("View reading history"), false);
  assert.equal(workspace.includes("Projection uses the recorded annualized growth trend"), false);
  for (const label of [
    "Since baseline",
    "Since last visit",
    "Annualized growth",
    "Treatment effect",
    "Projection",
    "Current treatment",
    "Readings &amp; treatment timeline",
  ]) {
    assert.ok(workspace.includes(label), `missing compact dashboard section: ${label}`);
  }
  assert.ok(workspace.includes("timelineDelta(myopiaRecords, chronologicalIndex)"));
  assert.ok(workspace.includes("record.refraction_right"));
  assert.ok(workspace.includes("record.treatment_notes"));
  assert.ok(workspace.includes("record.visit_notes"));
  assert.ok(chart.includes('aria-label="Chart date range"'));
  assert.equal(workspace.includes("text-slate-500"), false);
  assert.equal(workspace.includes("text-slate-600"), false);
  assert.equal(chart.includes("text-slate-500"), false);
  assert.equal(chart.includes("text-slate-600"), false);
});

test("both myopia entry points share one neutral compact form", async () => {
  const examination = await source("components/optometry/myopia-management-modal.tsx");
  const backfill = await source("components/optometry/myopia/historical-myopia-modal.tsx");
  const sharedForm = await source("components/optometry/myopia/myopia-measurement-form.tsx");

  for (const entryPoint of [examination, backfill]) {
    assert.ok(entryPoint.includes("MyopiaMeasurementForm"));
    assert.ok(entryPoint.includes('title="Myopia Management"'));
    assert.ok(entryPoint.includes('saveLabel="Save"'));
    assert.equal(entryPoint.includes('title="Add Historical Measurement"'), false);
    assert.equal(entryPoint.includes("Myopia Backfill"), false);
    assert.equal(entryPoint.includes("Save Myopia Measurement"), false);
  }
  for (const section of ["Visit details", "Clinical measurements", "Clinical notes"]) {
    assert.ok(sharedForm.includes(section), `missing shared Myopia section: ${section}`);
  }
  assert.equal(sharedForm.includes("text-slate-500"), false);
  assert.equal(sharedForm.includes("text-slate-600"), false);
});
