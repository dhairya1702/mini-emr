import test from "node:test";
import assert from "node:assert/strict";

import { importWebModule } from "./load-web-module.mjs";

const history = await importWebModule("lib/optometry/history.ts");

test("optometry history starts empty with unrecorded wearing status", () => {
  const payload = history.createEmptyOptometryHistory();

  assert.equal(payload.wears_glasses, null);
  assert.equal(payload.wears_contact_lenses, null);
  assert.equal(payload.drug_allergies, "");
  assert.equal(payload.contact_allergies, "");
  assert.equal(payload.food_allergies, "");
  assert.deepEqual(payload.right_power, {
    sphere: "",
    cylinder: "",
    axis: "",
    add: "",
  });
  assert.deepEqual(payload.right_contact_power, {
    sphere: "",
    cylinder: "",
    axis: "",
    add: "",
  });
  assert.equal(history.hasOptometryHistoryDetails(payload), false);
});

test("optometry history detects clinical text and current glasses power", () => {
  const textPayload = history.createEmptyOptometryHistory();
  textPayload.ocular = "Previous cataract surgery.";
  assert.equal(history.hasOptometryHistoryDetails(textPayload), true);

  const powerPayload = history.createEmptyOptometryHistory();
  powerPayload.wears_glasses = true;
  powerPayload.right_power.sphere = "-2.00";
  assert.equal(history.hasOptometryHistoryDetails(powerPayload), true);

  const allergyPayload = history.createEmptyOptometryHistory();
  allergyPayload.food_allergies = "Peanuts";
  assert.equal(history.hasOptometryHistoryDetails(allergyPayload), true);

  const contactPowerPayload = history.createEmptyOptometryHistory();
  contactPowerPayload.right_contact_power.sphere = "-3.00";
  assert.equal(history.hasOptometryHistoryDetails(contactPowerPayload), true);
});
