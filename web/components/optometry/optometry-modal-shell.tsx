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
  footer?: ReactNode;
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
  footer,
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
        {footer ?? <div className="flex justify-end">
          <button type="button" disabled={isSaving} onClick={onSave} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
            {isSaving ? "Saving..." : saveLabel}
          </button>
        </div>}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 bg-white">
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#dbe7ef] px-3 py-3 sm:gap-4 sm:border-b-0 sm:px-6 sm:pt-6">
          <div className="min-w-0">
            <h3 className="truncate text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h3>
            <p className="mt-1 line-clamp-2 max-w-3xl text-xs leading-5 text-slate-600 sm:mt-2 sm:text-sm sm:leading-6">{description}</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-xl border border-[#bfd7e8] p-2 text-slate-600 transition hover:bg-[#f3f8fb]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {sidebar ? (
          <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="max-h-[145px] overflow-y-auto border-b border-[#dbe7ef] bg-[#f3f8fb]/50 p-3 sm:max-h-[180px] sm:p-4 lg:max-h-none lg:border-b-0 lg:border-r">
              {sidebar}
            </aside>
            <div className="min-w-0 flex-1 space-y-3 overflow-y-auto px-2 py-3 max-sm:[&_input]:rounded-lg max-sm:[&_input]:px-3 max-sm:[&_input]:py-2 max-sm:[&_input]:text-sm max-sm:[&_label_span]:mb-1 max-sm:[&_section]:rounded-xl max-sm:[&_section]:p-3 max-sm:[&_textarea]:rounded-lg max-sm:[&_textarea]:px-3 max-sm:[&_textarea]:py-2 max-sm:[&_textarea]:text-sm sm:space-y-5 sm:px-6 sm:py-5">{children}</div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 py-3 max-sm:[&_input]:rounded-lg max-sm:[&_input]:px-3 max-sm:[&_input]:py-2 max-sm:[&_input]:text-sm max-sm:[&_label_span]:mb-1 max-sm:[&_section]:rounded-xl max-sm:[&_section]:p-3 max-sm:[&_textarea]:rounded-lg max-sm:[&_textarea]:px-3 max-sm:[&_textarea]:py-2 max-sm:[&_textarea]:text-sm sm:space-y-5 sm:px-6 sm:py-5">{children}</div>
        )}

        {footer ?? <div className="flex shrink-0 justify-end gap-2 border-t border-[#dbe7ef] px-3 py-3 sm:gap-3 sm:px-6">
          <button type="button" onClick={onClose} className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb] sm:px-5 sm:py-3">
            Cancel
          </button>
          <button type="button" disabled={isSaving} onClick={onSave} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 sm:px-5 sm:py-3">
            {isSaving ? "Saving..." : saveLabel}
          </button>
        </div>}
      </div>
    </div>
  );
}
