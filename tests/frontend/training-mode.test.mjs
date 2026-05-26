import assert from "node:assert/strict";
import test from "node:test";

import { importWebModule } from "./load-web-module.mjs";

function installLocalStorage() {
  const values = new Map();
  global.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  };
  return values;
}

test("training mode state and patients are scoped per clinic user", async () => {
  installLocalStorage();
  const {
    createTrainingPatient,
    createTrainingScope,
    readTrainingMode,
    readTrainingPatients,
    writeTrainingMode,
    writeTrainingPatients,
  } = await importWebModule("lib/training-mode.ts");

  const userA = { org_id: "org-a", id: "user-a" };
  const userB = { org_id: "org-a", id: "user-b" };
  const scopeA = createTrainingScope(userA);
  const scopeB = createTrainingScope(userB);

  writeTrainingMode(scopeA, true);
  writeTrainingPatients(scopeA, [
    createTrainingPatient({
      name: "Practice Patient",
      phone: "123",
      email: "",
      address: "",
      reason: "training",
      age: 10,
      weight: 30,
      height: 120,
      temperature: 99,
    }),
  ]);

  assert.equal(readTrainingMode(scopeA), true);
  assert.equal(readTrainingMode(scopeB), false);
  assert.equal(readTrainingPatients(scopeA).length, 1);
  assert.equal(readTrainingPatients(scopeB).length, 0);
});

test("training reset clears sandbox patients but keeps mode flag", async () => {
  installLocalStorage();
  const {
    createTrainingPatient,
    resetTrainingData,
    readTrainingMode,
    readTrainingPatients,
    writeTrainingMode,
    writeTrainingPatients,
  } = await importWebModule("lib/training-mode.ts");

  const scope = "org:user";
  writeTrainingMode(scope, true);
  writeTrainingPatients(scope, [
    createTrainingPatient({
      name: "Practice Patient",
      phone: "123",
      email: "",
      address: "",
      reason: "training",
      age: null,
      weight: null,
      height: null,
      temperature: null,
    }),
  ]);

  resetTrainingData(scope);

  assert.equal(readTrainingMode(scope), true);
  assert.deepEqual(readTrainingPatients(scope), []);
});

test("training note generation is local and final", async () => {
  const { createTrainingNote } = await importWebModule("lib/training-mode.ts");

  const note = createTrainingNote({
    patient_id: "training-patient",
    symptoms: "Fever for two days",
    diagnosis: "Viral fever",
    medications: "Paracetamol",
    notes: "Hydration and follow-up",
  });

  assert.equal(note.status, "final");
  assert.match(note.noteId, /^training-note-/);
  assert.match(note.content, /TRAINING MODE NOTE/);
  assert.match(note.content, /Fever for two days/);
});
