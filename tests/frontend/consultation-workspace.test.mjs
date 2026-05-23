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

test("consultation workspace keys are namespaced by org, user, and patient", async () => {
  const storage = createStorage();
  globalThis.window = { localStorage: storage };

  const workspace = await importWebModule("lib/consultation-workspace.ts");
  const scope = workspace.resolveConsultationWorkspaceScope(
    { id: "user-1", org_id: "org-1" },
    "patient-1",
  );

  assert.deepEqual(scope, { orgId: "org-1", userId: "user-1", patientId: "patient-1" });

  workspace.writeConsultationWorkspace(scope, { form: { symptoms: "Blurred vision" } });

  assert.equal(
    storage.getItem("consultation-workspace:v2:org-1:user-1:patient-1") !== null,
    true,
  );
  assert.deepEqual(
    workspace.readConsultationWorkspace(scope),
    { form: { symptoms: "Blurred vision" } },
  );
});

test("consultation workspace drops malformed snapshots", async () => {
  const storage = createStorage();
  globalThis.window = { localStorage: storage };

  const workspace = await importWebModule("lib/consultation-workspace.ts");
  const scope = { orgId: "org-2", userId: "user-2", patientId: "patient-2" };
  const key = workspace.consultationWorkspaceKey(scope);
  storage.setItem(key, "{bad-json");

  assert.equal(workspace.readConsultationWorkspace(scope), null);
  assert.equal(storage.getItem(key), null);
});

test("consultation workspace migrates legacy patient-only drafts into v2 keys", async () => {
  const storage = createStorage();
  globalThis.window = { localStorage: storage };

  const workspace = await importWebModule("lib/consultation-workspace.ts");
  const scope = { orgId: "org-3", userId: "user-3", patientId: "patient-3" };
  storage.setItem(
    "consultation-workspace:patient-3",
    JSON.stringify({ form: { symptoms: "Migrated legacy draft" } }),
  );

  assert.deepEqual(
    workspace.readConsultationWorkspace(scope, { legacyPatientId: "patient-3" }),
    { form: { symptoms: "Migrated legacy draft" } },
  );
  assert.equal(storage.getItem("consultation-workspace:patient-3"), null);
  assert.equal(
    storage.getItem("consultation-workspace:v2:org-3:user-3:patient-3") !== null,
    true,
  );
});
