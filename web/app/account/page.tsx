"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import { AppHeader } from "@/components/app-header";
import { LazySettingsDrawer } from "@/components/lazy-settings-drawer";
import { PasswordInput } from "@/components/password-input";
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
  const [highlightSignature, setHighlightSignature] = useState(false);
  const [isSignatureSetupTarget, setIsSignatureSetupTarget] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: "",
    doctor_dob: "",
    doctor_address: "",
  });
  const [profileError, setProfileError] = useState("");
  const [profileStatus, setProfileStatus] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
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
  const signatureSectionRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setIsSignatureSetupTarget(new URLSearchParams(window.location.search).get("setup") === "signature");
  }, []);

  useEffect(() => {
    if (!isAuthReady || !isSignatureSetupTarget) {
      return;
    }

    setHighlightSignature(true);
    setIsEditingDetails(true);
    const timeoutId = window.setTimeout(() => {
      signatureSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
    const clearId = window.setTimeout(() => {
      setHighlightSignature(false);
    }, 2400);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearTimeout(clearId);
    };
  }, [isAuthReady, isSignatureSetupTarget]);

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
      setIsEditingDetails(false);
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

    if (passwordForm.new_password.length < 4) {
      setPasswordError("Password must be at least 4 characters.");
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

  function handleCancelDetailsEdit() {
    if (resolvedUser) {
      setProfileForm({
        name: resolvedUser.name || "",
        doctor_dob: normalizeDateInput(resolvedUser.doctor_dob),
        doctor_address: resolvedUser.doctor_address || "",
      });
    }
    setProfileError("");
    setProfileStatus("");
    setSignatureError("");
    setSignatureStatus("");
    setIsEditingDetails(false);
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
        <AppHeader
          clinicName={clinicName}
          currentUser={resolvedUser}
          active="account"
          onOpenSettings={() => setIsSettingsOpen(true)}
          onLogout={handleLogout}
        />

        {error ? <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <section className="rounded-[20px] border border-[#dbe7ef] bg-white/95 p-5 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">
          <form onSubmit={handleSaveProfile}>
            <div className="grid gap-2">
              <div className="grid gap-2 md:grid-cols-[160px_1fr] md:items-center">
                <span className="text-sm font-medium text-slate-700">Name</span>
                {isEditingDetails ? (
                  <input
                    value={profileForm.name}
                    onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))}
                    className="h-10 w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-3.5 text-slate-800 outline-none transition focus:border-[#6daed8]"
                  />
                ) : (
                  <p className="min-h-10 rounded-xl border border-transparent px-3.5 py-2 text-sm text-slate-900">{resolvedUser?.name || "-"}</p>
                )}
              </div>

              <div className="grid gap-2 md:grid-cols-[160px_1fr] md:items-center">
                <span className="text-sm font-medium text-slate-700">DOB</span>
                {isEditingDetails ? (
                  <input
                    type="date"
                    value={profileForm.doctor_dob}
                    onChange={(event) => setProfileForm((current) => ({ ...current, doctor_dob: event.target.value }))}
                    className="h-10 w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-3.5 text-slate-800 outline-none transition focus:border-[#6daed8]"
                  />
                ) : (
                  <p className="min-h-10 rounded-xl border border-transparent px-3.5 py-2 text-sm text-slate-900">{profileForm.doctor_dob || "-"}</p>
                )}
              </div>

              <div className="grid gap-2 md:grid-cols-[160px_1fr] md:items-center">
                <span className="text-sm font-medium text-slate-700">Login ID</span>
                <p className="min-h-10 rounded-xl border border-transparent px-3.5 py-2 text-sm text-slate-600">{resolvedUser?.identifier || "-"}</p>
              </div>

              <div className="grid gap-2 md:grid-cols-[160px_1fr] md:items-center">
                <span className="text-sm font-medium text-slate-700">Address</span>
                {isEditingDetails ? (
                  <input
                    value={profileForm.doctor_address}
                    onChange={(event) => setProfileForm((current) => ({ ...current, doctor_address: event.target.value }))}
                    className="h-10 w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-3.5 text-slate-800 outline-none transition focus:border-[#6daed8]"
                  />
                ) : (
                  <p className="min-h-10 rounded-xl border border-transparent px-3.5 py-2 text-sm text-slate-900">{profileForm.doctor_address || "-"}</p>
                )}
              </div>

              <div
                ref={signatureSectionRef}
                className={`grid gap-2 md:grid-cols-[160px_1fr] md:items-center ${
                  highlightSignature ? "rounded-xl ring-2 ring-[#d8ebf7]" : ""
                }`}
              >
                <span className="text-sm font-medium text-slate-700">Signature</span>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-h-10 min-w-0 flex-1 rounded-xl border border-transparent px-3.5 py-2 text-sm text-slate-900">
                    {resolvedUser?.doctor_signature_url ? (
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`${process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8001"}${resolvedUser.doctor_signature_url}`}
                          alt="User signature"
                          className="max-h-8 w-auto max-w-[160px] object-contain"
                        />
                        <span className="text-sm text-slate-600">Uploaded</span>
                      </div>
                    ) : (
                      <span className="text-slate-500">No signature uploaded</span>
                    )}
                  </div>
                  {isEditingDetails ? (
                    <>
                      <label className="inline-flex cursor-pointer items-center rounded-xl bg-[#2f8fd3] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#287fc0]">
                        {isUpdatingSignature ? "Uploading..." : "Upload"}
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
                      {resolvedUser?.doctor_signature_name ? (
                        <button
                          type="button"
                          disabled={isUpdatingSignature}
                          onClick={() => void handleRemoveSignature()}
                          className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                        >
                          Remove
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            {profileError ? <p className="mt-3 text-sm font-medium text-rose-600">{profileError}</p> : null}
            {profileStatus ? <p className="mt-3 text-sm font-medium text-emerald-700">{profileStatus}</p> : null}
            {signatureError ? <p className="mt-3 text-sm font-medium text-rose-600">{signatureError}</p> : null}
            {signatureStatus ? <p className="mt-3 text-sm font-medium text-emerald-700">{signatureStatus}</p> : null}

            <div className="mt-4 flex justify-end gap-2">
              {isEditingDetails ? (
                <>
                  <button
                    type="button"
                    onClick={handleCancelDetailsEdit}
                    className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="rounded-xl bg-[#2f8fd3] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
                  >
                    {isSavingProfile ? "Saving..." : "Save details"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setProfileStatus("");
                    setSignatureStatus("");
                    setIsEditingDetails(true);
                  }}
                  className="rounded-xl bg-[#2f8fd3] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#287fc0]"
                >
                  Edit
                </button>
              )}
            </div>
          </form>

          <div className="mt-4 border-t border-[#dbe7ef] pt-4">
              <form className="grid gap-2" onSubmit={handleSavePassword}>
                <PasswordInput
                  label="Current password"
                  value={passwordForm.current_password}
                  onChange={(event) => setPasswordForm((current) => ({ ...current, current_password: event.target.value }))}
                  wrapperClassName="grid gap-2 md:grid-cols-[160px_minmax(0,36rem)] md:items-center"
                  labelClassName="text-sm font-medium text-slate-700"
                  inputClassName="h-10 w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-3.5 pr-11 text-slate-800 outline-none transition focus:border-[#6daed8]"
                />
                <PasswordInput
                  label="New password"
                  value={passwordForm.new_password}
                  onChange={(event) => setPasswordForm((current) => ({ ...current, new_password: event.target.value }))}
                  wrapperClassName="grid gap-2 md:grid-cols-[160px_minmax(0,36rem)] md:items-center"
                  labelClassName="text-sm font-medium text-slate-700"
                  inputClassName="h-10 w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-3.5 pr-11 text-slate-800 outline-none transition focus:border-[#6daed8]"
                />
                <PasswordInput
                  label="Confirm password"
                  value={passwordForm.confirm_password}
                  onChange={(event) => setPasswordForm((current) => ({ ...current, confirm_password: event.target.value }))}
                  wrapperClassName="grid gap-2 md:grid-cols-[160px_minmax(0,36rem)] md:items-center"
                  labelClassName="text-sm font-medium text-slate-700"
                  inputClassName="h-10 w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-3.5 pr-11 text-slate-800 outline-none transition focus:border-[#6daed8]"
                />
                {passwordError ? <p className="text-sm font-medium text-rose-600">{passwordError}</p> : null}
                {passwordStatus ? <p className="text-sm font-medium text-emerald-700">{passwordStatus}</p> : null}
                <div className="flex justify-start md:pl-[160px]">
                  <button
                    type="submit"
                    disabled={isSavingPassword}
                    className="rounded-xl bg-[#2f8fd3] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
                  >
                    {isSavingPassword ? "Updating..." : "Update"}
                  </button>
                </div>
              </form>
          </div>
        </section>
      </div>

      {isSettingsOpen ? (
        <LazySettingsDrawer
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
      ) : null}
    </main>
  );
}
