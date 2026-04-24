"use client";

import { FormEvent, useEffect, useState } from "react";

import { AppHeader } from "@/components/app-header";
import { PasswordInput } from "@/components/password-input";
import { SettingsDrawer } from "@/components/settings-drawer";
import { api } from "@/lib/api";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { AuthUser } from "@/lib/types";

function normalizeDateInput(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  return value.slice(0, 10);
}

export default function AccountPage() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [accountUser, setAccountUser] = useState<AuthUser | null>(null);
  const [profileForm, setProfileForm] = useState({
    name: "",
    doctor_dob: "",
    doctor_address: "",
  });
  const [profileError, setProfileError] = useState("");
  const [profileStatus, setProfileStatus] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [passwordError, setPasswordError] = useState("");
  const [passwordStatus, setPasswordStatus] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [signatureError, setSignatureError] = useState("");
  const [signatureStatus, setSignatureStatus] = useState("");
  const [isUpdatingSignature, setIsUpdatingSignature] = useState(false);
  const loadPageData = async () => null;
  const onPageData = () => undefined;
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
  } = useClinicShellPage({
    loadPageData,
    onPageData,
  });

  const resolvedUser = accountUser ?? currentUser;
  const clinicName = clinicSettings?.clinic_name || "ClinicOS";

  useEffect(() => {
    if (!currentUser) {
      return;
    }
    setAccountUser(currentUser);
    setProfileForm({
      name: currentUser.name || "",
      doctor_dob: normalizeDateInput(currentUser.doctor_dob),
      doctor_address: currentUser.doctor_address || "",
    });
  }, [currentUser]);

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resolvedUser) {
      return;
    }
    if (!profileForm.name.trim()) {
      setProfileError("Name is required.");
      return;
    }

    setIsSavingProfile(true);
    setProfileError("");
    setProfileStatus("");
    try {
      const updated = await api.updateMyAccount({
        name: profileForm.name.trim(),
        doctor_dob: profileForm.doctor_dob || null,
        doctor_address: profileForm.doctor_address.trim(),
      });
      setAccountUser(updated);
      setProfileStatus("Account details saved.");
    } catch (saveError) {
      setProfileError(saveError instanceof Error ? saveError.message : "Failed to save account details.");
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handleSavePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    setPasswordStatus("");

    if (passwordForm.new_password.length < 6) {
      setPasswordError("Password must be at least 6 characters.");
      return;
    }
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }

    setIsSavingPassword(true);
    try {
      await api.updateMyPassword({
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
      });
      setPasswordForm({
        current_password: "",
        new_password: "",
        confirm_password: "",
      });
      setPasswordStatus("Password updated.");
    } catch (saveError) {
      setPasswordError(saveError instanceof Error ? saveError.message : "Failed to update password.");
    } finally {
      setIsSavingPassword(false);
    }
  }

  async function handleUploadSignature(file: File) {
    setIsUpdatingSignature(true);
    setSignatureError("");
    setSignatureStatus("");
    try {
      const updated = await api.uploadMySignature(file);
      setAccountUser(updated);
      setSignatureStatus("Signature saved.");
    } catch (saveError) {
      setSignatureError(saveError instanceof Error ? saveError.message : "Failed to upload signature.");
    } finally {
      setIsUpdatingSignature(false);
    }
  }

  async function handleRemoveSignature() {
    setIsUpdatingSignature(true);
    setSignatureError("");
    setSignatureStatus("");
    try {
      const updated = await api.removeMySignature();
      setAccountUser(updated);
      setSignatureStatus("Signature removed.");
    } catch (saveError) {
      setSignatureError(saveError instanceof Error ? saveError.message : "Failed to remove signature.");
    } finally {
      setIsUpdatingSignature(false);
    }
  }

  if (isRedirectingToLogin) {
    return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_20px_60px_rgba(125,211,252,0.18)]">Redirecting to login...</div></main>;
  }

  if (!isAuthReady) {
    return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_20px_60px_rgba(125,211,252,0.18)]">Loading ClinicOS...</div></main>;
  }

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px]">
        <AppHeader
          clinicName={clinicName}
          currentUser={resolvedUser}
          active="account"
          onOpenSettings={() => setIsSettingsOpen(true)}
          onLogout={handleLogout}
        />

        {error ? <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(360px,0.9fr)_minmax(360px,0.75fr)]">
          <section className="rounded-[32px] border border-sky-100 bg-white/95 p-6 shadow-[0_20px_60px_rgba(125,211,252,0.16)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Account</p>
                <h1 className="mt-2 text-2xl font-semibold text-slate-900">Your details</h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  These details belong to your user account. Your name and signature are used on documents you generate.
                </p>
              </div>
              {resolvedUser ? (
                <div className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700">
                  {resolvedUser.role === "admin" ? "Admin" : "Staff"}
                </div>
              ) : null}
            </div>

            <form className="mt-6 grid gap-4" onSubmit={handleSaveProfile}>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Name</span>
                <input
                  value={profileForm.name}
                  onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))}
                  className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Login ID</span>
                  <input
                    value={resolvedUser?.identifier || ""}
                    disabled
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-500 outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Date of birth</span>
                  <input
                    type="date"
                    value={profileForm.doctor_dob}
                    onChange={(event) => setProfileForm((current) => ({ ...current, doctor_dob: event.target.value }))}
                    className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                  />
                </label>
              </div>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Address</span>
                <textarea
                  rows={4}
                  value={profileForm.doctor_address}
                  onChange={(event) => setProfileForm((current) => ({ ...current, doctor_address: event.target.value }))}
                  className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>
              {profileError ? <p className="text-sm font-medium text-rose-600">{profileError}</p> : null}
              {profileStatus ? <p className="text-sm font-medium text-emerald-700">{profileStatus}</p> : null}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
                >
                  {isSavingProfile ? "Saving..." : "Save details"}
                </button>
              </div>
            </form>
          </section>

          <div className="space-y-6">
            <section className="rounded-[32px] border border-sky-100 bg-white/95 p-6 shadow-[0_20px_60px_rgba(125,211,252,0.16)]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Signature</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-900">Document signature</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Upload a JPG or PNG signature. Generated notes and letters use your own signature when available.
                </p>
              </div>

              <div className="mt-5 rounded-[24px] border border-sky-100 bg-sky-50/40 p-4">
                {resolvedUser?.doctor_signature_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`${process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8001"}${resolvedUser.doctor_signature_url}`}
                    alt="User signature"
                    className="max-h-28 w-auto max-w-full object-contain"
                  />
                ) : (
                  <p className="text-sm text-slate-500">No signature uploaded yet.</p>
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600">
                  {isUpdatingSignature ? "Uploading..." : "Upload signature"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="sr-only"
                    disabled={isUpdatingSignature}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void handleUploadSignature(file);
                      }
                      event.target.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={!resolvedUser?.doctor_signature_name || isUpdatingSignature}
                  onClick={() => void handleRemoveSignature()}
                  className="rounded-full border border-rose-200 bg-white px-5 py-2.5 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                >
                  Remove
                </button>
              </div>
              {signatureError ? <p className="mt-4 text-sm font-medium text-rose-600">{signatureError}</p> : null}
              {signatureStatus ? <p className="mt-4 text-sm font-medium text-emerald-700">{signatureStatus}</p> : null}
            </section>

            <section className="rounded-[32px] border border-sky-100 bg-white/95 p-6 shadow-[0_20px_60px_rgba(125,211,252,0.16)]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Security</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-900">Change password</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Update your own login password here. This does not affect any other user in the clinic.
                </p>
              </div>

              <form className="mt-6 grid gap-4" onSubmit={handleSavePassword}>
                <PasswordInput
                  label="Current password"
                  value={passwordForm.current_password}
                  onChange={(event) => setPasswordForm((current) => ({ ...current, current_password: event.target.value }))}
                />
                <PasswordInput
                  label="New password"
                  value={passwordForm.new_password}
                  onChange={(event) => setPasswordForm((current) => ({ ...current, new_password: event.target.value }))}
                />
                <PasswordInput
                  label="Confirm new password"
                  value={passwordForm.confirm_password}
                  onChange={(event) => setPasswordForm((current) => ({ ...current, confirm_password: event.target.value }))}
                />
                {passwordError ? <p className="text-sm font-medium text-rose-600">{passwordError}</p> : null}
                {passwordStatus ? <p className="text-sm font-medium text-emerald-700">{passwordStatus}</p> : null}
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isSavingPassword}
                    className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
                  >
                    {isSavingPassword ? "Updating..." : "Change password"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        </div>
      </div>

      <SettingsDrawer
        open={isSettingsOpen}
        settings={clinicSettings}
        currentUser={resolvedUser}
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
        onCheckInAppointment={(appointmentId, options) =>
          options?.existingPatientId
            ? api.checkInAppointmentWithPatient(appointmentId, options.existingPatientId).then((patient) => ({
              id: appointmentId,
              checked_in_at: new Date().toISOString(),
              checked_in_patient_id: patient.id,
            }))
            : api.checkInAppointment(appointmentId, { force_new: options?.forceNew }).then((patient) => ({
              id: appointmentId,
              checked_in_at: new Date().toISOString(),
              checked_in_patient_id: patient.id,
            }))
        }
        onUpdateAppointment={(appointmentId, payload) => api.updateAppointment(appointmentId, payload)}
        onUpdateFollowUp={(followUpId, payload) => api.updateFollowUp(followUpId, payload)}
        onBillingComplete={() => undefined}
      />
    </main>
  );
}
