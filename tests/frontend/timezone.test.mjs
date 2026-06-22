import test from "node:test";
import assert from "node:assert/strict";

import { importWebModule } from "./load-web-module.mjs";

const timezone = await importWebModule("lib/timezone.ts");

test("zonedDateTimeInputToUtcIso converts clinic local follow-up times to UTC", () => {
  assert.equal(
    timezone.zonedDateTimeInputToUtcIso("2026-06-30T09:00", "Asia/Kolkata"),
    "2026-06-30T03:30:00.000Z",
  );
});
