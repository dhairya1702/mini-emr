"use client";

import { Fragment, FormEvent, useEffect, useState } from "react";
import { CalendarPlus2, Eye, FileText, Send, Sparkles, X } from "lucide-react";

import { EyeExamEntry, Patient, TestScoreEntry } from "@/lib/types";

interface ConsultationDrawerProps {
  patient: Patient | null;
  onClose: () => void;
  onDone: (
    patient: Patient,
    followUp?: { scheduled_for: string; notes: string },
  ) => Promise<void>;
  onGenerate: (payload: {
    patient_id: string;
    symptoms: string;
    diagnosis: string;
    medications: string;
    notes: string;
    blood_pressure_systolic?: number | null;
    blood_pressure_diastolic?: number | null;
    pulse?: number | null;
    spo2?: number | null;
    blood_sugar?: number | null;
    test_scores?: TestScoreEntry[];
    eye_exam?: EyeExamEntry[];
  }) => Promise<string>;
  onGeneratePdf: (payload: { patient_id: string; content: string }) => Promise<Blob>;
  onSend: (payload: { patient_id: string; phone: string; content: string }) => Promise<string>;
}

function createEmptyForm() {
  return {
    symptoms: "",
    diagnosis: "",
    medications: "",
    notes: "",
    bloodPressureSystolic: "",
    bloodPressureDiastolic: "",
    pulse: "",
    spo2: "",
    bloodSugar: "",
    testScores: [{ id: crypto.randomUUID(), label: "", value: "" }],
    eyeExam: [
      { eye: "right", sphere: "", cylinder: "", axis: "", vision: "" },
      { eye: "left", sphere: "", cylinder: "", axis: "", vision: "" },
    ] as EyeExamEntry[],
    followUpDate: "",
    followUpNotes: "",
    generatedNote: "",
  };
}

