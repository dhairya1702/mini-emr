"use client";
/* eslint-disable @next/next/no-img-element */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type NoteAttachmentAsset = {
  id: string;
  kind: "attachment" | "drawing";
  name: string;
  content_type: string;
  data_base64?: string;
};

function inferViewerKind(contentType: string) {
  if (contentType.startsWith("image/")) {
    return "image";
  }
  if (contentType.startsWith("video/")) {
    return "video";
  }
  return "document";
}

function NoteAttachmentViewerContent() {
  const searchParams = useSearchParams();
  const key = searchParams.get("key") || "";
  const [asset, setAsset] = useState<NoteAttachmentAsset | null>(null);
  const [blobUrl, setBlobUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!key) {
      setError("Attachment key is missing.");
      return;
    }
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) {
        setError("Attachment data is unavailable.");
        return;
      }
      const parsed = JSON.parse(raw) as NoteAttachmentAsset;
      setAsset(parsed);
      window.sessionStorage.removeItem(key);
    } catch {
      setError("Failed to read attachment data.");
    }
  }, [key]);

  useEffect(() => {
    if (!asset) {
      return;
    }
    if (!asset.data_base64) {
      setError("Attachment data is unavailable.");
      return;
    }
    const binary = window.atob(asset.data_base64 || "");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const nextBlobUrl = URL.createObjectURL(new Blob([bytes], { type: asset.content_type || "application/octet-stream" }));
    setBlobUrl(nextBlobUrl);
    return () => URL.revokeObjectURL(nextBlobUrl);
  }, [asset]);

  const viewerKind = useMemo(() => inferViewerKind(asset?.content_type || ""), [asset?.content_type]);

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

  if (!blobUrl || !asset) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <p className="text-sm text-slate-300">Opening attachment...</p>
      </main>
    );
  }

  if (viewerKind === "image") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <img src={blobUrl} alt={asset.name || "Attachment"} className="max-h-[96vh] max-w-[96vw] object-contain" />
      </main>
    );
  }

  if (viewerKind === "video") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <video src={blobUrl} controls autoPlay className="max-h-[96vh] max-w-[96vw]" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950">
      <embed src={blobUrl} type={asset.content_type} className="h-screen w-screen" />
    </main>
  );
}

export default function NoteAttachmentViewerPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
          <p className="text-sm text-slate-300">Opening attachment...</p>
        </main>
      }
    >
      <NoteAttachmentViewerContent />
    </Suspense>
  );
}
