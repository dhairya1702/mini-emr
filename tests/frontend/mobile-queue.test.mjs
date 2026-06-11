import test from "node:test";
import assert from "node:assert/strict";

import { importWebModule } from "./load-web-module.mjs";

function patient(id, status, lastVisitAt) {
  return {
    id,
    name: `Patient ${id}`,
    phone: "5550100000",
    email: "",
    address: "",
    reason: "Review",
    age: 30,
    weight: 70,
    height: 170,
    temperature: 98.6,
    status,
    billed: false,
    created_at: "2026-01-01T00:00:00+00:00",
    last_visit_at: lastVisitAt,
  };
}

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
  };
}

test("mobile queue only includes active consultation statuses", async () => {
  const { getMobileQueuePatients, isMobileQueuePatient } = await importWebModule("lib/mobile/queue.ts");
  const rows = [
    patient("done", "done", "2026-01-03T00:00:00+00:00"),
    patient("waiting", "waiting", "2026-01-01T00:00:00+00:00"),
    patient("consult", "consultation", "2026-01-02T00:00:00+00:00"),
  ];

  assert.equal(isMobileQueuePatient(rows[0]), false);
  assert.deepEqual(getMobileQueuePatients(rows).map((row) => row.id), ["consult", "waiting"]);
});

test("mobile consultation drafts are scoped and clearable", async () => {
  const localStorage = createStorage();
  globalThis.window = { localStorage };
  const {
    clearMobileConsultationDraft,
    readMobileConsultationDraft,
    resolveMobileConsultationScope,
    writeMobileConsultationDraft,
  } = await importWebModule("lib/mobile/consultation.ts");
  const scope = resolveMobileConsultationScope({ id: "u1", org_id: "o1" }, "p1");

  writeMobileConsultationDraft(scope, {
    symptoms: "Cough",
    diagnosis: "URI",
    medications: "Rest",
    notes: "Review if worse",
    generatedNote: "SOAP",
    noteId: "n1",
  });

  assert.equal(readMobileConsultationDraft(scope).noteId, "n1");
  assert.equal(readMobileConsultationDraft(resolveMobileConsultationScope({ id: "u2", org_id: "o1" }, "p1")), null);
  clearMobileConsultationDraft(scope);
  assert.equal(readMobileConsultationDraft(scope), null);
});