export function ConsultationDrawer({
  patient,
  onClose,
  onDone,
  onGenerate,
  onGeneratePdf,
  onSend,
}: ConsultationDrawerProps) {
  const [form, setForm] = useState(createEmptyForm);
  const [openSections, setOpenSections] = useState({
    vitals: false,
    testScores: false,
    eyeExam: false,
  });
  const [statusMessage, setStatusMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isFollowUpOpen, setIsFollowUpOpen] = useState(false);
  const [hasGeneratedNote, setHasGeneratedNote] = useState(false);

  useEffect(() => {
    setForm(createEmptyForm());
    setOpenSections({
      vitals: false,
      testScores: false,
      eyeExam: false,
    });
    setStatusMessage("");
    setIsFollowUpOpen(false);
    setHasGeneratedNote(false);
  }, [patient?.id]);

  if (!patient) {
    return null;
  }

  const currentPatient = patient;

  async function handleGenerate(event?: FormEvent) {
    event?.preventDefault();
    setIsGenerating(true);
    setStatusMessage("");
    try {
      const content = await onGenerate({
        patient_id: currentPatient.id,
        symptoms: form.symptoms,
        diagnosis: form.diagnosis,
        medications: form.medications,
        notes: form.notes,
        blood_pressure_systolic: form.bloodPressureSystolic ? Number(form.bloodPressureSystolic) : null,
        blood_pressure_diastolic: form.bloodPressureDiastolic ? Number(form.bloodPressureDiastolic) : null,
        pulse: form.pulse ? Number(form.pulse) : null,
        spo2: form.spo2 ? Number(form.spo2) : null,
        blood_sugar: form.bloodSugar ? Number(form.bloodSugar) : null,
        test_scores: form.testScores
          .filter((entry) => entry.label.trim() && entry.value.trim())
          .map((entry) => ({ label: entry.label.trim(), value: entry.value.trim() })),
        eye_exam: form.eyeExam.filter((entry) =>
          entry.sphere.trim() || entry.cylinder.trim() || entry.axis.trim() || entry.vision.trim(),
        ),
      });
      setForm((current) => ({ ...current, generatedNote: content }));
      setHasGeneratedNote(true);
      setStatusMessage("SOAP note generated.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to generate SOAP note.");
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
        patient_id: currentPatient.id,
        phone: currentPatient.phone,
        content: form.generatedNote,
      });
      setStatusMessage(message);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to send note.");
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
        patient_id: currentPatient.id,
        content: form.generatedNote,
      });
      const url = URL.createObjectURL(blob);

      if (action === "preview") {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = `${currentPatient.name.replace(/\s+/g, "_")}_note.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }

      setStatusMessage("PDF ready.");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to prepare PDF.");
    } finally {
      setIsGeneratingPdf(false);
    }
  }

  async function handleDone() {
    if (!hasGeneratedNote || !form.generatedNote.trim()) {
      setStatusMessage("Generate the consultation note before marking this patient done.");
      return;
    }

    setIsCompleting(true);
    try {
      const followUp =
        form.followUpDate.trim()
          ? {
              scheduled_for: new Date(`${form.followUpDate}T09:00:00`).toISOString(),
              notes: form.followUpNotes.trim(),
            }
          : undefined;
      await onDone(currentPatient, followUp);
      onClose();
    } finally {
      setIsCompleting(false);
    }
  }

  function updateTestScore(id: string, patch: Partial<TestScoreEntry>) {
    setForm((current) => ({
      ...current,
      testScores: current.testScores.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    }));
  }

  function addTestScore() {
    setForm((current) => ({
      ...current,
      testScores: [...current.testScores, { id: crypto.randomUUID(), label: "", value: "" }],
    }));
  }

  function removeTestScore(id: string) {
    setForm((current) => ({
      ...current,
      testScores: current.testScores.length > 1
        ? current.testScores.filter((entry) => entry.id !== id)
        : [{ id: crypto.randomUUID(), label: "", value: "" }],
    }));
  }

  function updateEyeExam(eye: "right" | "left", patch: Partial<EyeExamEntry>) {
    setForm((current) => ({
      ...current,
      eyeExam: current.eyeExam.map((entry) => (entry.eye === eye ? { ...entry, ...patch } : entry)),
    }));
  }

  function toggleSection(section: keyof typeof openSections) {
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));
  }

  const hasVitals =
    Boolean(form.bloodPressureSystolic.trim()) ||
    Boolean(form.bloodPressureDiastolic.trim()) ||
    Boolean(form.pulse.trim()) ||
    Boolean(form.spo2.trim()) ||
    Boolean(form.bloodSugar.trim());
  const filledTestScores = form.testScores.filter((entry) => entry.label.trim() || entry.value.trim());
  const hasTestScores = filledTestScores.length > 0;
  const filledEyeExam = form.eyeExam.filter(
    (entry) => entry.sphere.trim() || entry.cylinder.trim() || entry.axis.trim() || entry.vision.trim(),
  );
  const hasEyeExam = filledEyeExam.length > 0;

  const sectionSuggestions = [
    {
      key: "vitals" as const,
      label: "Vitals",
      active: openSections.vitals || hasVitals,
    },
    {
      key: "testScores" as const,
      label: "Test Scores",
      active: openSections.testScores || hasTestScores,
    },
    {
      key: "eyeExam" as const,
      label: "Eye Exam",
      active: openSections.eyeExam || hasEyeExam,
    },
  ];

  return (
    <aside className="fixed inset-y-0 right-0 z-30 w-full max-w-2xl border-l-2 border-sky-300 bg-white p-5 shadow-[0_20px_60px_rgba(125,211,252,0.2)] sm:p-6">
      <div className="flex h-full flex-col">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-slate-600">Consultation</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{currentPatient.name}</h2>
            <p className="mt-2 text-sm text-slate-700">
              {currentPatient.phone} · {currentPatient.reason}
            </p>
            <p className="mt-2 text-sm font-medium text-slate-700">
              Age {currentPatient.age ?? "-"} · Temp{" "}
              {currentPatient.temperature !== null ? `${currentPatient.temperature} F` : "-"} · Weight{" "}
              {currentPatient.weight !== null ? `${currentPatient.weight} kg` : "-"} · Height{" "}
              {currentPatient.height !== null ? `${currentPatient.height} cm` : "-"}
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

          <div className="flex flex-wrap gap-2">
            {sectionSuggestions.map((section) => (
              <button
                key={section.key}
                type="button"
                onClick={() => toggleSection(section.key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  section.active
                    ? "border-sky-300 bg-sky-100 text-sky-800"
                    : "border-sky-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50"
                }`}
              >
                {section.active ? `${section.label} Added` : `+ ${section.label}`}
              </button>
            ))}
          </div>

          {openSections.vitals ? (
            <div className="rounded-[28px] border border-sky-200 bg-white p-4">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Vitals & Measurements</p>
                  <p className="mt-1 text-xs text-slate-500">Structured findings will be included in the generated note.</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleSection("vitals")}
                  className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-sky-50"
                >
                  Hide
                </button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">BP</span>
                  <div className="flex gap-2">
                    <input
                      value={form.bloodPressureSystolic}
                      inputMode="numeric"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, bloodPressureSystolic: event.target.value }))
                      }
                      placeholder="120"
                      className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                    <input
                      value={form.bloodPressureDiastolic}
                      inputMode="numeric"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, bloodPressureDiastolic: event.target.value }))
                      }
                      placeholder="80"
                      className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Pulse</span>
                  <input
                    value={form.pulse}
                    inputMode="numeric"
                    onChange={(event) => setForm((current) => ({ ...current, pulse: event.target.value }))}
                    placeholder="72 bpm"
                    className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">SpO2</span>
                  <input
                    value={form.spo2}
                    inputMode="numeric"
                    onChange={(event) => setForm((current) => ({ ...current, spo2: event.target.value }))}
                    placeholder="98"
                    className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Blood Sugar</span>
                  <input
                    value={form.bloodSugar}
                    inputMode="decimal"
                    onChange={(event) => setForm((current) => ({ ...current, bloodSugar: event.target.value }))}
                    placeholder="110"
                    className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                  />
                </label>
              </div>
            </div>
          ) : null}

          {openSections.testScores ? (
            <div className="rounded-[28px] border border-sky-200 bg-white p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Test Scores</p>
                  <p className="mt-1 text-xs text-slate-500">Add exam values like visual acuity, pain score, or other structured results.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={addTestScore}
                    className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100"
                  >
                    Add Score
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSection("testScores")}
                    className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-sky-50"
                  >
                    Hide
                  </button>
                </div>
              </div>
              <div className="space-y-3">
                {form.testScores.map((entry) => (
                  <div key={entry.id} className="grid gap-3 md:grid-cols-[1fr_1fr_44px]">
                    <input
                      value={entry.label}
                      onChange={(event) => updateTestScore(entry.id!, { label: event.target.value })}
                      placeholder="Test name"
                      className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                    <input
                      value={entry.value}
                      onChange={(event) => updateTestScore(entry.id!, { value: event.target.value })}
                      placeholder="Result"
                      className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                    <button
                      type="button"
                      onClick={() => removeTestScore(entry.id!)}
                      className="rounded-full border border-sky-200 bg-white p-2 text-slate-600 transition hover:bg-sky-50"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {openSections.eyeExam ? (
            <div className="rounded-[28px] border border-sky-200 bg-white p-4">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Eye Exam</p>
                  <p className="mt-1 text-xs text-slate-500">Optional refraction or vision entries for right and left eye.</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleSection("eyeExam")}
                  className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-sky-50"
                >
                  Hide
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-[110px_repeat(4,minmax(0,1fr))]">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Eye</div>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Sphere</div>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Cylinder</div>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Axis</div>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Vision</div>
                {form.eyeExam.map((entry) => (
                  <Fragment key={entry.eye}>
                    <div className="rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-sm font-medium capitalize text-slate-700">
                      {entry.eye}
                    </div>
                    <input
                      value={entry.sphere}
                      onChange={(event) => updateEyeExam(entry.eye, { sphere: event.target.value })}
                      placeholder="-1.25"
                      className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                    <input
                      value={entry.cylinder}
                      onChange={(event) => updateEyeExam(entry.eye, { cylinder: event.target.value })}
                      placeholder="-0.50"
                      className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                    <input
                      value={entry.axis}
                      onChange={(event) => updateEyeExam(entry.eye, { axis: event.target.value })}
                      placeholder="90"
                      className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                    <input
                      value={entry.vision}
                      onChange={(event) => updateEyeExam(entry.eye, { vision: event.target.value })}
                      placeholder="6/6"
                      className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                  </Fragment>
                ))}
              </div>
            </div>
          ) : null}

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
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-700">{statusMessage || "Ready to generate and send."}</p>
            <div className="flex flex-col gap-3">
              {isFollowUpOpen ? (
                <div className="rounded-[24px] border border-sky-200 bg-sky-50/40 p-4">
                  <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">Follow-up Date</span>
                      <input
                        type="date"
                        value={form.followUpDate}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, followUpDate: event.target.value }))
                        }
                        className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">Follow-up Notes</span>
                      <input
                        value={form.followUpNotes}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, followUpNotes: event.target.value }))
                        }
                        placeholder="Review symptoms, BP check, lab result review"
                        className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                      />
                    </label>
                  </div>
                </div>
              ) : null}
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
                onClick={() => setIsFollowUpOpen((current) => !current)}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
              >
                <CalendarPlus2 className="h-4 w-4" />
                {isFollowUpOpen ? "Hide Follow-up" : "Follow-up"}
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
      </div>
    </aside>
  );
}
