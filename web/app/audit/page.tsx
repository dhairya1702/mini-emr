"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
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

  const handleRefreshAudit = useCallback(async () => {
    setIsAuditLoading(true);
    setAuditError("");
    try {
      await loadAuditEvents();
    } catch (loadError) {
      setAuditError(loadError instanceof Error ? loadError.message : "Failed to load audit events.");
    } finally {
      setIsAuditLoading(false);
    }
  }, [loadAuditEvents]);

  useEffect(() => {
    if (isAuthReady && currentUser?.role === "admin") {
      void handleRefreshAudit();
    }
  }, [currentUser, handleRefreshAudit, isAuthReady]);

  const visibleAuditEvents = useMemo(() => auditEvents.filter((event) => {
    const matchesAction = actionFilter === "all" || event.action === actionFilter;
    const matchesEntity = entityFilter === "all" || event.entity_type === entityFilter;
    return matchesAction && matchesEntity;
  }), [actionFilter, auditEvents, entityFilter]);

  const patientNamesById = useMemo(
    () =>
      Object.fromEntries(
        patients.map((patient) => [patient.id, patient.name]),
      ),
    [patients],
  );

  function getPatientName(event: (typeof auditEvents)[number]) {
    const metadataName = String(event.metadata?.patient_name || "").trim();
    if (metadataName) {
      return metadataName;
    }
    const patientId = String(event.metadata?.patient_id || "").trim();
    return patientNamesById[patientId] || "";
  }

  function getAuditSummary(event: (typeof auditEvents)[number]) {
    const patientName = getPatientName(event);
    const recipient = String(event.metadata?.recipient || event.metadata?.sent_to || "").trim();
    if (event.action === "invoice_shared" && patientName && recipient) {
      return `Shared invoice for ${patientName} with ${recipient}.`;
    }
    if (event.action === "invoice_created" && patientName) {
      const matchedTotal = event.summary.match(/totaling\s+([0-9.,]+)/i);
      return matchedTotal
        ? `Created invoice for ${patientName} totaling ${matchedTotal[1]}.`
        : `Created invoice for ${patientName}.`;
    }
    if (event.action === "consultation_note_shared" && patientName && recipient) {
      const matchedVersion = event.summary.match(/v(\d+)/i);
      return matchedVersion
        ? `Shared consultation note v${matchedVersion[1]} for ${patientName} with ${recipient}.`
        : `Shared consultation note for ${patientName} with ${recipient}.`;
    }
    if (event.action === "consultation_note_finalized" && patientName) {
      const matchedVersion = event.summary.match(/v(\d+)/i);
      return matchedVersion
        ? `Finalized consultation note v${matchedVersion[1]} for ${patientName}.`
        : `Finalized consultation note for ${patientName}.`;
    }
    if (event.action === "consultation_note_created" && patientName) {
      const matchedVersion = event.summary.match(/v(\d+)/i);
      return matchedVersion
        ? `Generated consultation note v${matchedVersion[1]} for ${patientName}.`
        : `Generated consultation note for ${patientName}.`;
    }
    if (event.action === "consultation_note_updated" && patientName) {
      const matchedVersion = event.summary.match(/v(\d+)/i);
      return matchedVersion
        ? `Updated consultation note v${matchedVersion[1]} for ${patientName}.`
        : `Updated consultation note for ${patientName}.`;
    }
    if (event.action === "consultation_note_amended" && patientName) {
      const matchedVersion = event.summary.match(/v(\d+)/i);
      return matchedVersion
        ? `Created amended consultation note v${matchedVersion[1]} for ${patientName}.`
        : `Created amended consultation note for ${patientName}.`;
    }
    if (event.action === "follow_up_created" && patientName) {
      const matchedDate = event.summary.match(/on\s+(.+)\.$/i);
      return matchedDate
        ? `Scheduled follow-up for ${patientName} on ${matchedDate[1]}.`
        : `Scheduled follow-up for ${patientName}.`;
    }
    if (event.action === "patient_updated" && patientName) {
      const changedFields = Array.isArray(event.metadata?.changed_fields)
        ? event.metadata.changed_fields.map(String).join(", ")
        : "";
      return changedFields ? `Updated ${patientName}: ${changedFields}.` : `Updated ${patientName}.`;
    }
    return event.summary;
  }

  function getAuditMetaLine(event: (typeof auditEvents)[number]) {
    const patientName = getPatientName(event);
    if (patientName) {
      return `${event.entity_type.replaceAll("_", " ")} · ${patientName}`;
    }
    return event.entity_type.replaceAll("_", " ");
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
                <select value={entityFilter} onChange={(event) => setEntityFilter(event.target.value)} className="rounded-full border border-sky-200 bg-white px-4 py-2 text-sm text-slate-700">
                  <option value="all">All entities</option>
                  <option value="note">Notes</option>
                  <option value="invoice">Invoices</option>
                  <option value="catalog_item">Inventory</option>
                  <option value="patient">Patients</option>
                  <option value="follow_up">Follow-ups</option>
                </select>
                <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} className="rounded-full border border-sky-200 bg-white px-4 py-2 text-sm text-slate-700">
                  <option value="all">All actions</option>
                  <option value="consultation_note_shared">Note shared</option>
                  <option value="consultation_note_finalized">Note finalized</option>
                  <option value="consultation_note_amended">Note amended</option>
                  <option value="invoice_shared">Invoice shared</option>
                  <option value="invoice_created">Invoice created</option>
                  <option value="catalog_stock_adjusted">Stock adjusted</option>
                </select>
                <button type="button" onClick={() => void handleRefreshAudit()} className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-sky-50"><RefreshCw className="h-4 w-4" />Refresh</button>
                <div className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700">{visibleAuditEvents.length} event{visibleAuditEvents.length === 1 ? "" : "s"}</div>
              </div>
            </div>
            {auditError ? <p className="mt-4 text-sm font-medium text-rose-600">{auditError}</p> : null}
            <div className="mt-5 divide-y divide-sky-100">
              {visibleAuditEvents.length ? visibleAuditEvents.map((event) => (
                <div key={event.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <p className="text-sm font-semibold text-slate-900">{getAuditSummary(event)}</p>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          {event.actor_name} · {event.action.replaceAll("_", " ")}
                        </p>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>{getAuditMetaLine(event)}</span>
                      </div>
                      {Object.keys(event.metadata || {}).length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {event.metadata.sent_to ? <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] leading-5 text-slate-600">To {String(event.metadata.sent_to)}</span> : null}
                          {event.metadata.sent_by_name ? <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] leading-5 text-slate-600">By {String(event.metadata.sent_by_name)}</span> : null}
                          {event.metadata.completed_by_name ? <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] leading-5 text-slate-600">Completed by {String(event.metadata.completed_by_name)}</span> : null}
                          {event.metadata.version_number ? <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] leading-5 text-slate-600">V{String(event.metadata.version_number)}</span> : null}
                          {Array.isArray(event.metadata.stock_deductions) && event.metadata.stock_deductions.length ? <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] leading-5 text-slate-600">{event.metadata.stock_deductions.length} stock item{event.metadata.stock_deductions.length === 1 ? "" : "s"}</span> : null}
                          {typeof event.metadata.delta === "number" ? <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] leading-5 text-slate-600">Delta {event.metadata.delta}</span> : null}
                        </div>
                      ) : null}
                    </div>
                    <p className="shrink-0 text-right text-xs text-slate-500">{new Date(event.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                  </div>
                </div>
              )) : <div className="rounded-[24px] border border-dashed border-sky-300 bg-sky-50/20 px-6 py-12 text-center text-sm text-slate-500">No audit events match these filters.</div>}
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
