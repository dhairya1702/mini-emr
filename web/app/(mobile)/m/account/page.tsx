"use client";

import { FormEvent, useEffect, useState } from "react";

import { MobileShell } from "@/components/mobile/mobile-shell";
import { PasswordInput } from "@/components/password-input";
import { useClinicShell } from "@/components/clinic-shell-provider";
import { api, resolveApiAssetUrl } from "@/lib/api";
import type { AuthUser } from "@/lib/types";

function normalizeDateInput(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

export default function MobileAccountPage() {
  const { currentUser, isAuthReady, isRedirectingToLogin, applyCurrentUser } = useClinicShell();
  const [accountUser, setAccountUser] = useState<AuthUser | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: "",
    doctor_dob: "",
    doctor_address: "",
  });
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUpdatingSignature, setIsUpdatingSignature] = useState(false);
  const [signatureMessage, setSignatureMessage] = useState("");
  const [signatureError, setSignatureError] = useState("");
  const [passwordForm, setPasswordForm] = useState({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  const resolvedUser = accountUser ?? currentUser;

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

  function resetProfileForm() {
    if (!resolvedUser) {
      return;
    }
    setProfileForm({
      name: resolvedUser.name || "",
      doctor_dob: normalizeDateInput(resolvedUser.doctor_dob),
      doctor_address: resolvedUser.doctor_address || "",
    });
    setProfileError("");
    setProfileMessage("");
    setSignatureError("");
    setSignatureMessage("");
    setIsEditing(false);
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileForm.name.trim()) {
      setProfileError("Name is required.");
      return;
    }
    setIsSavingProfile(true);
    setProfileError("");
    setProfileMessage("");
    try {
      const updated = await api.updateMyAccount({
        name: profileForm.name.trim(),
        doctor_dob: profileForm.doctor_dob || null,
        doctor_address: profileForm.doctor_address.trim(),
      });
      setAccountUser(updated);
      applyCurrentUser(updated);
      setProfileMessage("Account details saved.");
      setIsEditing(false);
    } catch (saveError) {
      setProfileError(saveError instanceof Error ? saveError.message : "Failed to save account details.");
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handleUploadSignature(file: File) {
    setIsUpdatingSignature(true);
    setSignatureError("");
    setSignatureMessage("");
    try {
      const updated = await api.uploadMySignature(file);
      setAccountUser(updated);
      applyCurrentUser(updated);
      setSignatureMessage("Signature saved.");
    } catch (saveError) {
      setSignatureError(saveError instanceof Error ? saveError.message : "Failed to upload signature.");
    } finally {
      setIsUpdatingSignature(false);
    }
  }

  async function handleRemoveSignature() {
    setIsUpdatingSignature(true);
    setSignatureError("");
    setSignatureMessage("");
    try {
      const updated = await api.removeMySignature();
      setAccountUser(updated);
      applyCurrentUser(updated);
      setSignatureMessage("Signature removed.");
    } catch (saveError) {
      setSignatureError(saveError instanceof Error ? saveError.message : "Failed to remove signature.");
    } finally {
      setIsUpdatingSignature(false);
    }
  }

  async function handleSavePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    setPasswordMessage("");
    if (passwordForm.new_password.length < 12) {
      setPasswordError("Password must be at least 12 characters.");
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
      setPasswordForm({ current_password: "", new_password: "", confirm_password: "" });
      setPasswordMessage("Password updated.");
    } catch (saveError) {
      setPasswordError(saveError instanceof Error ? saveError.message : "Failed to update password.");
    } finally {
      setIsSavingPassword(false);
    }
  }

  if (!isAuthReady || isRedirectingToLogin) {
    return (
      <MobileShell title="Account">
        <p className="clinic-empty-state">Loading...</p>
      </MobileShell>
    );
  }

  return (
    <MobileShell title="Account">
      <div className="grid gap-4">
        <section className="rounded-[22px] border border-[#dbe7ef] bg-white p-4 shadow-[0_14px_34px_rgba(64,131,181,0.10)]">
          <form onSubmit={handleSaveProfile}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Profile</p>
                <h1 className="mt-1 text-xl font-semibold text-slate-900">{resolvedUser?.name || "Account"}</h1>
                <p className="mt-1 text-sm text-slate-500">{resolvedUser?.identifier || "-"}</p>
              </div>
              {!isEditing ? (
                <button
                  type="button"
                  onClick={() => {
                    setProfileMessage("");
                    setSignatureMessage("");
                    setIsEditing(true);
                  }}
                  className="rounded-xl bg-[#2f8fd3] px-4 py-2 text-sm font-medium text-white"
                >
                  Edit
                </button>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Name
                {isEditing ? (
                  <input
                    value={profileForm.name}
                    onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))}
                    className="clinic-input h-11 rounded-xl text-base"
                  />
                ) : (
                  <span className="rounded-xl bg-[#f3f8fb] px-3 py-3 text-slate-900">{resolvedUser?.name || "-"}</span>
                )}
              </label>
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                DOB
                {isEditing ? (
                  <input
                    type="date"
                    value={profileForm.doctor_dob}
                    onChange={(event) => setProfileForm((current) => ({ ...current, doctor_dob: event.target.value }))}
                    className="clinic-input h-11 rounded-xl text-base"
                  />
                ) : (
                  <span className="rounded-xl bg-[#f3f8fb] px-3 py-3 text-slate-900">{profileForm.doctor_dob || "-"}</span>
                )}
              </label>
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Address
                {isEditing ? (
                  <input
                    value={profileForm.doctor_address}
                    onChange={(event) => setProfileForm((current) => ({ ...current, doctor_address: event.target.value }))}
                    className="clinic-input h-11 rounded-xl text-base"
                  />
                ) : (
                  <span className="rounded-xl bg-[#f3f8fb] px-3 py-3 text-slate-900">{profileForm.doctor_address || "-"}</span>
                )}
              </label>
            </div>

            <div className="mt-4 rounded-2xl border border-[#dbe7ef] bg-[#f7fbfd] p-3">
              <p className="text-sm font-semibold text-slate-800">Signature</p>
              {resolvedUser?.doctor_signature_url ? (
                <div className="mt-3 rounded-xl bg-white p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={resolveApiAssetUrl(resolvedUser.doctor_signature_url)}
                    alt="User signature"
                    className="max-h-16 w-auto max-w-full object-contain"
                  />
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">No signature uploaded.</p>
              )}
              {isEditing ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <label className="inline-flex cursor-pointer rounded-xl bg-[#2f8fd3] px-4 py-2 text-sm font-medium text-white">
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
                      className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            {profileError ? <p className="mt-3 text-sm font-medium text-rose-600">{profileError}</p> : null}
            {profileMessage ? <p className="mt-3 text-sm font-medium text-emerald-700">{profileMessage}</p> : null}
            {signatureError ? <p className="mt-3 text-sm font-medium text-rose-600">{signatureError}</p> : null}
            {signatureMessage ? <p className="mt-3 text-sm font-medium text-emerald-700">{signatureMessage}</p> : null}

            {isEditing ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={resetProfileForm}
                  className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="rounded-xl bg-[#2f8fd3] px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
                >
                  {isSavingProfile ? "Saving..." : "Save"}
                </button>
              </div>
            ) : null}
          </form>
        </section>

        <section className="rounded-[22px] border border-[#dbe7ef] bg-white p-4 shadow-[0_14px_34px_rgba(64,131,181,0.10)]">
          <h2 className="text-lg font-semibold text-slate-900">Password</h2>
          <form className="mt-4 grid gap-3" onSubmit={handleSavePassword}>
            <PasswordInput
              label="Current password"
              value={passwordForm.current_password}
              onChange={(event) => setPasswordForm((current) => ({ ...current, current_password: event.target.value }))}
              wrapperClassName="grid gap-1 text-sm font-medium text-slate-700"
              labelClassName=""
              inputClassName="clinic-input h-11 rounded-xl pr-11 text-base"
            />
            <PasswordInput
              label="New password"
              value={passwordForm.new_password}
              onChange={(event) => setPasswordForm((current) => ({ ...current, new_password: event.target.value }))}
              wrapperClassName="grid gap-1 text-sm font-medium text-slate-700"
              labelClassName=""
              inputClassName="clinic-input h-11 rounded-xl pr-11 text-base"
            />
            <PasswordInput
              label="Confirm password"
              value={passwordForm.confirm_password}
              onChange={(event) => setPasswordForm((current) => ({ ...current, confirm_password: event.target.value }))}
              wrapperClassName="grid gap-1 text-sm font-medium text-slate-700"
              labelClassName=""
              inputClassName="clinic-input h-11 rounded-xl pr-11 text-base"
            />
            {passwordError ? <p className="text-sm font-medium text-rose-600">{passwordError}</p> : null}
            {passwordMessage ? <p className="text-sm font-medium text-emerald-700">{passwordMessage}</p> : null}
            <button
              type="submit"
              disabled={isSavingPassword}
              className="rounded-xl bg-[#2f8fd3] px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
            >
              {isSavingPassword ? "Updating..." : "Update password"}
            </button>
          </form>
        </section>
      </div>
    </MobileShell>
  );
}
