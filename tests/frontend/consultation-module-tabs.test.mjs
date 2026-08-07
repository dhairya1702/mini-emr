import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../web/components/consultation-drawer.tsx", import.meta.url), "utf8");

test("consultation examination modules use a compact tab strip", () => {
  assert.ok(source.includes('role="tablist" aria-label="Clinical modules"'));
  assert.ok(source.includes('aria-current={active ? "page" : undefined}'));
  assert.ok(source.includes('? "bg-[#376f9f] text-white"'));
  assert.equal(source.includes('>Tests</p>'), false);
});

test("eye exam follows tabs without a redundant examination card", () => {
  assert.equal(source.includes('<h3 className="text-xl font-semibold text-slate-900">Examination</h3>'), false);
  assert.ok(source.includes('activeInlineModule !== "vitals" ? <EyeExamModal'));
});
