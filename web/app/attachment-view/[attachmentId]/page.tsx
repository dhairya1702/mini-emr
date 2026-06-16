"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { api } from "@/lib/api";

function inferViewerKind(contentType: string) {
  if (contentType.startsWith("image/")) {
    return "image";
  }
  if (contentType.startsWith("video/")) {
    return "video";
  }
  return "document";
}

export default function AttachmentViewerPage() {
  const params = useParams<{ attachmentId: string }>();
  const attachmentId = typeof params?.attachmentId === "string" ? params.attachmentId : "";
  const [blobUrl, setBlobUrl] = useState("");
  const [contentType, setContentType] = useState("");
  const [error, setError] = useState("");
  const [mediaError, setMediaError] = useState("");

  useEffect(() => {
    if (!attachmentId) {
      setError("Attachment ID is missing.");
      return;
    }

    let active = true;
    let objectUrl = "";

    void api.downloadPatientAttachment(attachmentId)
      .then((blob) => {
        if (!active) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
        setContentType(blob.type || "application/octet-stream");
        setError("");
        setMediaError("");
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Failed to load attachment.");
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [attachmentId]);

  const viewerKind = useMemo(() => inferViewerKind(contentType), [contentType]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <div className="max-w-lg rounded-2xl border border-slate-700 bg-slate-900/90 p-6 text-center">
          <p className="text-lg font-semibold">Unable to open attachment</p>
          <p className="mt-3 text-sm text-slate-300">{error}</p>
        </div>
      </main>
    );
  }

  if (!blobUrl) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <p className="text-sm text-slate-300">Opening attachment...</p>
      </main>
    );
  }

  if (viewerKind === "image") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <img src={blobUrl} alt="Attachment" className="max-h-[96vh] max-w-[96vw] object-contain" />
      </main>
    );
  }

  if (viewerKind === "video") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 p-4 text-white">
        <video
          src={blobUrl}
          controls
          autoPlay
          playsInline
          preload="metadata"
          onError={() => {
            setMediaError(
              contentType === "video/quicktime"
                ? "This MOV file loaded, but the browser cannot play its codec. Download it or upload MP4/WebM for in-browser playback."
                : "This video loaded, but the browser cannot play it.",
            );
          }}
          className="max-h-[92vh] w-[min(96vw,1200px)] rounded-xl bg-black object-contain"
        />
        {mediaError ? (
          <div className="max-w-2xl rounded-2xl border border-amber-300/30 bg-amber-950/40 px-5 py-4 text-sm text-amber-100">
            <p>{mediaError}</p>
            <a
              href={blobUrl}
              download="attachment"
              className="mt-3 inline-flex rounded-lg border border-amber-200/40 px-3 py-1.5 font-medium text-amber-50 hover:bg-amber-200/10"
            >
              Download file
            </a>
          </div>
        ) : null}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950">
      <iframe src={blobUrl} title="Attachment" className="h-screen w-screen border-0" />
    </main>
  );
}
