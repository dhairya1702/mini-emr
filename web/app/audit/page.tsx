"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { SettingsDrawer } from "@/components/settings-drawer";
import { api } from "@/lib/api";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { Patient } from "@/lib/types";

export default function AuditPage() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const canLoadAdminPageData = useCallback((user: { role: "admin" | "staff" }) => user.role === "admin", []);
  const loadPageData = useCallback(() => api.listPatients(), []);
  const onPageData = useCallback((data: Patient[]) => {
    setPatients(data);
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
    handleAddStaffUser,
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
    canLoadPageData: canLoadAdminPageData,
    loadPageData,
    onPageData,
  });
  const clinicName = clinicSettings?.clinic_name || "ClinicOS";

  useEffect(() => {
    if (isAuthReady && currentUser?.role === "staff") {
      router.replace("/");
    }
  }, [currentUser, isAuthReady, router]);

  useEffect(() => {
    if (isAuthReady && currentUser?.role === "admin") {
      void handleRefreshAudit();
    }
  }, [currentUser, isAuthReady]);

  async function handleRefreshAudit() {
    setIsAuditLoading(true);
    setAuditError("");
    try {
      await loadAuditEvents();
    } catch (loadError) {
      setAuditError(loadError instanceof Error ? loadError.message : "Failed to load audit events.");
    } finally {
      setIsAuditLoading(false);
    }
  }

  if (isRedirectingToLogin) {
    return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_20px_60px_rgba(125,211,252,0.18)]">Redirecting to login...</div></main>;
  }
  if (!isAuthReady) {
    return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_20px_60px_rgba(125,211,252,0.18)]">Loading ClinicOS...</div></main>;
  }
  if (currentUser?.role === "staff") {
    return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_20px_60px_rgba(125,211,252,0.18)]">Redirecting to queue...</div></main>;
  }

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px]">
        <AppHeader clinicName={clinicName} currentUser={currentUser} active="audit" onOpenSettings={() => setIsSettingsOpen(true)} onLogout={handleLogout} />
        {error ? <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        {isAuditLoading ? (
          <div className="rounded-[28px] border border-sky-200 bg-sky-50/40 p-5 text-sm text-slate-700">Loading recent clinic activity...</div>
        ) : (
          <div className="rounded-[28px] border border-sky-200 bg-white p-5 shadow-[0_16px_45px_rgba(125,211,252,0.12)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Recent system activity</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">This feed tracks who changed what across patients, appointments, follow-ups, notes, and billing.</p>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => void handleRefreshAudit()} className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-sky-50"><RefreshCw className="h-4 w-4" />Refresh</button>
                <div className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700">{auditEvents.length} event{auditEvents.length === 1 ? "" : "s"}</div>
              </div>
            </div>
            {auditError ? <p className="mt-4 text-sm font-medium text-rose-600">{auditError}</p> : null}
            <div className="mt-6 space-y-3">
              {auditEvents.length ? auditEvents.map((event) => (
                <div key={event.id} className="rounded-[24px] border border-sky-100 bg-sky-50/40 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{event.summary}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{event.actor_name} · {event.action.replaceAll("_", " ")}</p>
                      <p className="mt-2 text-xs text-slate-500">{event.entity_type.replaceAll("_", " ")} · ID {event.entity_id.slice(0, 8).toUpperCase()}</p>
                    </div>
                    <p className="text-right text-xs text-slate-500">{new Date(event.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                  </div>
                </div>
              )) : <div className="rounded-[24px] border border-dashed border-sky-300 bg-sky-50/20 px-6 py-12 text-center text-sm text-slate-500">No audit events yet.</div>}
            </div>
          </div>
        )}
      </div>
      <SettingsDrawer
        open={isSettingsOpen}
        settings={clinicSettings}
        currentUser={currentUser}
        users={users}
        onLoadUsers={loadUsers}
        auditEvents={auditEvents}
        onLoadAuditEvents={loadAuditEvents}
        patients={patients.filter((patient) => patient.status === "done" && !patient.billed)}
        catalogItems={catalogItems}
        onLoadCatalogItems={loadCatalogItems}
        onClose={() => setIsSettingsOpen(false)}
        onSaveClinic={handleSaveClinicSettings}
        onAddUser={handleAddStaffUser}
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
          setPatients((current) => [checkedInPatient, ...current.filter((patient) => patient.id !== checkedInPatient.id)]);
          return { id: appointmentId, checked_in_at: new Date().toISOString(), checked_in_patient_id: checkedInPatient.id };
        }}
        onUpdateAppointment={(appointmentId, payload) => api.updateAppointment(appointmentId, payload)}
        onUpdateFollowUp={(followUpId, payload) => api.updateFollowUp(followUpId, payload)}
        onBillingComplete={(patientId) => setPatients((current) => current.map((patient) => patient.id === patientId ? { ...patient, billed: true } : patient))}
      />
    </main>
  );
}
