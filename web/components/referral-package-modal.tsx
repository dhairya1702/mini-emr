"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Download,
  FileCheck2,
  FileText,
  Mail,
  MessageCircle,
  Paperclip,
  Plus,
  RefreshCw,
  Stethoscope,
  X,
} from "lucide-react";

import { api } from "@/lib/api";
import {
  buildReferralCreatePayload,
  createReferralDraft,
  referralConsultationReason,
  referralDraftError,
  referralRecordCount,
  splitRecipients,
  type ReferralDraft,
} from "@/lib/referral-package";
import type {
  ConsultationNote,
  LongitudinalTrackRecord,
  Patient,
  PatientAttachment,
  ReferralPackage,
  ReferralRecipientType,
} from "@/lib/types";

type WizardStep = 1 | 2 | 3;

const STEP_LABELS = ["Referral Details", "Choose Information", "Review & Send"];

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBytes(value?: number | null) {
  if (!value) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function moduleLabel(value: string) {
  const labels: Record<string, string> = {
    eye_exam: "Eye Exam",
    contact_lens: "Contact Lens",
    binocular_vision: "Binocular Vision",
    low_vision: "Low Vision",
    myopia_management: "Myopia Management",
    tbi_evaluation: "Neurovision / TBI",
    pediatric_growth_measurement: "Pediatric Growth",
    well_child_visit: "Well-child Visit",
  };
  return labels[value] || value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function recordSummary(record: LongitudinalTrackRecord) {
  const summary = record.summary_fields?.summary ?? record.summary_fields?.result;
  return typeof summary === "string" && summary.trim() ? summary.trim() : `${moduleLabel(record.track_type)} saved`;
}

function toggleId(values: string[], id: string) {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
}

function canEmbedAttachment(contentType: string) {
  const normalized = contentType.toLowerCase();
  return normalized === "application/pdf" || normalized.startsWith("image/");
}

function Checkbox({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <button type="button" onClick={onChange} className="flex items-center gap-3 text-left">
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${checked ? "border-[#2f8fd3] bg-[#2f8fd3] text-white" : "border-slate-300 bg-white"}`}>
        {checked ? <Check className="h-3.5 w-3.5" /> : null}
      </span>
      <span className="text-sm text-slate-800">{label}</span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-800">{label}</span>
      {children}
    </label>
  );
}

const inputClass = "w-full rounded-lg border border-[#bfd7e8] bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#2f8fd3] focus:ring-2 focus:ring-[#2f8fd3]/10";

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function ReferralPackageModal({
  open,
  patient,
  onClose,
}: {
  open: boolean;
  patient: Patient;
  onClose: () => void;
}) {
  const [step, setStep] = useState<WizardStep>(1);
  const [draft, setDraft] = useState<ReferralDraft>(() => createReferralDraft(patient));
  const [notes, setNotes] = useState<ConsultationNote[]>([]);
  const [tests, setTests] = useState<LongitudinalTrackRecord[]>([]);
  const [attachments, setAttachments] = useState<PatientAttachment[]>([]);
  const [history, setHistory] = useState<ReferralPackage[]>([]);
  const [createdReferral, setCreatedReferral] = useState<ReferralPackage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectableNotes = useMemo(
    () => [...notes].filter((note) => note.status !== "draft").sort((a, b) => new Date(b.finalized_at || b.created_at).getTime() - new Date(a.finalized_at || a.created_at).getTime()),
    [notes],
  );
  const sortedTests = useMemo(
    () => [...tests].sort((a, b) => new Date(b.measured_at).getTime() - new Date(a.measured_at).getTime()),
    [tests],
  );

  useEffect(() => {
    if (!open) return;
    let active = true;
    const nextDraft = createReferralDraft(patient);
    setDraft(nextDraft);
    setStep(1);
    setCreatedReferral(null);
    setError("");
    setSuccess("");
    setIsLoading(true);
    Promise.all([
      api.listPatientNotes(patient.id),
      api.listPatientModuleEntries(patient.id),
      api.listPatientAttachments(patient.id),
      api.listPatientReferrals(patient.id).catch(() => [] as ReferralPackage[]),
    ])
      .then(([noteRows, testRows, attachmentRows, referralRows]) => {
        if (!active) return;
        const completedNotes = noteRows
          .filter((note) => note.status !== "draft")
          .sort((a, b) => new Date(b.finalized_at || b.created_at).getTime() - new Date(a.finalized_at || a.created_at).getTime());
        setNotes(noteRows);
        setTests(testRows);
        setAttachments(attachmentRows);
        setHistory(referralRows);
        setDraft((current) => ({
          ...current,
          consultationNoteIds: completedNotes[0] ? [completedNotes[0].id] : [],
        }));
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Failed to load referral records.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [open, patient]);

  if (!open) return null;

  const selectedCount = referralRecordCount(draft);
  const emailRecipientCount = splitRecipients(draft.emailRecipients).length;
  const phoneRecipientCount = splitRecipients(draft.whatsappRecipients).length;

  function update<K extends keyof ReferralDraft>(key: K, value: ReferralDraft[K]) {
    if (key !== "emailRecipients" && key !== "whatsappRecipients") {
      setCreatedReferral(null);
    }
    setError("");
    setSuccess("");
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function chooseRecipientType(value: ReferralRecipientType) {
    const emails = value === "patient"
      ? draft.patientEmail
      : value === "doctor"
        ? draft.doctorEmail
        : [draft.patientEmail, draft.doctorEmail].filter(Boolean).join(", ");
    const phones = value === "patient"
      ? draft.patientPhone
      : value === "doctor"
        ? draft.doctorPhone
        : [draft.patientPhone, draft.doctorPhone].filter(Boolean).join(", ");
    setDraft((current) => ({ ...current, recipientType: value, emailRecipients: emails, whatsappRecipients: phones }));
  }

  function updatePatientEmail(value: string) {
    setDraft((current) => ({
      ...current,
      patientEmail: value,
      emailRecipients: current.recipientType === "both"
        ? [value, current.doctorEmail].filter(Boolean).join(", ")
        : current.recipientType === "patient" ? value : current.emailRecipients,
    }));
  }

  function updatePatientPhone(value: string) {
    setDraft((current) => ({
      ...current,
      patientPhone: value,
      whatsappRecipients: current.recipientType === "both"
        ? [value, current.doctorPhone].filter(Boolean).join(", ")
        : current.recipientType === "patient" ? value : current.whatsappRecipients,
    }));
  }

  function updateDoctorEmail(value: string) {
    setDraft((current) => ({
      ...current,
      doctorEmail: value,
      emailRecipients: current.recipientType === "both"
        ? [current.patientEmail, value].filter(Boolean).join(", ")
        : current.recipientType === "doctor" ? value : current.emailRecipients,
    }));
  }

  function updateDoctorPhone(value: string) {
    setDraft((current) => ({
      ...current,
      doctorPhone: value,
      whatsappRecipients: current.recipientType === "both"
        ? [current.patientPhone, value].filter(Boolean).join(", ")
        : current.recipientType === "doctor" ? value : current.whatsappRecipients,
    }));
  }

  function continueFromDetails() {
    if (!draft.reason.trim()) return setError("Enter the reason for referral.");
    if (draft.recipientType !== "patient" && !draft.doctorName.trim()) return setError("Enter the receiving doctor's name.");
    setError("");
    setStep(2);
  }

  function continueFromRecords() {
    const message = referralDraftError(draft);
    if (message) return setError(message);
    setError("");
    setStep(3);
  }

  async function ensureReferral() {
    if (createdReferral) return createdReferral;
    const message = referralDraftError(draft);
    if (message) throw new Error(message);
    const saved = await api.createPatientReferral(patient.id, buildReferralCreatePayload(draft));
    setCreatedReferral(saved);
    setHistory((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    return saved;
  }

  async function run(action: string, task: () => Promise<void>) {
    setBusyAction(action);
    setError("");
    setSuccess("");
    try {
      await task();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The referral action failed.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleGenerate() {
    await run("generate", async () => {
      await ensureReferral();
      setSuccess("Referral generated and saved in patient history.");
    });
  }

  async function handleDownload(referral = createdReferral) {
    if (!referral) return;
    await run(`download:${referral.id}`, async () => {
      const blob = await api.downloadReferralPdf(referral.id);
      downloadBlob(blob, `${patient.name.replace(/\s+/g, "_")}_referral.pdf`);
      setSuccess("Referral downloaded.");
    });
  }

  async function handleEmail(referral = createdReferral, recipients = draft.emailRecipients) {
    if (!referral) return;
    const rows = splitRecipients(recipients);
    if (!rows.length) return setError("Enter at least one email recipient.");
    await run(`email:${referral.id}`, async () => {
      const result = await api.sendReferralPackage(referral.id, {
        channels: ["email"],
        recipients: rows.map((email) => ({ recipient_type: email === draft.patientEmail ? "patient" as const : "doctor" as const, name: email === draft.patientEmail ? patient.name : draft.doctorName, email, phone: "" })),
        message: "",
        idempotency_key: crypto.randomUUID(),
      });
      if (!result.success) throw new Error(result.message || "Email delivery failed.");
      const deliveries = result.deliveries;
      setCreatedReferral((current) => current?.id === referral.id ? { ...current, deliveries: [...current.deliveries, ...deliveries] } : current);
      setHistory((current) => current.map((item) => item.id === referral.id ? { ...item, deliveries: [...item.deliveries, ...deliveries] } : item));
      setSuccess(result.message);
    });
  }

  async function handleWhatsApp(referral = createdReferral, recipients = draft.whatsappRecipients) {
    if (!referral) return;
    const rows = splitRecipients(recipients);
    if (!rows.length) return setError("Enter at least one phone number.");
    await run(`whatsapp:${referral.id}`, async () => {
      const result = await api.sendReferralPackage(referral.id, {
        channels: ["whatsapp"],
        recipients: rows.map((phone) => ({ recipient_type: phone === draft.patientPhone ? "patient" as const : "doctor" as const, name: phone === draft.patientPhone ? patient.name : draft.doctorName, email: "", phone })),
        message: "",
        idempotency_key: crypto.randomUUID(),
      });
      if (!result.success) throw new Error(result.message || "Phone delivery failed.");
      const deliveries = result.deliveries;
      setCreatedReferral((current) => current?.id === referral.id ? { ...current, deliveries: [...current.deliveries, ...deliveries] } : current);
      setHistory((current) => current.map((item) => item.id === referral.id ? { ...item, deliveries: [...item.deliveries, ...deliveries] } : item));
      setSuccess(result.message);
    });
  }

  async function handleResend(referral: ReferralPackage, channel: "email" | "whatsapp") {
    await run(`resend:${channel}:${referral.id}`, async () => {
      const result = await api.sendReferralPackage(referral.id, {
        channels: [channel],
        recipients: [],
        message: "",
        idempotency_key: crypto.randomUUID(),
      });
      if (!result.success) throw new Error(result.message || "Referral delivery failed.");
      setHistory((current) => current.map((item) => item.id === referral.id ? { ...item, deliveries: [...item.deliveries, ...result.deliveries] } : item));
      setSuccess(result.message);
    });
  }

  function startNew() {
    setDraft(createReferralDraft(patient));
    setCreatedReferral(null);
    setStep(1);
    setError("");
    setSuccess("");
  }

  return (
    <div className="fixed inset-0 z-[90] bg-white">
      <div className="flex h-[100dvh] flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 p-2 text-slate-600" aria-label="Close referral">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold text-slate-950">Referral</h2>
              <p className="truncate text-sm text-slate-500">{patient.name} · {patient.phone}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 p-2 text-slate-600" aria-label="Close"><X className="h-4 w-4" /></button>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="max-h-[220px] overflow-y-auto border-b border-slate-200 bg-slate-50 p-4 lg:max-h-none lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">Referral History</h3>
              <button type="button" onClick={startNew} className="inline-flex items-center gap-1 rounded-lg border border-[#9fc7e1] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#1d6a9f]"><Plus className="h-3.5 w-3.5" />New</button>
            </div>
            <div className="mt-3 space-y-2">
              {history.length ? history.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-sm font-semibold text-slate-900">{item.recipient_name || (item.recipient_type === "patient" ? "Patient copy" : "Referral")}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatDate(item.created_at)} · {item.urgency}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">{item.reason}</p>
                  {item.deliveries.length ? (
                    <p className="mt-2 text-xs text-slate-500">
                      Last delivery: {item.deliveries[item.deliveries.length - 1].channel} · {item.deliveries[item.deliveries.length - 1].status}
                    </p>
                  ) : <p className="mt-2 text-xs text-slate-400">Not sent yet</p>}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <button type="button" disabled={Boolean(busyAction)} onClick={() => void handleDownload(item)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"><Download className="mr-1 inline h-3 w-3" />PDF</button>
                    {item.recipient_email || (item.recipient_type !== "doctor" && patient.email) ? <button type="button" disabled={Boolean(busyAction)} onClick={() => void handleResend(item, "email")} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"><Mail className="mr-1 inline h-3 w-3" />Resend</button> : null}
                    {item.recipient_phone || (item.recipient_type !== "doctor" && patient.phone) ? <button type="button" disabled={Boolean(busyAction)} onClick={() => void handleResend(item, "whatsapp")} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"><MessageCircle className="mr-1 inline h-3 w-3" />Resend</button> : null}
                  </div>
                </div>
              )) : <p className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-sm text-slate-500">No referrals yet.</p>}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto bg-[#f4f8fb] p-3 sm:p-6">
            <div className="mx-auto max-w-6xl rounded-2xl bg-white p-4 shadow-sm sm:p-6">
              <nav className="mx-auto flex max-w-3xl overflow-hidden rounded-xl border border-[#9fc7e1]" aria-label="Referral steps">
                {STEP_LABELS.map((label, index) => {
                  const number = (index + 1) as WizardStep;
                  const active = step === number;
                  const complete = step > number;
                  return (
                    <button key={label} type="button" onClick={() => number < step && setStep(number)} disabled={number > step} className={`relative flex min-w-0 flex-1 items-center justify-center gap-2 px-8 py-3 text-sm font-medium ${active ? "bg-[#2f8fd3] text-white" : complete ? "bg-[#eaf4fb] text-[#1d6a9f]" : "bg-white text-slate-500"}`}>
                      <span className={`flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-bold ${active ? "bg-white text-[#2f8fd3]" : "bg-slate-100 text-slate-600"}`}>{complete ? <Check className="h-3.5 w-3.5" /> : number}</span>
                      <span className="hidden sm:inline">{label}</span>
                      {index < 2 ? <ChevronRight className="absolute right-2 h-6 w-6 text-[#9fc7e1]" /> : null}
                    </button>
                  );
                })}
              </nav>

              {isLoading ? <div className="flex min-h-[420px] items-center justify-center text-sm text-slate-500"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Loading patient records...</div> : null}

              {!isLoading && step === 1 ? (
                <div className="mt-8 space-y-8">
                  <section>
                    <h3 className="text-base font-semibold text-slate-950">Send Referral To</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      {(["patient", "doctor", "both"] as ReferralRecipientType[]).map((value) => (
                        <button key={value} type="button" onClick={() => chooseRecipientType(value)} className={`rounded-xl border px-4 py-3 text-left text-sm font-medium capitalize ${draft.recipientType === value ? "border-[#2f8fd3] bg-[#eef7fd] text-[#155c8d]" : "border-slate-200 text-slate-700"}`}>{value === "both" ? "Patient And Doctor" : value}</button>
                      ))}
                    </div>
                  </section>

                  {draft.recipientType !== "doctor" ? (
                    <section className="grid gap-4 border-t border-slate-200 pt-6 sm:grid-cols-2">
                      <Field label="Patient Email"><input type="email" className={inputClass} value={draft.patientEmail} onChange={(event) => updatePatientEmail(event.target.value)} placeholder="Enter patient email address" /></Field>
                      <Field label="Patient Phone Number"><input type="tel" className={inputClass} value={draft.patientPhone} onChange={(event) => updatePatientPhone(event.target.value)} placeholder="Enter patient phone number" /></Field>
                    </section>
                  ) : null}

                  {draft.recipientType !== "patient" ? (
                    <section className="grid gap-4 border-t border-slate-200 pt-6 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="Receiving Doctor *"><input className={inputClass} value={draft.doctorName} onChange={(event) => update("doctorName", event.target.value)} /></Field>
                      <Field label="Specialty"><input className={inputClass} value={draft.specialty} onChange={(event) => update("specialty", event.target.value)} /></Field>
                      <Field label="Clinic / Hospital"><input className={inputClass} value={draft.clinic} onChange={(event) => update("clinic", event.target.value)} /></Field>
                      <Field label="Doctor Email"><input type="email" className={inputClass} value={draft.doctorEmail} onChange={(event) => updateDoctorEmail(event.target.value)} /></Field>
                      <Field label="Doctor Phone Number"><input type="tel" className={inputClass} value={draft.doctorPhone} onChange={(event) => updateDoctorPhone(event.target.value)} /></Field>
                    </section>
                  ) : null}

                  <section className="grid gap-4 border-t border-slate-200 pt-6 sm:grid-cols-2">
                    <Field label="Reason *"><textarea rows={3} className={inputClass} value={draft.reason} onChange={(event) => update("reason", event.target.value)} /></Field>
                    <Field label="Clinical Question"><textarea rows={3} className={inputClass} value={draft.clinicalQuestion} onChange={(event) => update("clinicalQuestion", event.target.value)} placeholder="What should the receiving doctor assess or manage?" /></Field>
                    <Field label="Urgency"><select className={inputClass} value={draft.urgency} onChange={(event) => update("urgency", event.target.value as ReferralDraft["urgency"])}><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select></Field>
                    <Field label="Referral Note"><textarea rows={3} className={inputClass} value={draft.referralNote} onChange={(event) => update("referralNote", event.target.value)} placeholder="Treatment provided, relevant context, or a message to the receiving doctor" /></Field>
                  </section>
                  <div className="flex justify-end"><button type="button" onClick={continueFromDetails} className="rounded-lg bg-[#2f8fd3] px-6 py-2.5 text-sm font-semibold text-white">Choose Information</button></div>
                </div>
              ) : null}

              {!isLoading && step === 2 ? (
                <div className="mt-8 space-y-9">
                  <section>
                    <div className="flex items-center justify-between gap-3"><div><h3 className="text-base font-semibold text-slate-950">Consultations</h3><p className="mt-1 text-sm text-slate-500">Only completed consultation notes are available.</p></div><FileText className="h-5 w-5 text-[#2f8fd3]" /></div>
                    <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
                      {selectableNotes.length ? selectableNotes.map((note) => (
                        <div key={note.id} className="py-3.5">
                          <Checkbox checked={draft.consultationNoteIds.includes(note.id)} label={`${formatDate(note.finalized_at || note.created_at)} · ${referralConsultationReason(note.visit_reason, patient.reason)}`} onChange={() => update("consultationNoteIds", toggleId(draft.consultationNoteIds, note.id))} />
                        </div>
                      )) : <p className="py-5 text-sm text-slate-500">No completed consultations found.</p>}
                    </div>
                  </section>

                  <section>
                    <div className="flex items-center justify-between gap-3"><div><h3 className="text-base font-semibold text-slate-950">Tests And Evaluations</h3><p className="mt-1 text-sm text-slate-500">Choose the saved examination results relevant to this referral.</p></div><Stethoscope className="h-5 w-5 text-[#2f8fd3]" /></div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {sortedTests.length ? sortedTests.map((test) => (
                        <button key={test.id} type="button" onClick={() => update("longitudinalTrackIds", toggleId(draft.longitudinalTrackIds, test.id))} className={`flex items-start gap-3 rounded-xl border p-3 text-left ${draft.longitudinalTrackIds.includes(test.id) ? "border-[#2f8fd3] bg-[#eef7fd]" : "border-slate-200"}`}>
                          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${draft.longitudinalTrackIds.includes(test.id) ? "border-[#2f8fd3] bg-[#2f8fd3] text-white" : "border-slate-300"}`}>{draft.longitudinalTrackIds.includes(test.id) ? <Check className="h-3.5 w-3.5" /> : null}</span>
                          <span><span className="block text-sm font-semibold text-slate-900">{moduleLabel(test.track_type)}</span><span className="mt-0.5 block text-xs text-slate-500">{formatDate(test.measured_at)} · {recordSummary(test)}</span></span>
                        </button>
                      )) : <p className="text-sm text-slate-500">No saved tests found.</p>}
                    </div>
                  </section>

                  <section>
                    <div className="flex items-center justify-between gap-3"><div><h3 className="text-base font-semibold text-slate-950">Attachments</h3><p className="mt-1 text-sm text-slate-500">Only explicitly selected files leave the clinic.</p></div><Paperclip className="h-5 w-5 text-[#2f8fd3]" /></div>
                    <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
                      {attachments.length ? attachments.map((attachment) => (
                        <div key={attachment.id} className={`flex items-center justify-between gap-4 py-3.5 ${canEmbedAttachment(attachment.content_type) ? "" : "opacity-55"}`}>
                          {canEmbedAttachment(attachment.content_type) ? (
                            <Checkbox checked={draft.attachmentIds.includes(attachment.id)} label={attachment.file_name} onChange={() => update("attachmentIds", toggleId(draft.attachmentIds, attachment.id))} />
                          ) : (
                            <div><p className="text-sm text-slate-700">{attachment.file_name}</p><p className="mt-0.5 text-xs text-amber-700">Not supported in referral PDF</p></div>
                          )}
                          <span className="shrink-0 text-xs text-slate-500">{formatBytes(attachment.file_size)} · {formatDate(attachment.created_at)}</span>
                        </div>
                      )) : <p className="py-5 text-sm text-slate-500">No patient attachments found.</p>}
                    </div>
                  </section>
                  <div className="flex items-center justify-between gap-3"><button type="button" onClick={() => setStep(1)} className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700">Back</button><button type="button" onClick={continueFromRecords} className="rounded-lg bg-[#2f8fd3] px-6 py-2.5 text-sm font-semibold text-white">Review Referral</button></div>
                </div>
              ) : null}

              {!isLoading && step === 3 ? (
                <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="space-y-6">
                    <section className="rounded-xl border border-slate-200 p-5">
                      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1d6a9f]">{draft.urgency} referral</p><h3 className="mt-2 text-xl font-semibold text-slate-950">{draft.reason}</h3></div><FileCheck2 className="h-7 w-7 text-[#2f8fd3]" /></div>
                      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                        <div><dt className="text-slate-500">Recipient</dt><dd className="mt-1 font-medium text-slate-900">{draft.recipientType === "patient" ? patient.name : `${draft.doctorName}${draft.recipientType === "both" ? ` and ${patient.name}` : ""}`}</dd></div>
                        <div><dt className="text-slate-500">Clinic</dt><dd className="mt-1 font-medium text-slate-900">{draft.clinic || "Not specified"}</dd></div>
                        <div><dt className="text-slate-500">Clinical Question</dt><dd className="mt-1 whitespace-pre-wrap text-slate-900">{draft.clinicalQuestion || "Not specified"}</dd></div>
                        <div><dt className="text-slate-500">Included Information</dt><dd className="mt-1 font-medium text-slate-900">{selectedCount} item{selectedCount === 1 ? "" : "s"}</dd></div>
                      </dl>
                      {draft.referralNote ? <div className="mt-5 border-t border-slate-200 pt-4"><p className="text-sm text-slate-500">Referral Note</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{draft.referralNote}</p></div> : null}
                    </section>
                    <section className="rounded-xl border border-slate-200 p-5">
                      <h3 className="font-semibold text-slate-950">Included Information</h3>
                      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                        <p>{draft.consultationNoteIds.length} consultation{draft.consultationNoteIds.length === 1 ? "" : "s"}</p>
                        <p>{draft.longitudinalTrackIds.length} test{draft.longitudinalTrackIds.length === 1 ? "" : "s"}</p>
                        <p>{draft.attachmentIds.length} attachment{draft.attachmentIds.length === 1 ? "" : "s"}</p>
                        <p>Patient details and referral letter</p>
                      </div>
                    </section>
                    <button type="button" onClick={() => setStep(2)} className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700">Back to Selection</button>
                  </div>

                  <aside className="space-y-5 rounded-xl border border-[#bfd7e8] bg-[#f7fbfd] p-5">
                    {!createdReferral ? (
                      <div><h3 className="font-semibold text-slate-950">Generate Referral</h3><p className="mt-2 text-sm leading-6 text-slate-600">This creates a referral letter using the information selected on the previous step.</p><button type="button" onClick={() => void handleGenerate()} disabled={Boolean(busyAction)} className="mt-4 w-full rounded-lg bg-[#2f8fd3] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{busyAction === "generate" ? "Generating..." : "Generate Referral"}</button>{busyAction === "generate" ? <div role="status" aria-live="polite" className="mt-4 flex flex-col items-center gap-2 text-center text-sm font-medium text-[#1d6a9f]"><RefreshCw className="h-7 w-7 animate-spin" /><span>Preparing the referral…</span></div> : null}</div>
                    ) : (
                      <>
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><Check className="mr-2 inline h-4 w-4" />Referral ready {createdReferral.page_count ? `· ${createdReferral.page_count} pages` : ""} {createdReferral.file_size ? `· ${formatBytes(createdReferral.file_size)}` : ""}</div>
                        <div className="space-y-2">
                          {draft.recipientType !== "doctor" ? <dl className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"><p className="mb-1.5 font-semibold text-slate-900">Patient</p><div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 py-1"><dt className="font-semibold text-slate-600">Email:</dt><dd className="break-all text-right text-slate-900">{draft.patientEmail.trim() || "Not provided"}</dd></div><div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 py-1"><dt className="font-semibold text-slate-600">Number:</dt><dd className="break-all text-right text-slate-900">{draft.patientPhone.trim() || "Not provided"}</dd></div></dl> : null}
                          {draft.recipientType !== "patient" ? <dl className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"><p className="mb-1.5 font-semibold text-slate-900">{draft.doctorName || "Doctor"}</p><div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 py-1"><dt className="font-semibold text-slate-600">Email:</dt><dd className="break-all text-right text-slate-900">{draft.doctorEmail.trim() || "Not provided"}</dd></div><div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 py-1"><dt className="font-semibold text-slate-600">Number:</dt><dd className="break-all text-right text-slate-900">{draft.doctorPhone.trim() || "Not provided"}</dd></div></dl> : null}
                        </div>
                        <div className="space-y-2.5">
                          <button type="button" onClick={() => void handleDownload()} disabled={Boolean(busyAction)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#2f8fd3] bg-white px-4 py-2.5 text-sm font-semibold text-[#1d6a9f] disabled:opacity-60"><Download className="h-4 w-4" />Download Referral</button>
                          <button type="button" onClick={() => void handleEmail()} disabled={Boolean(busyAction) || emailRecipientCount === 0} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2f8fd3] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"><Mail className="h-4 w-4" />{busyAction.startsWith("email:") ? "Sending..." : emailRecipientCount > 1 ? `Send Email to ${emailRecipientCount} Recipients` : "Send Email"}</button>
                          <button type="button" onClick={() => void handleWhatsApp()} disabled={Boolean(busyAction) || phoneRecipientCount === 0} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#14a38b] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"><MessageCircle className="h-4 w-4" />{busyAction.startsWith("whatsapp:") ? "Sending..." : phoneRecipientCount > 1 ? `Send Phone to ${phoneRecipientCount} Recipients` : "Send Phone"}</button>
                        </div>
                      </>
                    )}
                  </aside>
                </div>
              ) : null}

              {error ? <p className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}
              {success ? <p className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{success}</p> : null}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
