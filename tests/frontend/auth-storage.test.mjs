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

test("authStorage does not persist raw session tokens", async () => {
  const storage = createStorage();
  globalThis.window = { localStorage: storage, setTimeout, clearTimeout };

  const { authStorage } = await importWebModule("lib/auth.ts");
  authStorage.setSession(
    {
      token: "secret-token",
      user: { id: "u1", org_id: "o1", identifier: "owner@clinic.com", name: "Owner", role: "admin" },
    },
    Date.now() + 60_000,
  );

  assert.equal(storage.getItem("clinic_auth_token"), null);
  assert.equal(authStorage.getToken(), "");
  assert.equal(JSON.parse(storage.getItem("clinic_auth_user")).identifier, "owner@clinic.com");
});

test("api browser requests omit Authorization when using cookie sessions", async () => {
  const storage = createStorage();
  globalThis.window = { localStorage: storage, setTimeout, clearTimeout };

  let capturedHeaders = null;
  globalThis.fetch = async (_url, init) => {
    capturedHeaders = init?.headers ?? null;
    return new Response(JSON.stringify({
      id: "u1",
      org_id: "o1",
      identifier: "owner@clinic.com",
      name: "Owner",
      role: "admin",
      doctor_dob: null,
      doctor_address: "",
      doctor_signature_name: null,
      doctor_signature_url: null,
      doctor_signature_content_type: null,
      created_at: "2026-01-01T00:00:00+00:00",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const { api } = await importWebModule("lib/api.ts");
  await api.getCurrentUser();

  assert.ok(capturedHeaders);
  assert.equal("Authorization" in capturedHeaders, false);
});
