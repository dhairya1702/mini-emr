import test from "node:test";
import assert from "node:assert/strict";

import { importWebModule } from "./load-web-module.mjs";

const history = await importWebModule("lib/optometry/history.ts");

test("optometry history starts empty with unrecorded wearing status", () => {
  const payload = history.createEmptyOptometryHistory();

  assert.equal(payload.wears_glasses, null);
  assert.equal(payload.wears_contact_lenses, null);
  assert.deepEqual(payload.ocular_conditions, []);
  assert.deepEqual(payload.systemic_conditions, []);
  assert.equal(payload.drug_allergies, "");
  assert.equal(payload.contact_allergies, "");
  assert.equal(payload.food_allergies, "");
  assert.deepEqual(payload.drug_allergy_entries, []);
  assert.deepEqual(payload.contact_allergy_entries, []);
  assert.deepEqual(payload.food_allergy_entries, []);
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

  const systemicPayload = history.createEmptyOptometryHistory();
  systemicPayload.systemic_conditions.push({ condition: "Diabetes", comment: "Controlled" });
  assert.equal(history.hasOptometryHistoryDetails(systemicPayload), true);

  const ocularPayload = history.createEmptyOptometryHistory();
  ocularPayload.ocular_conditions.push({ condition: "Glaucoma", comment: "On drops" });
  assert.equal(history.hasOptometryHistoryDetails(ocularPayload), true);

  const allergyEntryPayload = history.createEmptyOptometryHistory();
  allergyEntryPayload.drug_allergy_entries.push({ condition: "NSAIDs", comment: "Rash" });
  assert.equal(history.hasOptometryHistoryDetails(allergyEntryPayload), true);
});

test("chief complaints build editable examination symptoms text", () => {
  assert.equal(
    history.buildChiefComplaintText([
      { complaint: "Redness", comment: "OD for three days" },
      { complaint: "Pain", comment: "" },
    ]),
    "Redness — OD for three days\nPain",
  );
});
