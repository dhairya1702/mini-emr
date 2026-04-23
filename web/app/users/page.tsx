"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { SettingsDrawer } from "@/components/settings-drawer";
import { SettingsDrawerUsersPanel, UserFormState } from "@/components/settings-drawer-users-panel";
import { api } from "@/lib/api";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { Patient } from "@/lib/types";

export default function UsersPage() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [userForm, setUserForm] = useState<UserFormState>({ identifier: "", password: "" });
  const [userError, setUserError] = useState("");
  const [userSuccess, setUserSuccess] = useState("");
  const [isAddingUser, setIsAddingUser] = useState(false);
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

  useEffect(() => {
    if (isAuthReady && currentUser?.role === "admin") {
      void loadUsers();
    }
  }, [currentUser, isAuthReady, loadUsers]);

  async function handleAddUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUserError("");
    setUserSuccess("");
    if (!userForm.identifier.trim()) {
      setUserError("Email or phone number is required.");
      return;
    }
    if (userForm.password.length < 8) {
      setUserError("Password must be at least 8 characters.");
      return;
    }
    setIsAddingUser(true);
    try {
      await handleAddStaffUser({
        identifier: userForm.identifier.trim(),
        password: userForm.password,
      });
      setUserSuccess("Staff user added.");
      setUserForm({ identifier: "", password: "" });
      setIsAddUserOpen(false);
    } catch (saveError) {
      setUserError(saveError instanceof Error ? saveError.message : "Failed to add user.");
    } finally {
      setIsAddingUser(false);
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
        <AppHeader clinicName={clinicName} currentUser={currentUser} active="users" onOpenSettings={() => setIsSettingsOpen(true)} onLogout={handleLogout} />
        {error ? <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        <SettingsDrawerUsersPanel
          currentUser={currentUser}
          users={users}
          isAddUserOpen={isAddUserOpen}
          userForm={userForm}
          userError={userError}
          userSuccess={userSuccess}
          isAddingUser={isAddingUser}
          onToggleAddUser={() => {
            setIsAddUserOpen((current) => !current);
            setUserError("");
            setUserSuccess("");
          }}
          onSubmit={handleAddUser}
          onUserFormChange={(patch) => setUserForm((current) => ({ ...current, ...patch }))}
        />
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
