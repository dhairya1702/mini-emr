import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { importWebModule } from "./load-web-module.mjs";

const referral = await importWebModule("lib/referral-package.ts");

const patient = {
  id: "patient-1",
  name: "Reyna Patel",
  phone: "+919900000000",
  email: "reyna@example.com",
  reason: "Reduced vision",
};

test("referral drafts start with patient contact details and visit reason", () => {
  const draft = referral.createReferralDraft(patient);
  assert.equal(draft.recipientType, "patient");
  assert.equal(draft.patientEmail, patient.email);
  assert.equal(draft.patientPhone, patient.phone);
  assert.equal(draft.emailRecipients, patient.email);
  assert.equal(draft.whatsappRecipients, patient.phone);
  assert.equal(draft.reason, patient.reason);
});

test("patient contact details entered in the referral are frozen into the package", () => {
  const draft = referral.createReferralDraft({ ...patient, email: "", phone: "" });
  draft.patientEmail = "updated@example.com";
  draft.patientPhone = "+919811111111";
  draft.consultationNoteIds = ["note-1"];
  const payload = referral.buildReferralCreatePayload(draft);
  assert.equal(payload.recipient_email, "updated@example.com");
  assert.equal(payload.recipient_phone, "+919811111111");
});

test("referral validation requires clinical content and doctor identity when applicable", () => {
  const draft = referral.createReferralDraft(patient);
  assert.equal(referral.referralDraftError(draft), "Select at least one consultation, test, or attachment.");
  draft.recipientType = "doctor";
  draft.consultationNoteIds = ["note-1"];
  assert.equal(referral.referralDraftError(draft), "Enter the receiving doctor's name.");
  draft.doctorName = "Dr Shah";
  assert.equal(referral.referralDraftError(draft), "");
});

test("referral payload includes only explicitly selected frozen records", () => {
  const draft = referral.createReferralDraft(patient);
  draft.recipientType = "doctor";
  draft.doctorName = "Dr Shah";
  draft.doctorEmail = "shah@example.com";
  draft.consultationNoteIds = ["note-1"];
  draft.longitudinalTrackIds = ["test-1"];
  draft.attachmentIds = ["attachment-1"];
  const payload = referral.buildReferralCreatePayload(draft);
  assert.deepEqual(payload.consultation_note_ids, ["note-1"]);
  assert.deepEqual(payload.longitudinal_track_ids, ["test-1"]);
  assert.deepEqual(payload.attachment_ids, ["attachment-1"]);
  assert.equal(payload.recipient_name, "Dr Shah");
  assert.equal(payload.recipient_email, "shah@example.com");
});

test("recipient parsing removes blanks and duplicates", () => {
  assert.deepEqual(referral.splitRecipients("one@example.com, two@example.com; one@example.com\n"), ["one@example.com", "two@example.com"]);
});

test("referral package is available from desktop and mobile patient charts", async () => {
  const desktop = await readFile(new URL("../../web/components/patient-details-drawer.tsx", import.meta.url), "utf8");
  const mobile = await readFile(new URL("../../web/app/(mobile)/m/patient/[patientId]/page.tsx", import.meta.url), "utf8");
  assert.ok(desktop.includes("<ReferralPackageModal"));
  assert.ok(desktop.includes("canRefer"));
  assert.ok(mobile.includes("<ReferralPackageModal"));
  assert.ok(mobile.includes('currentUser?.role === "admin"'));
});
