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
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  globalThis.window = { localStorage, sessionStorage, setTimeout, clearTimeout };

  const { authStorage } = await importWebModule("lib/auth.ts");
  authStorage.setSession(
    {
      token: "secret-token",
      user: { id: "u1", org_id: "o1", identifier: "owner@clinic.com", name: "Owner", role: "admin" },
    },
    Date.now() + 60_000,
  );

  assert.equal(localStorage.getItem("clinic_auth_token"), null);
  assert.equal(sessionStorage.getItem("clinic_auth_token"), "secret-token");
  assert.equal(authStorage.getToken(), "secret-token");
  assert.equal(JSON.parse(localStorage.getItem("clinic_auth_user")).identifier, "owner@clinic.com");
});

test("api browser requests attach sessionStorage bearer fallback", async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  sessionStorage.setItem("clinic_auth_token", "fallback-token");
  globalThis.window = { localStorage, sessionStorage, setTimeout, clearTimeout };

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
  assert.equal(capturedHeaders.Authorization, "Bearer fallback-token");
});
