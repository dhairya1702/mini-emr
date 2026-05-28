"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Download, FileText, RefreshCw, Search, Sparkles } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { LazySettingsDrawer } from "@/components/lazy-settings-drawer";
import { api } from "@/lib/api";
import { CaseStudy, CaseStudySavePayload, CaseStudyTemplateKey, Patient, PatientCaseStudySource } from "@/lib/types";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";

const CASE_STUDY_TEMPLATES: Array<{ key: CaseStudyTemplateKey; label: string; description: string }> = [
  {
    key: "conference_presentation",
    label: "Conference Presentation",
    description: "Balanced chronology, investigations, management, and learning points for conference talks.",
  },
  {
    key: "teaching_rounds",
    label: "Teaching Rounds",
    description: "Emphasizes diagnostic reasoning, teaching value, and discussion prompts.",
  },
  {
    key: "hospital_case_discussion",
    label: "Hospital Case Discussion",
    description: "Highlights multidisciplinary management, decisions, and outcome analysis.",
  },
];

function normalizePatientSearch(value: string) {
  return value.trim().toLowerCase();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function CaseStudyPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [caseStudies, setCaseStudies] = useState<CaseStudy[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedCaseStudyId, setSelectedCaseStudyId] = useState<string | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [patientSearch, setPatientSearch] = useState("");
  const [isPatientSearchFocused, setIsPatientSearchFocused] = useState(false);
  const [templateKey, setTemplateKey] = useState<CaseStudyTemplateKey>("conference_presentation");
  const [anonymized, setAnonymized] = useState(true);
  const [title, setTitle] = useState("");
  const [authorInstructions, setAuthorInstructions] = useState("");
  const [content, setContent] = useState("");
  const [source, setSource] = useState<PatientCaseStudySource | null>(null);
  const [pageStatus, setPageStatus] = useState("");
  const [pageError, setPageError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isSourceLoading, setIsSourceLoading] = useState(false);

  const loadPageData = useCallback(async () => {
    const [loadedPatients, loadedCaseStudies] = await Promise.all([
      api.listPatients(),
      api.listCaseStudies(),
    ]);
    return {
      patients: loadedPatients.sort((left, right) => right.last_visit_at.localeCompare(left.last_visit_at)),
      caseStudies: loadedCaseStudies,
    };
  }, []);

  const onPageData = useCallback((data: { patients: Patient[]; caseStudies: CaseStudy[] }) => {
    setPatients(data.patients);
    setCaseStudies(data.caseStudies);
  }, []);

  const {
    currentUser,
    users,
    auditEvents,
    loadUsers,
    loadAuditEvents,
    catalogItems,
    loadCatalogItems,
    clinicSettings,
    error,
    isAuthReady,
    isRedirectingToLogin,
    handleLogout,
    handleSaveClinicSettings,
    applyClinicSettings,
    handleAddStaffUser,
    handleUpdateUserRole,
    handleDeleteUser,
    handleUploadUserSignature,
    handleRemoveUserSignature,
    handleCreateCatalogItem,
    handleAdjustCatalogStock,
    handleDeleteCatalogItem,
    handleCreateInvoice,
    handleGenerateLetter,
    handleSendLetter,
    handleSendInvoice,
    handleExportPatientsCsv,
    handleExportVisitsCsv,
    handleExportInvoicesCsv,
  } = useClinicShellPage({
    canLoadPageData: (user) => user.role === "admin",
    loadPageData,
    onPageData,
  });

  const clinicName = clinicSettings?.clinic_name || "ClinicOS";
  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId) ?? null;
  const activeCaseStudy = caseStudies.find((caseStudy) => caseStudy.id === selectedCaseStudyId) ?? null;
  const filteredPatients = useMemo(() => {
    const query = normalizePatientSearch(patientSearch);
    if (!query) {
      return [];
    }
    return patients
      .filter((patient) =>
        patient.name.toLowerCase().includes(query) ||
        patient.phone.toLowerCase().includes(query) ||
        patient.reason.toLowerCase().includes(query),
      )
      .slice(0, 12);
  }, [patientSearch, patients]);

  useEffect(() => {
    if (selectedPatientId) {
      return;
    }
    if (caseStudies[0]?.patient_id) {
      setSelectedPatientId(caseStudies[0].patient_id);
      return;
    }
    if (patients[0]) {
      setSelectedPatientId(patients[0].id);
    }
  }, [caseStudies, patients, selectedPatientId]);

  const loadSourceForPatient = useCallback(async (patientId: string) => {
    setIsSourceLoading(true);
    setPageError("");
    try {
      const loadedSource = await api.getPatientCaseStudySource(patientId);
      setSource(loadedSource);
      return loadedSource;
    } catch (loadError) {
      setPageError(loadError instanceof Error ? loadError.message : "Failed to load patient history.");
      return null;
    } finally {
      setIsSourceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedPatientId || source?.patient.id === selectedPatientId || selectedCaseStudyId) {
      return;
    }
    void loadSourceForPatient(selectedPatientId);
  }, [loadSourceForPatient, selectedCaseStudyId, selectedPatientId, source?.patient.id]);

  function resetDraft(patientId?: string) {
    setSelectedCaseStudyId(null);
    setSelectedPatientId(patientId ?? "");
    setTemplateKey("conference_presentation");
    setAnonymized(true);
    setTitle("");
    setAuthorInstructions("");
    setContent("");
    setPageStatus("");
    setPageError("");
  }

  async function handleSelectPatient(patient: Patient) {
    setSelectedPatientId(patient.id);
    setPatientSearch(patient.name);
    setIsPatientSearchFocused(false);
    setSelectedCaseStudyId(null);
    setTitle("");
    setAuthorInstructions("");
    setContent("");
    await loadSourceForPatient(patient.id);
  }

  async function handleGenerate() {
    if (!selectedPatientId) {
      setPageError("Select a patient first.");
      return;
    }
    setIsGenerating(true);
    setPageError("");
    setPageStatus("");
    try {
      const response = await api.generateCaseStudy({
        patient_id: selectedPatientId,
        title,
        template_key: templateKey,
        anonymized,
        author_instructions: authorInstructions,
      });
      setTitle(response.title);
      setContent(response.content);
      setSource(response.source);
      setPageStatus("Case study generated. Review and save when ready.");
    } catch (generateError) {
      setPageError(generateError instanceof Error ? generateError.message : "Failed to generate case study.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSave(status: "draft" | "final") {
    if (!selectedPatientId) {
      setPageError("Select a patient first.");
      return;
    }
    if (!title.trim()) {
      setPageError("Enter a title before saving.");
      return;
    }
    if (!content.trim()) {
      setPageError("Generate or write the case study content before saving.");
      return;
    }
    const payload: CaseStudySavePayload = {
      patient_id: selectedPatientId,
      title: title.trim(),
      status,
      template_key: templateKey,
      anonymized,
      author_instructions: authorInstructions,
      generated_content: content.trim(),
      source_snapshot: (source ?? {}) as unknown as Record<string, unknown>,
    };
    setIsSaving(true);
    setPageError("");
    try {
      const saved = selectedCaseStudyId
        ? await api.updateCaseStudy(selectedCaseStudyId, payload)
        : await api.createCaseStudy(payload);
      setCaseStudies((current) => {
        const withoutMatch = current.filter((entry) => entry.id !== saved.id);
        return [saved, ...withoutMatch].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
      });
      setSelectedCaseStudyId(saved.id);
      setPageStatus(status === "final" ? "Final case study saved." : "Draft saved.");
    } catch (saveError) {
      setPageError(saveError instanceof Error ? saveError.message : "Failed to save case study.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleExportPdf() {
    if (!selectedCaseStudyId) {
      setPageError("Save the case study before exporting PDF.");
      return;
    }
    setIsExporting(true);
    setPageError("");
    try {
      const blob = await api.generateCaseStudyPdf(selectedCaseStudyId);
      downloadBlob(blob, `${title.trim().replace(/\s+/g, "_") || "case_study"}.pdf`);
      setPageStatus("PDF export downloaded.");
    } catch (exportError) {
      setPageError(exportError instanceof Error ? exportError.message : "Failed to export case study PDF.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleCopy() {
    if (!content.trim()) {
      setPageError("Nothing to copy yet.");
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      setPageStatus("Case study copied to clipboard.");
    } catch {
      setPageError("Clipboard copy failed.");
    }
  }

  if (isRedirectingToLogin) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-[20px] border border-[#dbe7ef] bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">
          Redirecting to login...
        </div>
      </main>
    );
  }

  if (!isAuthReady) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-[20px] border border-[#dbe7ef] bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">
          Loading ClinicOS...
        </div>
      </main>
    );
  }

  if (currentUser?.role !== "admin") {
    return (
      <main className="clinic-page">
        <div className="clinic-container">
          <AppHeader
            clinicName={clinicName}
            currentUser={currentUser}
            active="case-study"
            onOpenSettings={() => setIsSettingsOpen(true)}
            onLogout={handleLogout}
          />
          <section className="rounded-[20px] border border-amber-200 bg-amber-50/80 p-6 text-slate-700 shadow-[0_20px_60px_rgba(250,204,21,0.12)]">
            Case Study is admin-only because it generates and stores AI-authored clinical documents.
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="clinic-page">
      <div className="clinic-container">
        <AppHeader
          clinicName={clinicName}
          currentUser={currentUser}
          active="case-study"
          onOpenSettings={() => setIsSettingsOpen(true)}
          onLogout={handleLogout}
        />

        {error ? (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
        {pageError ? (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {pageError}
          </div>
        ) : null}
        {pageStatus ? (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {pageStatus}
          </div>
        ) : null}

        <section className="overflow-hidden rounded-[22px] border border-[#dbe7ef] bg-white/95 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">
          <div className="border-b border-[#dbe7ef] bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] px-5 py-7 sm:px-8 lg:px-10">
            <div className="clinic-container">
              <div className="sm:p-1">
                <div className="grid gap-4">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
                    <div className="relative min-w-0">
                      <div className="flex items-center gap-3 rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/60 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
                        <Search className="h-4 w-4 text-[#2a6fa8]" />
                        <input
                          value={patientSearch}
                          onChange={(event) => setPatientSearch(event.target.value)}
                          onFocus={() => setIsPatientSearchFocused(true)}
                          onBlur={() => {
                            window.setTimeout(() => setIsPatientSearchFocused(false), 120);
                          }}
                          placeholder="Search patient"
                          className="w-full bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
                        />
                      </div>
                    {patientSearch.trim() && isPatientSearchFocused ? (
                      <div className="absolute left-0 right-0 top-[calc(100%+10px)] z-20 overflow-hidden rounded-[16px] border border-[#dbe7ef] bg-white shadow-[0_20px_44px_rgba(64,131,181,0.10)]">
                        {filteredPatients.length ? (
                          filteredPatients.map((patient) => {
                            const isActive = patient.id === selectedPatientId;
                            return (
                              <button
                                key={patient.id}
                                type="button"
                                onClick={() => void handleSelectPatient(patient)}
                                className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition ${
                                  isActive ? "bg-[#f3f8fb]" : "hover:bg-[#f3f8fb]/60"
                                }`}
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-slate-900">{patient.name}</p>
                                  <p className="mt-1 truncate text-sm text-slate-500">
                                    {patient.phone} • {patient.reason}
                                  </p>
                                </div>
                                <span className="shrink-0 text-[11px] uppercase tracking-[0.16em] text-slate-400">
                                  {new Date(patient.last_visit_at).toLocaleDateString()}
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <div className="px-4 py-4 text-sm text-slate-500">No patients found.</div>
                        )}
                      </div>
                    ) : null}
                    </div>
                    <label className="flex items-center gap-3 rounded-[16px] border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={anonymized}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => setAnonymized(event.target.checked)}
                        className="h-4 w-4 rounded border-[#9fc7e1] text-[#2f8fd3]"
                      />
                      <span>Anonymize patient details</span>
                    </label>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                        Title
                      </span>
                      <input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder="Optional title"
                        className="w-full rounded-[16px] border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#9fc7e1]"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                        Format
                      </span>
                      <select
                        value={templateKey}
                        onChange={(event) => setTemplateKey(event.target.value as CaseStudyTemplateKey)}
                        className="w-full rounded-[16px] border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#9fc7e1]"
                      >
                        {CASE_STUDY_TEMPLATES.map((template) => (
                          <option key={template.key} value={template.key}>
                            {template.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px] lg:items-end">
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                        Brief
                      </span>
                      <textarea
                        value={authorInstructions}
                        onChange={(event) => setAuthorInstructions(event.target.value)}
                        rows={3}
                        placeholder="Describe the angle: progression, diagnostic reasoning, management decisions, conference teaching points."
                        className="w-full rounded-[16px] border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-[#9fc7e1]"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => void handleGenerate()}
                      disabled={isGenerating || !selectedPatientId}
                      className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-xl bg-[#2f8fd3] px-4 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
                    >
                      <Sparkles className="h-4 w-4" />
                      {isGenerating ? "Generating..." : activeCaseStudy ? "Regenerate" : "Generate"}
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {selectedPatient ? (
                    <div className="rounded-xl border border-[#bfd7e8] bg-[#f3f8fb] px-4 py-2 text-sm text-[#2a6fa8]">
                      Selected: <span className="font-semibold text-slate-900">{selectedPatient.name}</span>
                    </div>
                  ) : null}
                  {source ? (
                    <>
                      <div className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-2 text-sm text-slate-600">
                        {source.visits.length} visits
                      </div>
                      <div className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-2 text-sm text-slate-600">
                        {source.notes.length} notes
                      </div>
                      <div className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-2 text-sm text-slate-600">
                        {source.timeline.length} timeline events
                      </div>
                    </>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void loadSourceForPatient(selectedPatientId)}
                    disabled={!selectedPatientId || isSourceLoading}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#bfd7e8] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb] disabled:opacity-60"
                  >
                    <RefreshCw className={`h-4 w-4 ${isSourceLoading ? "animate-spin" : ""}`} />
                    Refresh history
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetDraft(selectedPatientId || patients[0]?.id);
                      setSource(selectedPatientId ? source : null);
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#bfd7e8] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb]"
                  >
                    <RefreshCw className="h-4 w-4" />
                    New draft
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-[1600px] px-5 py-8 sm:px-8 lg:px-10">
            <section className="sm:px-1">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Generated Study</p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">Full case study</h2>
                  <p className="mt-2 max-w-[60ch] text-sm leading-6 text-slate-600">
                    Generate first, then edit freely below before saving or exporting.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#bfd7e8] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb]"
                  >
                    <Copy className="h-4 w-4" />
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExportPdf()}
                    disabled={isExporting}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#bfd7e8] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb] disabled:opacity-60"
                  >
                    <Download className="h-4 w-4" />
                    {isExporting ? "Preparing..." : "Export PDF"}
                  </button>
                </div>
              </div>

              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={32}
                placeholder="Generated case study content will appear here. You can edit it before saving or exporting."
                className="mt-6 min-h-[860px] w-full rounded-[18px] border border-[#bfd7e8] bg-[#f3f8fb]/30 px-6 py-6 text-[14px] leading-7 text-slate-800 outline-none transition focus:border-[#9fc7e1]"
              />

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleSave("draft")}
                  disabled={isSaving}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#bfd7e8] bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb] disabled:opacity-60"
                >
                  <FileText className="h-4 w-4" />
                  {isSaving ? "Saving..." : "Save Draft"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave("final")}
                  disabled={isSaving}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#2f8fd3] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
                >
                  <Sparkles className="h-4 w-4" />
                  {isSaving ? "Saving..." : "Save Final"}
                </button>
              </div>
            </section>
          </div>
        </section>
      </div>

      {isSettingsOpen ? (
        <LazySettingsDrawer
          open={isSettingsOpen}
          settings={clinicSettings}
          currentUser={currentUser}
          users={users}
          onLoadUsers={loadUsers}
          auditEvents={auditEvents}
          onLoadAuditEvents={loadAuditEvents}
          patients={patients}
          onLoadBillingPatients={() => api.listPatients()}
          catalogItems={catalogItems}
          onLoadCatalogItems={loadCatalogItems}
          onClose={() => setIsSettingsOpen(false)}
          onSaveClinic={handleSaveClinicSettings}
          onClinicSettingsChange={applyClinicSettings}
          onAddUser={handleAddStaffUser}
          onUpdateUserRole={handleUpdateUserRole}
          onDeleteUser={handleDeleteUser}
          onUploadUserSignature={async (userId, file) => {
            await handleUploadUserSignature(userId, file);
          }}
          onRemoveUserSignature={async (userId) => {
            await handleRemoveUserSignature(userId);
          }}
          onCreateCatalogItem={handleCreateCatalogItem}
          onAdjustCatalogStock={handleAdjustCatalogStock}
          onDeleteCatalogItem={handleDeleteCatalogItem}
          onGenerateLetter={handleGenerateLetter}
          onGenerateLetterPdf={(payload) => api.generateLetterPdf(payload)}
          onSendLetter={handleSendLetter}
          onCreateInvoice={handleCreateInvoice}
          onGenerateInvoicePdf={(invoiceId) => api.generateInvoicePdf(invoiceId)}
          onSendInvoice={handleSendInvoice}
          onExportPatientsCsv={handleExportPatientsCsv}
          onExportVisitsCsv={() => handleExportVisitsCsv({ range: "all" })}
          onExportInvoicesCsv={handleExportInvoicesCsv}
          onCheckInAppointment={async (appointmentId, options) => {
            const checkedInPatient = options?.existingPatientId
              ? await api.checkInAppointmentWithPatient(appointmentId, options.existingPatientId)
              : await api.checkInAppointment(appointmentId, { force_new: options?.forceNew });
            return {
              id: appointmentId,
              checked_in_at: new Date().toISOString(),
              checked_in_patient_id: checkedInPatient.id,
            };
          }}
          onUpdateAppointment={(appointmentId, payload) => api.updateAppointment(appointmentId, payload)}
          onUpdateFollowUp={(followUpId, payload) => api.updateFollowUp(followUpId, payload)}
          onBillingComplete={() => void 0}
        />
      ) : null}
    </main>
  );
}
