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
  assert.ok(modalShell.includes('flex h-[100dvh] w-full flex-col overflow-hidden bg-white'));
  assert.ok(contactLens.includes('className="w-full bg-white text-slate-950"'));
  assert.ok(lowVision.includes('className="w-full bg-white text-slate-950"'));
});

test("binocular, neurovision and myopia workspaces are full screen", async () => {
  for (const path of [
    "components/optometry/binocular-vision-modal.tsx",
    "components/optometry/tbi-evaluation-modal.tsx",
    "components/optometry/myopia/myopia-management-modal.tsx",
    "components/optometry/myopia/historical-myopia-modal.tsx",
  ]) {
    const contents = await source(path);
    assert.ok(contents.includes("h-[100dvh] w-full"), `${path} is not full viewport`);
  }
});
