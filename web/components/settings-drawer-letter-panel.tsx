"use client";

import { FormEvent } from "react";

export type LetterFormState = {
  to: string;
  subject: string;
  content: string;
  generated: string;
  recipient_email: string;
};

interface SettingsDrawerLetterPanelProps {
  letterForm: LetterFormState;
  letterError: string;
  letterStatus: string;
  isGeneratingLetter: boolean;
  isPreparingLetterPdf: boolean;
  isSendingLetter: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onChange: (patch: Partial<LetterFormState>) => void;
  onPreviewPdf: () => void | Promise<void>;
  onSend: () => void | Promise<void>;
}

export function SettingsDrawerLetterPanel({
  letterForm,
  letterError,
  letterStatus,
  isGeneratingLetter,
  isPreparingLetterPdf,
  isSendingLetter,
  onSubmit,
  onChange,
  onPreviewPdf,
  onSend,
}: SettingsDrawerLetterPanelProps) {
  return (
    <div className="space-y-4">
      <form className="rounded-[28px] border border-sky-200 bg-white p-5" onSubmit={onSubmit}>
        <div className="mb-4">
          <h3 className="text-base font-semibold text-slate-900">Generate Letter</h3>
          <p className="mt-2 text-sm leading-7 text-slate-600">
            Create a branded clinic letter for travel, school, consultation summaries, and similar requests.
          </p>
        </div>

        <div className="grid gap-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">To</span>
            <input
              value={letterForm.to}
              onChange={(event) => onChange({ to: event.target.value })}
              className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Subject</span>
            <input
              value={letterForm.subject}
              onChange={(event) => onChange({ subject: event.target.value })}
              className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Content</span>
            <textarea
              rows={6}
              value={letterForm.content}
              onChange={(event) => onChange({ content: event.target.value })}
              className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
            />
          </label>
          <label className="block rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recipient email</span>
            <span className="mt-1 block text-xs leading-5 text-slate-500">Used only when sending the letter by email.</span>
            <input
              type="email"
              value={letterForm.recipient_email}
              onChange={(event) => onChange({ recipient_email: event.target.value })}
              className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-sky-400"
            />
          </label>
        </div>

        {letterError ? <p className="mt-4 text-sm font-medium text-rose-600">{letterError}</p> : null}
        {letterStatus ? <p className="mt-4 text-sm font-medium text-emerald-700">{letterStatus}</p> : null}

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            type="submit"
            disabled={isGeneratingLetter}
            className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
          >
            {isGeneratingLetter ? "Generating..." : "Generate Letter"}
          </button>
          <button
            type="button"
            disabled={isPreparingLetterPdf}
            onClick={onPreviewPdf}
            className="rounded-full border border-sky-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
          >
            Preview
          </button>
          <button
            type="button"
            disabled={isSendingLetter}
            onClick={onSend}
            className="rounded-full border border-sky-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
          >
            {isSendingLetter ? "Sending..." : "Send Email"}
          </button>
        </div>
      </form>

      <div className="rounded-[28px] border border-sky-200 bg-white p-5">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-slate-900">Generated Draft</h3>
          <p className="mt-2 text-sm leading-7 text-slate-600">The PDF uses your clinic branding, footer, and current date.</p>
        </div>
        <textarea
          rows={16}
          value={letterForm.generated}
          onChange={(event) => onChange({ generated: event.target.value })}
          className="w-full rounded-2xl border border-sky-200 bg-sky-50/30 px-4 py-3 text-sm leading-7 text-slate-800 outline-none transition focus:border-sky-400"
        />
      </div>
    </div>
  );
}
