import test from "node:test";
import assert from "node:assert/strict";

import { importWebModule } from "./load-web-module.mjs";

test("setup flow maps legacy setup query values to popup steps", async () => {
  const flow = await importWebModule("lib/setup-flow.ts");

  assert.equal(flow.setupStepFromQuery("specialty"), "specialty");
  assert.equal(flow.setupStepFromQuery("clinic-hours"), "hours");
  assert.equal(flow.setupStepFromQuery("signature"), "signature");
  assert.equal(flow.setupStepFromQuery("sender-email"), "sender_email");
  assert.equal(flow.setupStepFromQuery("add-first-staff"), "first_staff_user");
  assert.equal(flow.setupStepFromQuery("create-first-patient"), "first_patient");
  assert.equal(flow.setupStepFromQuery("document-template"), "document_template");
  assert.equal(flow.setupStepFromQuery("unknown"), null);
});

test("setup flow emits stable setup query values", async () => {
  const flow = await importWebModule("lib/setup-flow.ts");

  assert.equal(flow.setupQueryForStep("specialty"), "specialty");
  assert.equal(flow.setupQueryForStep("hours"), "clinic-hours");
  assert.equal(flow.setupQueryForStep("signature"), "signature");
  assert.equal(flow.setupQueryForStep("sender_email"), "sender-email");
  assert.equal(flow.setupQueryForStep("first_staff_user"), "add-first-staff");
  assert.equal(flow.setupQueryForStep("first_patient"), "create-first-patient");
  assert.equal(flow.setupQueryForStep("document_template"), "document-template");
});

test("setup flow finds the next incomplete or recommended step", async () => {
  const flow = await importWebModule("lib/setup-flow.ts");
  const checklist = {
    items: [
      { key: "specialty", status: "complete" },
      { key: "hours", status: "complete" },
      { key: "signature", status: "incomplete" },
      { key: "sender_email", status: "incomplete" },
      { key: "document_template", status: "recommended" },
    ],
  };

  assert.equal(flow.findNextSetupStep(checklist, "signature"), "sender_email");
  assert.equal(flow.findNextSetupStep(checklist, "sender_email"), "signature");

  const completedRequired = {
    items: [
      { key: "specialty", status: "complete" },
      { key: "hours", status: "complete" },
      { key: "signature", status: "complete" },
      { key: "sender_email", status: "complete" },
      { key: "document_template", status: "recommended" },
    ],
  };

  assert.equal(flow.findNextSetupStep(completedRequired, "sender_email"), "document_template");
});
