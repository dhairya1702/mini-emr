import test from "node:test";
import assert from "node:assert/strict";

import { importWebModule } from "./load-web-module.mjs";

test("mobile attachment helpers classify note assets and patient media", async () => {
  const {
    isNoteAssetFile,
    isPatientMediaFile,
    validateMobileAttachmentFile,
  } = await importWebModule("lib/mobile/attachments.ts");

  assert.equal(isNoteAssetFile({ type: "image/png", size: 1024 }), true);
  assert.equal(isNoteAssetFile({ type: "application/pdf", size: 1024 }), true);
  assert.equal(isPatientMediaFile({ type: "video/mp4", size: 1024 }), true);
  assert.equal(isPatientMediaFile({ type: "image/png", size: 1024 }), false);
  assert.equal(validateMobileAttachmentFile({ type: "video/webm", size: 1024 }), "");
  assert.match(validateMobileAttachmentFile({ type: "text/plain", size: 1024 }), /Only photos/);
});

test("mobile attachment helpers enforce prototype size caps", async () => {
  const {
    NOTE_ASSET_MAX_BYTES,
    PATIENT_MEDIA_MAX_BYTES,
    validateMobileAttachmentFile,
  } = await importWebModule("lib/mobile/attachments.ts");

  assert.match(
    validateMobileAttachmentFile({ type: "application/pdf", size: NOTE_ASSET_MAX_BYTES + 1 }),
    /6 MB/,
  );
  assert.match(
    validateMobileAttachmentFile({ type: "video/mp4", size: PATIENT_MEDIA_MAX_BYTES + 1 }),
    /50 MB/,
  );
});
