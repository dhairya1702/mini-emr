import assert from "node:assert/strict";
import test from "node:test";

import { importWebModule } from "./load-web-module.mjs";

test("specialty modules keep optometry and pediatrics boundaries separate", async () => {
  const { getSpecialtyModules, specialtyHasModule } = await importWebModule("lib/specialty.ts");

  assert.deepEqual(getSpecialtyModules("general_physician"), []);
  assert.equal(specialtyHasModule("optometry", "eye_exam"), true);
  assert.equal(specialtyHasModule("optometry", "contact_lens"), true);
  assert.equal(specialtyHasModule("pediatrics", "eye_exam"), false);
  assert.equal(specialtyHasModule("pediatrics", "pediatric_growth_measurement"), true);
});
