"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, X } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { SettingsDrawer } from "@/components/settings-drawer";
import { api } from "@/lib/api";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { AuditEvent, Patient } from "@/lib/types";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function getSectionLabel(entityType: string) {
  const labels: Record<string, string> = {
    note: "Consultation",
    invoice: "Billing",
    catalog_item: "Inventory",
    patient: "Patients",
    follow_up: "Follow-up",
    user: "Users",
    appointment: "Appointments",
  };
  return labels[entityType] || entityType.replaceAll("_", " ");
}

function getActionLabel(action: string) {
  const labels: Record<string, string> = {
    consultation_note_created: "Created",
    consultation_note_updated: "Updated",
    consultation_note_finalized: "Finalized",
    consultation_note_shared: "Sent",
    consultation_note_amended: "Amended",
    invoice_created: "Created",
    invoice_shared: "Sent",
    catalog_stock_adjusted: "Stock Changed",
    catalog_item_created: "Created",
    catalog_item_deleted: "Deleted",
    patient_updated: "Updated",
    patient_created: "Created",
    follow_up_created: "Created",
    follow_up_updated: "Updated",
    staff_user_created: "Created",
  };
  return labels[action] || action.replaceAll("_", " ");
}

export default function AuditPage() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
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
    applyClinicSettings,
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

  function getPatientName(event: AuditEvent) {
    const metadataName = String(event.metadata?.patient_name || "").trim();
    if (metadataName) {
      return metadataName;
    }
    const patientId = String(event.metadata?.patient_id || "").trim();
    return patientNamesById[patientId] || "";
  }

  function getAuditSummary(event: AuditEvent) {
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
      return `Shared consultation note for ${patientName} with ${recipient}.`;
    }
    if (event.action === "consultation_note_finalized" && patientName) {
      return `Finalized consultation note for ${patientName}.`;
    }
    if (event.action === "consultation_note_created" && patientName) {
      return `Generated consultation note for ${patientName}.`;
    }
    if (event.action === "consultation_note_updated" && patientName) {
      return `Updated consultation note for ${patientName}.`;
    }
    if (event.action === "consultation_note_amended" && patientName) {
      return `Created amended consultation note for ${patientName}.`;
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
                <h2 className="text-xl font-semibold text-slate-900">Audit Log</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Click any row to inspect the full event details.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select value={entityFilter} onChange={(event) => setEntityFilter(event.target.value)} className="rounded-full border border-sky-200 bg-white px-4 py-2 text-sm text-slate-700">
                  <option value="all">All sections</option>
                  <option value="note">Consultation</option>
                  <option value="invoice">Billing</option>
                  <option value="catalog_item">Inventory</option>
                  <option value="patient">Patients</option>
                  <option value="follow_up">Follow-ups</option>
                  <option value="user">Users</option>
                  <option value="appointment">Appointments</option>
                </select>
                <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} className="rounded-full border border-sky-200 bg-white px-4 py-2 text-sm text-slate-700">
                  <option value="all">All actions</option>
                  <option value="consultation_note_created">Created</option>
                  <option value="consultation_note_updated">Updated</option>
                  <option value="consultation_note_finalized">Finalized</option>
                  <option value="consultation_note_shared">Sent</option>
                  <option value="invoice_created">Invoice created</option>
                  <option value="invoice_shared">Invoice sent</option>
                  <option value="catalog_stock_adjusted">Stock changed</option>
                </select>
                <button type="button" onClick={() => void handleRefreshAudit()} className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-sky-50"><RefreshCw className="h-4 w-4" />Refresh</button>
                <div className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700">{visibleAuditEvents.length} event{visibleAuditEvents.length === 1 ? "" : "s"}</div>
              </div>
            </div>
            {auditError ? <p className="mt-4 text-sm font-medium text-rose-600">{auditError}</p> : null}
            <div className="mt-5 overflow-hidden rounded-[22px] border border-sky-200">
              {visibleAuditEvents.length ? (
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-sky-50/80 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">User</th>
                      <th className="px-4 py-3 text-left font-semibold">Patient</th>
                      <th className="px-4 py-3 text-left font-semibold">Section</th>
                      <th className="px-4 py-3 text-left font-semibold">Action</th>
                      <th className="px-4 py-3 text-left font-semibold">Date</th>
                      <th className="px-4 py-3 text-left font-semibold">Time</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {visibleAuditEvents.map((event) => (
                      <tr
                        key={event.id}
                        className="cursor-pointer border-t border-sky-100 first:border-t-0 transition hover:bg-sky-50/50"
                        onClick={() => setSelectedEvent(event)}
                      >
                        <td className="px-4 py-3 text-slate-800">{event.actor_name || "System"}</td>
                        <td className="px-4 py-3 text-slate-600">{getPatientName(event) || "—"}</td>
                        <td className="px-4 py-3 text-slate-600">{getSectionLabel(event.entity_type)}</td>
                        <td className="px-4 py-3 text-slate-600">{getActionLabel(event.action)}</td>
                        <td className="px-4 py-3 text-slate-600">{formatDate(event.created_at)}</td>
                        <td className="px-4 py-3 text-slate-600">{formatTime(event.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="rounded-[24px] border border-dashed border-sky-300 bg-sky-50/20 px-6 py-12 text-center text-sm text-slate-500">No audit events match these filters.</div>
              )}
            </div>
          </div>
        )}
      </div>
      {selectedEvent ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4">
          <button
            type="button"
            aria-label="Close audit details"
            onClick={() => setSelectedEvent(null)}
            className="absolute inset-0"
          />
          <div className="relative z-10 w-full max-w-2xl rounded-[28px] border border-sky-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold text-slate-900">{getAuditSummary(selectedEvent)}</h3>
                <p className="mt-2 text-sm text-slate-500">Full audit event details</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="rounded-full border border-sky-200 p-2 text-slate-500 transition hover:text-slate-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-sky-100 bg-sky-50/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">User</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{selectedEvent.actor_name || "System"}</p>
              </div>
              <div className="rounded-2xl border border-sky-100 bg-sky-50/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Patient</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{getPatientName(selectedEvent) || "—"}</p>
              </div>
              <div className="rounded-2xl border border-sky-100 bg-sky-50/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Section</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{getSectionLabel(selectedEvent.entity_type)}</p>
              </div>
              <div className="rounded-2xl border border-sky-100 bg-sky-50/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Action</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{getActionLabel(selectedEvent.action)}</p>
              </div>
              <div className="rounded-2xl border border-sky-100 bg-sky-50/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Date</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{formatDate(selectedEvent.created_at)}</p>
              </div>
              <div className="rounded-2xl border border-sky-100 bg-sky-50/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Time</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{formatTime(selectedEvent.created_at)}</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-sky-100 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Summary</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{getAuditSummary(selectedEvent)}</p>
            </div>

            <div className="mt-4 rounded-2xl border border-sky-100 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Metadata</p>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-50 p-4 text-xs leading-6 text-slate-700">{JSON.stringify(selectedEvent.metadata || {}, null, 2)}</pre>
            </div>
          </div>
        </div>
      ) : null}
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
        onClinicSettingsChange={applyClinicSettings}
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
