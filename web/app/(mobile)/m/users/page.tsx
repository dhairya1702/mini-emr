"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { SettingsDrawerUsersPanel, UserFormState } from "@/components/settings-drawer-users-panel";
import { api } from "@/lib/api";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";

export default function MobileUsersPage() {
  const { currentUser, isAuthReady, isRedirectingToLogin } = useClinicShell();
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const emptyUserForm: UserFormState = { name: "", email: "", phone: "", identifier: "", password: "", role: "staff" };
  const [userForm, setUserForm] = useState<UserFormState>(emptyUserForm);
  const [userError, setUserError] = useState("");
  const [userSuccess, setUserSuccess] = useState("");
  const [isAddingUser, setIsAddingUser] = useState(false);
  const loadPageData = useCallback(async () => null, []);
  const onPageData = useCallback(() => undefined, []);
  const {
    users,
    loadUsers,
    usersError,
    error,
    handleAddStaffUser,
    handleUpdateUserRole,
    handleDeleteUser,
  } = useClinicShellPage({
    loadPageData,
    onPageData,
  });

  useEffect(() => {
    if (isAuthReady && currentUser) {
      void loadUsers().catch(() => undefined);
    }
  }, [currentUser, isAuthReady, loadUsers]);

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

  if (!isAuthReady || isRedirectingToLogin) {
    return (
      <MobileShell title="Users">
        <p className="clinic-empty-state">Loading...</p>
      </MobileShell>
    );
  }

  return (
    <MobileShell title="Users">
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
    </MobileShell>
  );
}
