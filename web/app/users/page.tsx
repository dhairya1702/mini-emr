"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { AppHeader } from "@/components/app-header";
import { LazySettingsDrawer } from "@/components/lazy-settings-drawer";
import { SettingsDrawerUsersPanel, UserFormState } from "@/components/settings-drawer-users-panel";
import { api } from "@/lib/api";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";

export default function UsersPage() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [openAddFirstStaffSetup, setOpenAddFirstStaffSetup] = useState(false);
  const emptyUserForm: UserFormState = { name: "", email: "", phone: "", identifier: "", password: "", role: "staff" };
  const [userForm, setUserForm] = useState<UserFormState>(emptyUserForm);
  const [userError, setUserError] = useState("");
  const [userSuccess, setUserSuccess] = useState("");
  const [isAddingUser, setIsAddingUser] = useState(false);
  const loadPageData = useCallback(async () => null, []);
  const onPageData = useCallback(() => undefined, []);
  const {
    currentUser,
    users,
    auditEvents,
    loadUsers,
    usersError,
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
    handleUpdateUserRole,
    handleDeleteUser,
    handleCreateInvoice,
    handleGenerateLetter,
    handleSendLetter,
    handleSendInvoice,
    handleExportPatientsCsv,
    handleExportVisitsCsv,
    handleExportInvoicesCsv,
  } = useClinicShellPage({
    loadPageData,
    onPageData,
  });
  const clinicName = clinicSettings?.clinic_name || "ClinicOS";

  useEffect(() => {
    if (isAuthReady && currentUser) {
      void loadUsers().catch(() => undefined);
    }
  }, [currentUser, isAuthReady, loadUsers]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setOpenAddFirstStaffSetup(new URLSearchParams(window.location.search).get("setup") === "add-first-staff");
  }, []);

  useEffect(() => {
    if (!isAuthReady || currentUser?.role !== "admin") {
      return;
    }
    if (openAddFirstStaffSetup) {
      setIsAddUserOpen(true);
      setUserError("");
      setUserSuccess("");
    }
  }, [currentUser, isAuthReady, openAddFirstStaffSetup]);

  async function handleAddUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUserError("");
    setUserSuccess("");
    if (!userForm.email.trim()) {
      setUserError("Email is required.");
      return;
    }
    if (!userForm.identifier.trim()) {
      setUserError("Login ID is required.");
      return;
    }
    if (userForm.password.length < 12) {
      setUserError("Password must be at least 12 characters.");
      return;
    }
    setIsAddingUser(true);
    try {
      await handleAddStaffUser({
        name: userForm.name.trim(),
        email: userForm.email.trim(),
        phone: userForm.phone.trim(),
        identifier: userForm.identifier.trim(),
        password: userForm.password,
        role: userForm.role,
      });
      setUserSuccess(`${userForm.role === "admin" ? "Admin" : userForm.role === "doctor" ? "Doctor" : "Staff"} user added.`);
      setUserForm(emptyUserForm);
      setIsAddUserOpen(false);
    } catch (saveError) {
      setUserError(saveError instanceof Error ? saveError.message : "Failed to add user.");
    } finally {
      setIsAddingUser(false);
    }
  }

  if (isRedirectingToLogin) {
    return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[20px] border border-[#dbe7ef] bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">Redirecting to login...</div></main>;
  }
  if (!isAuthReady) {
    return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[20px] border border-[#dbe7ef] bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">Loading ClinicOS...</div></main>;
  }
  return (
    <main className="clinic-page">
      <div className="clinic-container">
        <AppHeader clinicName={clinicName} currentUser={currentUser} active="users" onOpenSettings={() => setIsSettingsOpen(true)} onLogout={handleLogout} />
        {error || usersError ? <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error || usersError}</div> : null}
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
          onUpdateUserRole={handleUpdateUserRole}
          onSendPasswordReset={(userId) => api.sendUserPasswordReset(userId)}
          onDeleteUser={handleDeleteUser}
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
            const checkedInPatient = options?.existingPatientId
              ? await api.checkInAppointmentWithPatient(appointmentId, options.existingPatientId)
              : await api.checkInAppointment(appointmentId, { force_new: options?.forceNew });
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
