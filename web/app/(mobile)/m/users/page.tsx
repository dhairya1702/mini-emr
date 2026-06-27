"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { SettingsDrawerUsersPanel, UserFormState } from "@/components/settings-drawer-users-panel";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";

export default function MobileUsersPage() {
  const router = useRouter();
  const { currentUser, isAuthReady, isRedirectingToLogin } = useClinicShell();
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [userForm, setUserForm] = useState<UserFormState>({ identifier: "", password: "" });
  const [userError, setUserError] = useState("");
  const [userSuccess, setUserSuccess] = useState("");
  const [isAddingUser, setIsAddingUser] = useState(false);
  const canLoadAdminPageData = useCallback((user: { role: "admin" | "staff" }) => user.role === "admin", []);
  const loadPageData = useCallback(async () => null, []);
  const onPageData = useCallback(() => undefined, []);
  const {
    users,
    loadUsers,
    error,
    handleAddStaffUser,
    handleUpdateUserRole,
    handleDeleteUser,
  } = useClinicShellPage({
    canLoadPageData: canLoadAdminPageData,
    loadPageData,
    onPageData,
  });

  useEffect(() => {
    if (isAuthReady && currentUser?.role === "staff") {
      router.replace("/m");
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
    if (userForm.password.length < 12) {
      setUserError("Password must be at least 12 characters.");
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

  if (!isAuthReady || isRedirectingToLogin) {
    return (
      <MobileShell title="Users">
        <p className="clinic-empty-state">Loading...</p>
      </MobileShell>
    );
  }

  if (currentUser?.role === "staff") {
    return (
      <MobileShell title="Users">
        <p className="clinic-empty-state">Redirecting to queue...</p>
      </MobileShell>
    );
  }

  return (
    <MobileShell title="Users">
      {error ? <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
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
        onDeleteUser={handleDeleteUser}
      />
    </MobileShell>
  );
}
