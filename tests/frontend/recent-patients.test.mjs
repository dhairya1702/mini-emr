import test from "node:test";
import assert from "node:assert/strict";

import { importWebModule } from "./load-web-module.mjs";

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}

function patient(id, name = `Patient ${id}`) {
  return {
    id,
    org_id: "org-1",
    name,
    phone: "5550100000",
    email: "",
    address: "",
    reason: "Review",
    age: 30,
    weight: 70,
    height: 170,
    temperature: 98.6,
    status: "done",
    billed: false,
    created_at: "2026-01-01T00:00:00+00:00",
    last_visit_at: "2026-01-01T00:00:00+00:00",
  };
}

test("recent patients returns empty for missing or malformed storage", async () => {
  const localStorage = createStorage();
  globalThis.window = { localStorage };

  const { loadRecentPatients } = await importWebModule("lib/recent-patients.ts");
  assert.deepEqual(loadRecentPatients({ orgId: "org-1", userId: "user-1" }), []);

  localStorage.setItem("clinic_recent_patients:v2:org-1:user-1", "{bad json");
  assert.deepEqual(loadRecentPatients({ orgId: "org-1", userId: "user-1" }), []);
});

test("recent patients are deduped and scoped by org and user", async () => {
  const localStorage = createStorage();
  globalThis.window = { localStorage };

  const { loadRecentPatients, saveRecentPatient } = await importWebModule("lib/recent-patients.ts");
  const scope = { orgId: "org-1", userId: "user-1" };

  saveRecentPatient({ ...scope, patient: patient("p1", "One") });
  saveRecentPatient({ ...scope, patient: patient("p2", "Two") });
  saveRecentPatient({ ...scope, patient: patient("p1", "One Updated") });

  const scoped = loadRecentPatients(scope);
  assert.deepEqual(scoped.map((entry) => entry.id), ["p1", "p2"]);
  assert.equal(scoped[0].name, "One Updated");
  assert.deepEqual(loadRecentPatients({ orgId: "org-2", userId: "user-1" }), []);
  assert.deepEqual(loadRecentPatients({ orgId: "org-1", userId: "user-2" }), []);
});

test("recent patients migrate legacy storage into the scoped key", async () => {
  const localStorage = createStorage();
  globalThis.window = { localStorage };
  localStorage.setItem("clinic_recent_patients", JSON.stringify([patient("legacy")]));

  const { loadRecentPatients } = await importWebModule("lib/recent-patients.ts");
  const migrated = loadRecentPatients({ orgId: "org-1", userId: "user-1" });

  assert.deepEqual(migrated.map((entry) => entry.id), ["legacy"]);
  assert.ok(localStorage.getItem("clinic_recent_patients:v2:org-1:user-1"));
});
