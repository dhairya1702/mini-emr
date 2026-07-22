"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

type OptometryModalShellProps = {
  open: boolean;
  title: string;
  description: string;
  saveLabel: string;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  children: ReactNode;
  isSaving?: boolean;
  inline?: boolean;
  sidebar?: ReactNode;
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
  inline = false,
  sidebar,
}: OptometryModalShellProps) {
  if (!open) {
    return null;
  }

  if (inline) {
    return (
      <div className="space-y-5">
        {children}
        <div className="flex justify-end">
          <button type="button" disabled={isSaving} onClick={onSave} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
            {isSaving ? "Saving..." : saveLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-[20px] border border-[#bfd7e8] bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.35)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Optometry Module</p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">{title}</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-[#bfd7e8] p-2 text-slate-600 transition hover:bg-[#f3f8fb]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {sidebar ? (
          <div className="mt-6 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="max-h-[68vh] overflow-y-auto rounded-[18px] border border-[#dbe7ef] bg-[#f3f8fb]/50 p-4">
              {sidebar}
            </aside>
            <div className="min-w-0 space-y-5">{children}</div>
          </div>
        ) : (
          <div className="mt-6 space-y-5">{children}</div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-[#bfd7e8] bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb]">
            Cancel
          </button>
          <button type="button" disabled={isSaving} onClick={onSave} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
            {isSaving ? "Saving..." : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
