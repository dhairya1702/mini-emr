import test from "node:test";
import assert from "node:assert/strict";

import { importWebModule } from "./load-web-module.mjs";

const history = await importWebModule("lib/optometry/history.ts");

test("optometry history starts empty with unrecorded wearing status", () => {
  const payload = history.createEmptyOptometryHistory();

  assert.equal(payload.wears_glasses, null);
  assert.equal(payload.wears_contact_lenses, null);
  assert.deepEqual(payload.right_power, {
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
});
