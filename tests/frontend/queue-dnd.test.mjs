import assert from "node:assert/strict";
import test from "node:test";

import { importWebModule } from "./load-web-module.mjs";

test("queue drag helpers reorder patients inside one status", async () => {
  const { reorderQueueColumn } = await importWebModule("lib/queue-dnd.ts");
  const order = {
    waiting: ["a", "b", "c"],
    consultation: ["d"],
    done: [],
  };

  assert.deepEqual(reorderQueueColumn(order, "waiting", "c", "a"), {
    waiting: ["c", "a", "b"],
    consultation: ["d"],
    done: [],
  });
});

test("queue drag helpers move patients between statuses", async () => {
  const { movePatientBetweenQueueColumns } = await importWebModule("lib/queue-dnd.ts");
  const order = {
    waiting: ["a", "b"],
    consultation: ["c", "d"],
    done: [],
  };

  assert.deepEqual(movePatientBetweenQueueColumns(order, "waiting", "consultation", "b", "d"), {
    waiting: ["a"],
    consultation: ["c", "b", "d"],
    done: [],
  });
});

test("queue drag helpers enforce current status movement rules", async () => {
  const { canMovePatientStatus } = await importWebModule("lib/queue-dnd.ts");

  assert.equal(canMovePatientStatus("admin", "waiting", "consultation"), true);
  assert.equal(canMovePatientStatus("admin", "consultation", "done"), true);
  assert.equal(canMovePatientStatus("admin", "waiting", "done"), false);
  assert.equal(canMovePatientStatus("staff", "waiting", "consultation"), false);
  assert.equal(canMovePatientStatus("staff", "waiting", "waiting"), true);
});
