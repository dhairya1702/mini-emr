"use client";

import { FormEvent, useEffect, useState } from "react";
import { Download, Eye, FileText, Send, Sparkles, X } from "lucide-react";

import { Patient } from "@/lib/types";

interface ConsultationDrawerProps {
  patient: Patient | null;
  onClose: () => void;
  onDone: (patient: Patient) => Promise<void>;
  onGenerate: (payload: {
    patient_id: string;
    symptoms: string;
    diagnosis: string;
    medications: string;
    notes: string;
  }) => Promise<string>;
  onGeneratePdf: (payload: { patient_id: string; content: string }) => Promise<Blob>;
  onSend: (payload: { patient_id: string; phone: string; content: string }) => Promise<string>;
}

const emptyForm = {
  symptoms: "",
  diagnosis: "",
  medications: "",
  notes: "",
  generatedNote: "",
};

export function ConsultationDrawer({
  patient,
  onClose,
  onDone,
  onGenerate,
  onGeneratePdf,
  onSend,
}: ConsultationDrawerProps) {
  const [form, setForm] = useState(emptyForm);
  const [statusMessage, setStatusMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    setForm(emptyForm);
    setStatusMessage("");
  }, [patient?.id]);

  if (!patient) {
    return null;
  }

  async function handleGenerate(event?: FormEvent) {
    event?.preventDefault();
    setIsGenerating(true);
    setStatusMessage("");
    try {
      const content = await onGenerate({
        patient_id: patient.id,
        symptoms: form.symptoms,
        diagnosis: form.diagnosis,
        medications: form.medications,
        notes: form.notes,
      });
      setForm((current) => ({ ...current, generatedNote: content }));
      setStatusMessage("SOAP note generated.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSend() {
    if (!form.generatedNote.trim()) {
      setStatusMessage("Generate a note before sending.");
      return;
    }

    setIsSending(true);
    try {
      const message = await onSend({
        patient_id: patient.id,
        phone: patient.phone,
        content: form.generatedNote,
      });
      setStatusMessage(message);
    } finally {
      setIsSending(false);
    }
  }

  async function handlePdf(action: "preview" | "download") {
    if (!form.generatedNote.trim()) {
      setStatusMessage("Generate a note before creating the PDF.");
      return;
    }

    setIsGeneratingPdf(true);
    try {
      const blob = await onGeneratePdf({
        patient_id: patient.id,
        content: form.generatedNote,
      });
      const url = URL.createObjectURL(blob);

      if (action === "preview") {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = `${patient.name.replace(/\s+/g, "_")}_note.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }

      setStatusMessage("PDF ready.");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally {
      setIsGeneratingPdf(false);
    }
  }

  async function handleDone() {
    setIsCompleting(true);
    try {
      await onDone(patient);
      onClose();
    } finally {
      setIsCompleting(false);
    }
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-30 w-full max-w-2xl border-l-2 border-sky-300 bg-white p-5 shadow-[0_20px_60px_rgba(125,211,252,0.2)] sm:p-6">
      <div className="flex h-full flex-col">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-slate-600">Consultation</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{patient.name}</h2>
            <p className="mt-2 text-sm text-slate-700">
              {patient.phone} · {patient.reason}
            </p>
            <p className="mt-2 text-sm font-medium text-slate-700">
              Age {patient.age ?? "-"} · Temp{" "}
              {patient.temperature !== null ? `${patient.temperature} F` : "-"} · Weight{" "}
              {patient.weight !== null ? `${patient.weight} kg` : "-"} · Height{" "}
              {patient.height !== null ? `${patient.height} cm` : "-"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-sky-200 p-2 text-slate-700 transition hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="flex-1 space-y-4 overflow-y-auto pr-1" onSubmit={handleGenerate}>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Symptoms</span>
            <textarea
              rows={4}
              value={form.symptoms}
              onChange={(event) =>
                setForm((current) => ({ ...current, symptoms: event.target.value }))
              }
              className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
              placeholder="Chief complaints, duration, key context"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Diagnosis</span>
            <input
              value={form.diagnosis}
              onChange={(event) =>
                setForm((current) => ({ ...current, diagnosis: event.target.value }))
              }
              className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
              placeholder="Provisional or confirmed diagnosis"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Medications</span>
            <textarea
              rows={3}
              value={form.medications}
              onChange={(event) =>
                setForm((current) => ({ ...current, medications: event.target.value }))
              }
              className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
              placeholder="Prescriptions, dosage, duration"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Clinical Notes</span>
            <textarea
              rows={4}
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
              placeholder="Exam findings, vitals, advice, follow-up"
            />
          </label>

          <div className="rounded-[28px] border border-sky-200 bg-sky-50/50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-sky-600" />
                <span className="text-sm font-medium text-slate-900">Generated Note</span>
              </div>
              <button
                type="submit"
                disabled={isGenerating}
                className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4" />
                {isGenerating ? "Generating..." : "Generate Note"}
              </button>
            </div>
            <textarea
              rows={12}
              value={form.generatedNote}
              onChange={(event) =>
                setForm((current) => ({ ...current, generatedNote: event.target.value }))
              }
              className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-sky-400"
              placeholder="SOAP note will appear here"
            />
          </div>
        </form>

        <div className="mt-5 border-t border-sky-200 pt-4">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-700">{statusMessage || "Ready to generate and send."}</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
              <button
                type="button"
                disabled={isCompleting}
                onClick={handleDone}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-sky-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
              >
                {isCompleting ? "Moving..." : "Done"}
              </button>
              <button
                type="button"
                disabled={isGeneratingPdf}
                onClick={() => handlePdf("preview")}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
              >
                <Eye className="h-4 w-4" />
                {isGeneratingPdf ? "Preparing..." : "Preview"}
              </button>
              <button
                type="button"
                disabled={isGeneratingPdf}
                onClick={() => handlePdf("download")}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                {isGeneratingPdf ? "Preparing..." : "Download"}
              </button>
              <button
                type="button"
                disabled={isSending}
                onClick={handleSend}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                {isSending ? "Sending..." : "Send to WhatsApp"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
