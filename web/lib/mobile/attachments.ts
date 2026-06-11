import type { NoteAsset } from "@/lib/types";

export const NOTE_ASSET_MAX_BYTES = 6 * 1024 * 1024;
export const PATIENT_MEDIA_MAX_BYTES = 50 * 1024 * 1024;

export const noteAssetContentTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const patientMediaContentTypes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

type FileLike = {
  type: string;
  size: number;
};

export function isNoteAssetFile(file: FileLike) {
  return noteAssetContentTypes.has((file.type || "").toLowerCase());
}

export function isPatientMediaFile(file: FileLike) {
  return patientMediaContentTypes.has((file.type || "").toLowerCase());
}

export function validateMobileAttachmentFile(file: FileLike) {
  if (isNoteAssetFile(file)) {
    if (file.size > NOTE_ASSET_MAX_BYTES) {
      return "PDFs and photos must be 6 MB or smaller.";
    }
    return "";
  }
  if (isPatientMediaFile(file)) {
    if (file.size > PATIENT_MEDIA_MAX_BYTES) {
      return "Videos must be 50 MB or smaller.";
    }
    return "";
  }
  return "Only photos, PDFs, MP4, MOV, and WEBM files are supported.";
}

export function assetDataUrl(asset: NoteAsset) {
  return `data:${asset.content_type};base64,${asset.data_base64}`;
}
