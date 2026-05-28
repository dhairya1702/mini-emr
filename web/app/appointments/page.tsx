"use client";

import { useCallback, useState } from "react";

import { AppHeader } from "@/components/app-header";
import { LazySettingsDrawer } from "@/components/lazy-settings-drawer";
import { SettingsDrawerAppointmentsPanel } from "@/components/settings-drawer-appointments-panel";
import { api } from "@/lib/api";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";

export default function AppointmentsPage() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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

  async function handleCheckInAppointment(
    appointmentId: string,
    options?: { existingPatientId?: string; forceNew?: boolean },
  ) {
    const checkedInPatient = options?.existingPatientId
      ? await api.checkInAppointmentWithPatient(appointmentId, options.existingPatientId)
      : await api.checkInAppointment(appointmentId, { force_new: options?.forceNew });
    return {
      id: appointmentId,
      checked_in_at: new Date().toISOString(),
      checked_in_patient_id: checkedInPatient.id,
    };
  }

  if (isRedirectingToLogin) return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[20px] border border-[#dbe7ef] bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">Redirecting to login...</div></main>;
  if (!isAuthReady) return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[20px] border border-[#dbe7ef] bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">Loading ClinicOS...</div></main>;

  return (
    <main className="clinic-page">
      <div className="clinic-container">
        <AppHeader clinicName={clinicName} currentUser={currentUser} active="appointments" onOpenSettings={() => setIsSettingsOpen(true)} onLogout={handleLogout} />
        {error ? <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        <section className="rounded-[18px] border border-[#dbe7ef] bg-white p-5 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">
          <SettingsDrawerAppointmentsPanel
            onCheckInAppointment={handleCheckInAppointment}
            onUpdateAppointment={(appointmentId, payload) => api.updateAppointment(appointmentId, payload)}
            onUpdateFollowUp={(followUpId, payload) => api.updateFollowUp(followUpId, payload)}
          />
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
          onCheckInAppointment={handleCheckInAppointment}
          onUpdateAppointment={(appointmentId, payload) => api.updateAppointment(appointmentId, payload)}
          onUpdateFollowUp={(followUpId, payload) => api.updateFollowUp(followUpId, payload)}
          onBillingComplete={() => undefined}
        />
      ) : null}
    </main>
  );
}
