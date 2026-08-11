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

test("referral consultation rows use the short historical visit reason", () => {
  assert.equal(referral.referralConsultationReason("Routine eye examination", "Current complaint"), "Routine eye examination");
  assert.equal(referral.referralConsultationReason("", "Current complaint"), "Current complaint");
  assert.equal(referral.referralConsultationReason("", ""), "Consultation");
});

test("referral flow is available from desktop and mobile patient charts", async () => {
  const desktop = await readFile(new URL("../../web/components/patient-details-drawer.tsx", import.meta.url), "utf8");
  const mobile = await readFile(new URL("../../web/app/(mobile)/m/patient/[patientId]/page.tsx", import.meta.url), "utf8");
  assert.ok(desktop.includes("<ReferralPackageModal"));
  assert.ok(desktop.includes("canRefer"));
  assert.ok(mobile.includes("<ReferralPackageModal"));
  assert.ok(mobile.includes('currentUser?.role === "admin"'));
});

test("referral generation shows a dedicated progress spinner", async () => {
  const modal = await readFile(new URL("../../web/components/referral-package-modal.tsx", import.meta.url), "utf8");
  assert.ok(modal.includes("Preparing the referral…"));
  assert.ok(modal.includes('role="status"'));
  assert.ok(modal.includes("animate-spin"));
});

test("generated referral locks recipients, hides message editing, and places actions below them", async () => {
  const modal = await readFile(new URL("../../web/components/referral-package-modal.tsx", import.meta.url), "utf8");
  assert.ok(modal.includes(">Email:</dt>"));
  assert.ok(modal.includes(">Number:</dt>"));
  assert.ok(modal.includes('draft.recipientType !== "doctor"'));
  assert.ok(modal.includes('draft.recipientType !== "patient"'));
  assert.ok(!modal.includes('label="Email Recipients"'));
  assert.ok(!modal.includes('label="Phone Numbers"'));
  assert.ok(!modal.includes(">Message:</dt>"));
  assert.ok(!modal.includes("deliveryMessage"));
  const downloadIndex = modal.indexOf("Download Referral");
  const emailIndex = modal.indexOf("Send Email");
  const phoneIndex = modal.indexOf("Send Phone");
  assert.ok(downloadIndex > 0 && downloadIndex < emailIndex && emailIndex < phoneIndex);
});

test("referral UI uses plain clinical language", async () => {
  const modal = await readFile(new URL("../../web/components/referral-package-modal.tsx", import.meta.url), "utf8");
  assert.ok(modal.includes(">Referral</h2>"));
  assert.ok(modal.includes("Choose Information"));
  assert.ok(modal.includes("Included Information"));
  assert.ok(modal.includes("Referral ready"));
  assert.ok(!modal.includes(">Referral Package</h2>"));
  assert.ok(!modal.includes("No referral packages yet."));
  assert.ok(!modal.includes("Package Contents"));
  assert.ok(!modal.includes("Create Frozen Package"));
  assert.ok(!modal.includes("Generate Referral PDF"));
  assert.ok(!modal.includes("Package generated"));
});
