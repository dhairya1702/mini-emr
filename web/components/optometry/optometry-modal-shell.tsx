"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

type OptometryModalShellProps = {
  open: boolean;
  title: string;
  description: string;
  saveLabel: string;
  onClose: () => void;
  onSave: () => void;
  children: ReactNode;
  isSaving?: boolean;
};

export function OptometryModalShell({
  open,
  title,
  description,
  saveLabel,
  onClose,
  onSave,
  children,
  isSaving = false,
}: OptometryModalShellProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-[32px] border border-sky-200 bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.35)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Optometry Module</p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">{title}</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-sky-200 p-2 text-slate-600 transition hover:bg-sky-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 space-y-5">{children}</div>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-sky-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-sky-50">
            Cancel
          </button>
          <button type="button" disabled={isSaving} onClick={onSave} className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
            {isSaving ? "Saving..." : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
