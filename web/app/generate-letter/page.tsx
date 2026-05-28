"use client";

import { FormEvent, useCallback, useState } from "react";

import { AppHeader } from "@/components/app-header";
import { LazySettingsDrawer } from "@/components/lazy-settings-drawer";
import { LetterFormState, SettingsDrawerLetterPanel } from "@/components/settings-drawer-letter-panel";
import { api } from "@/lib/api";
import { hasUserSignature } from "@/lib/setup-checklist";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";

const emptyLetterForm: LetterFormState = {
  to: "",
  subject: "",
  content: "",
  generated: "",
  recipient_email: "",
};

export default function GenerateLetterPage() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [letterForm, setLetterForm] = useState<LetterFormState>(emptyLetterForm);
  const [letterError, setLetterError] = useState("");
  const [letterStatus, setLetterStatus] = useState("");
  const [isGeneratingLetter, setIsGeneratingLetter] = useState(false);
  const [isPreparingLetterPdf, setIsPreparingLetterPdf] = useState(false);
  const [isSendingLetter, setIsSendingLetter] = useState(false);
  const loadPageData = useCallback(async () => null, []);
  const onPageData = useCallback(() => undefined, []);
  const loadBillablePatients = useCallback(async () => {
    const patients = await api.listPatients();
    return patients.filter((patient) => patient.status === "done" && !patient.billed);
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
  } = useClinicShellPage({ loadPageData, onPageData });
  const clinicName = clinicSettings?.clinic_name || "ClinicOS";
  const setupWarnings = [
    !clinicSettings?.email_configured ? "Clinic sender email is not configured yet." : "",
    !hasUserSignature(currentUser) ? "Your signature is missing." : "",
  ].filter(Boolean);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLetterError("");
    setLetterStatus("");
    if (!letterForm.to.trim() || !letterForm.subject.trim() || !letterForm.content.trim()) {
      setLetterError("To, subject, and content are required.");
      return;
    }
    setIsGeneratingLetter(true);
    try {
      const generated = await handleGenerateLetter({
        to: letterForm.to.trim(),
        subject: letterForm.subject.trim(),
        content: letterForm.content.trim(),
      });
      setLetterForm((current) => ({ ...current, generated }));
      setLetterStatus("Letter generated.");
    } catch (generateError) {
      setLetterError(generateError instanceof Error ? generateError.message : "Failed to generate letter.");
    } finally {
      setIsGeneratingLetter(false);
    }
  }

  async function handlePreviewPdf() {
    const content = letterForm.generated.trim() || letterForm.content.trim();
    if (!content) {
      setLetterError("Generate or write letter content before previewing.");
      return;
    }
    setIsPreparingLetterPdf(true);
    setLetterError("");
    setLetterStatus("");
    try {
      const blob = await api.generateLetterPdf({ content });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setLetterStatus("PDF opened.");
    } catch (previewError) {
      setLetterError(previewError instanceof Error ? previewError.message : "Failed to preview PDF.");
    } finally {
      setIsPreparingLetterPdf(false);
    }
  }

  async function handleSend() {
    const content = letterForm.generated.trim() || letterForm.content.trim();
    if (!letterForm.recipient_email.trim() || !letterForm.subject.trim() || !content) {
      setLetterError("Recipient email, subject, and letter content are required.");
      return;
    }
    setIsSendingLetter(true);
    setLetterError("");
    setLetterStatus("");
    try {
      const message = await handleSendLetter({
        recipient_email: letterForm.recipient_email.trim(),
        subject: letterForm.subject.trim(),
        content,
      });
      setLetterStatus(message);
    } catch (sendError) {
      setLetterError(sendError instanceof Error ? sendError.message : "Failed to send letter.");
    } finally {
      setIsSendingLetter(false);
    }
  }

  if (isRedirectingToLogin) return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[20px] border border-[#dbe7ef] bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">Redirecting to login...</div></main>;
  if (!isAuthReady) return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[20px] border border-[#dbe7ef] bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">Loading ClinicOS...</div></main>;

  return (
    <main className="clinic-page">
      <div className="clinic-container">
        <AppHeader clinicName={clinicName} currentUser={currentUser} onOpenSettings={() => setIsSettingsOpen(true)} onLogout={handleLogout} />
        {error ? <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        <SettingsDrawerLetterPanel
          letterForm={letterForm}
          letterError={letterError}
          letterStatus={letterStatus}
          setupWarnings={setupWarnings}
          isGeneratingLetter={isGeneratingLetter}
          isPreparingLetterPdf={isPreparingLetterPdf}
          isSendingLetter={isSendingLetter}
          onSubmit={handleSubmit}
          onChange={(patch) => setLetterForm((current) => ({ ...current, ...patch }))}
          onPreviewPdf={handlePreviewPdf}
          onSend={handleSend}
        />
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
          patients={[]}
          onLoadBillingPatients={loadBillablePatients}
          catalogItems={catalogItems}
          onLoadCatalogItems={loadCatalogItems}
          onClose={() => setIsSettingsOpen(false)}
          onSaveClinic={handleSaveClinicSettings}
          onClinicSettingsChange={applyClinicSettings}
          onAddUser={handleAddStaffUser}
          onUpdateUserRole={handleUpdateUserRole}
          onDeleteUser={handleDeleteUser}
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
          onExportVisitsCsv={handleExportVisitsCsv}
          onExportInvoicesCsv={handleExportInvoicesCsv}
          onCheckInAppointment={async (appointmentId, options) => {
            const checkedInPatient = options?.existingPatientId ? await api.checkInAppointmentWithPatient(appointmentId, options.existingPatientId) : await api.checkInAppointment(appointmentId, { force_new: options?.forceNew });
            return { id: appointmentId, checked_in_at: new Date().toISOString(), checked_in_patient_id: checkedInPatient.id };
          }}
          onUpdateAppointment={(appointmentId, payload) => api.updateAppointment(appointmentId, payload)}
          onUpdateFollowUp={(followUpId, payload) => api.updateFollowUp(followUpId, payload)}
          onBillingComplete={() => undefined}
        />
      ) : null}
    </main>
  );
}
