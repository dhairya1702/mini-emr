"use client";

import { FormEvent, useEffect, useState } from "react";
import { KeyRound, Trash2, UserPlus, X } from "lucide-react";

import { PasswordInput } from "@/components/password-input";
import { AuthUser, UserRole } from "@/lib/types";

export type UserFormState = {
  name: string;
  email: string;
  phone: string;
  identifier: string;
  password: string;
  role: UserRole;
};

function formatRole(role: UserRole) {
  if (role === "admin") return "Admin";
  if (role === "doctor") return "Doctor";
  return "Staff";
}

function formatCreatedAt(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface SettingsDrawerUsersPanelProps {
  currentUser: AuthUser | null;
  users: AuthUser[];
  isAddUserOpen: boolean;
  userForm: UserFormState;
  userError: string;
  userSuccess: string;
  isAddingUser: boolean;
  onToggleAddUser: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onUserFormChange: (patch: Partial<UserFormState>) => void;
  onUpdateUserRole: (userId: string, role: UserRole) => Promise<AuthUser>;
  onSendPasswordReset: (userId: string) => Promise<{ message: string }>;
  onDeleteUser: (userId: string) => Promise<void>;
}

export function SettingsDrawerUsersPanel({
  currentUser,
  users,
  isAddUserOpen,
  userForm,
  userError,
  userSuccess,
  isAddingUser,
  onToggleAddUser,
  onSubmit,
  onUserFormChange,
  onUpdateUserRole,
  onSendPasswordReset,
  onDeleteUser,
}: SettingsDrawerUsersPanelProps) {
  const [selectedUser, setSelectedUser] = useState<AuthUser | null>(null);
  const [selectedRole, setSelectedRole] = useState<UserRole>("staff");
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [roleError, setRoleError] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    if (!selectedUser) {
      setSelectedRole("staff");
      setRoleError("");
      setResetMessage("");
      setIsUpdatingRole(false);
      setIsSendingReset(false);
      setIsDeletingUser(false);
      setDeleteError("");
      return;
    }
    setSelectedRole(selectedUser.role);
    setRoleError("");
    setResetMessage("");
    setDeleteError("");
  }, [selectedUser]);

  async function handleSaveRole() {
    if (!selectedUser) {
      return;
    }
    setIsUpdatingRole(true);
    setRoleError("");
    try {
      const updated = await onUpdateUserRole(selectedUser.id, selectedRole);
      setSelectedUser(updated);
    } catch (error) {
      setRoleError(error instanceof Error ? error.message : "Failed to update user role.");
    } finally {
      setIsUpdatingRole(false);
    }
  }

  async function handleDeleteSelectedUser() {
    if (!selectedUser) {
      return;
    }
    setIsDeletingUser(true);
    setDeleteError("");
    try {
      await onDeleteUser(selectedUser.id);
      setSelectedUser(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to remove user.");
    } finally {
      setIsDeletingUser(false);
    }
  }

  async function handleSendPasswordReset() {
    if (!selectedUser) {
      return;
    }
    setIsSendingReset(true);
    setRoleError("");
    setResetMessage("");
    try {
      const result = await onSendPasswordReset(selectedUser.id);
      setResetMessage(result.message);
    } catch (error) {
      setRoleError(error instanceof Error ? error.message : "Failed to send password reset.");
    } finally {
      setIsSendingReset(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[18px] border border-[#bfd7e8] bg-white p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Users</h3>
            {currentUser?.role !== "admin" ? (
              <p className="mt-2 text-sm font-medium text-amber-700">Only admins can add or update users.</p>
            ) : null}
            {userSuccess ? <p className="mt-3 text-sm font-medium text-emerald-700">{userSuccess}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-xl bg-[#f3f8fb] px-3 py-1 text-xs font-medium text-[#2a6fa8]">{users.length} total</span>
            <button
              type="button"
              onClick={onToggleAddUser}
              disabled={currentUser?.role !== "admin"}
              className="inline-flex items-center gap-2 rounded-xl border border-[#bfd7e8] bg-[#f3f8fb] px-4 py-2 text-sm font-medium text-[#2a6fa8] transition hover:bg-[#dbeaf4] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UserPlus className="h-4 w-4" />
              Add User
            </button>
          </div>
        </div>

        {users.length ? (
          <div className="overflow-hidden rounded-[22px] border border-[#bfd7e8]">
            <div className="overflow-x-auto">
              <table className="min-w-[620px] w-full border-collapse text-sm">
              <thead className="bg-[#f3f8fb]/80 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Name</th>
                  <th className="px-4 py-3 text-left font-semibold">Login ID</th>
                  <th className="px-4 py-3 text-left font-semibold">Email</th>
                  <th className="px-4 py-3 text-left font-semibold">Role</th>
                  <th className="px-4 py-3 text-left font-semibold">Added On</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-t border-[#dbe7ef] first:border-t-0 transition hover:bg-[#f3f8fb]/50"
                    role={currentUser?.role === "admin" ? "button" : undefined}
                    tabIndex={currentUser?.role === "admin" ? 0 : -1}
                    onClick={() => {
                      if (currentUser?.role === "admin") {
                        setSelectedUser(user);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (currentUser?.role !== "admin") {
                        return;
                      }
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedUser(user);
                      }
                    }}
                  >
                    <td className="px-4 py-3 text-slate-800">{user.name}</td>
                    <td className="px-4 py-3 text-slate-600">{user.identifier}</td>
                    <td className="px-4 py-3 text-slate-600">{user.email || "-"}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-xl bg-[#f3f8fb] px-3 py-1 text-xs font-medium text-[#2a6fa8]">
                        {formatRole(user.role)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatCreatedAt(user.created_at)}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </div>
        ) : <p className="text-sm text-slate-600">No users found for this clinic yet.</p>}
      </div>

      {selectedUser && currentUser?.role === "admin" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4">
          <button
            type="button"
            aria-label="Close role editor"
            onClick={() => setSelectedUser(null)}
            className="absolute inset-0"
          />
          <div className="relative z-10 w-full max-w-2xl rounded-[18px] border border-[#bfd7e8] bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h4 className="text-2xl font-semibold text-slate-900">{selectedUser.name || selectedUser.identifier}</h4>
                <div className="mt-5 grid gap-3 text-sm md:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Name</p>
                    <p className="mt-1 break-words text-slate-900">{selectedUser.name || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Phone</p>
                    <p className="mt-1 break-words text-slate-900">{selectedUser.phone || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Email</p>
                    <p className="mt-1 break-words text-slate-900">{selectedUser.email || "No recovery email"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Login ID</p>
                    <p className="mt-1 break-words text-slate-900">{selectedUser.identifier}</p>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="rounded-xl border border-[#bfd7e8] p-2 text-slate-500 transition hover:text-slate-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Role</span>
              <select
                value={selectedRole}
                onChange={(event) => setSelectedRole(event.target.value as UserRole)}
                className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
              >
                <option value="staff">Staff</option>
                <option value="doctor">Doctor</option>
                <option value="admin">Admin</option>
              </select>
            </label>

            {roleError ? <p className="mt-3 text-sm font-medium text-rose-600">{roleError}</p> : null}
            {resetMessage ? <p className="mt-3 text-sm font-medium text-emerald-700">{resetMessage}</p> : null}
            {deleteError ? <p className="mt-2 text-sm font-medium text-rose-600">{deleteError}</p> : null}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => void handleSendPasswordReset()}
                disabled={isSendingReset || !selectedUser.email}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#bfd7e8] px-4 py-3 text-sm font-medium text-[#2a6fa8] transition hover:bg-[#f3f8fb] disabled:opacity-60"
              >
                <KeyRound className="h-4 w-4" />
                {isSendingReset ? "Sending..." : "Reset Password"}
              </button>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  aria-label={currentUser?.id === selectedUser.id ? "Cannot delete current user" : "Delete user"}
                  title={currentUser?.id === selectedUser.id ? "Cannot delete current user" : "Delete user"}
                  onClick={() => void handleDeleteSelectedUser()}
                  disabled={isDeletingUser || currentUser?.id === selectedUser.id}
                  className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-rose-200 text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveRole()}
                  disabled={isUpdatingRole || selectedRole === selectedUser.role}
                  className="rounded-xl bg-[#2f8fd3] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
                >
                  {isUpdatingRole ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isAddUserOpen && currentUser?.role === "admin" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4">
          <button
            type="button"
            aria-label="Close add user"
            onClick={onToggleAddUser}
            className="absolute inset-0"
          />
          <form
            className="relative z-10 w-full max-w-lg rounded-[18px] border border-[#bfd7e8] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.18)]"
            onSubmit={onSubmit}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="text-lg font-semibold text-slate-900">Add User</h4>
              </div>
              <button
                type="button"
                onClick={onToggleAddUser}
                className="rounded-xl border border-[#bfd7e8] p-2 text-slate-500 transition hover:text-slate-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Name</span>
              <input
                value={userForm.name}
                onChange={(event) => onUserFormChange({ name: event.target.value })}
                className="w-full rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
              />
            </label>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
              <input
                type="email"
                value={userForm.email}
                onChange={(event) => onUserFormChange({ email: event.target.value })}
                className="w-full rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
              />
            </label>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Phone number</span>
              <input
                value={userForm.phone}
                onChange={(event) => onUserFormChange({ phone: event.target.value })}
                className="w-full rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
              />
            </label>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Login ID</span>
              <input
                value={userForm.identifier}
                onChange={(event) => onUserFormChange({ identifier: event.target.value })}
                className="w-full rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
              />
              <p className="mt-2 text-sm text-slate-500">
                This is the login credential. It can match the phone number or be a separate username.
              </p>
            </label>
            <div className="mt-4">
              <PasswordInput
                label="Password"
                value={userForm.password}
                onChange={(event) => onUserFormChange({ password: event.target.value })}
                placeholder="Minimum 12 characters"
                inputClassName="w-full rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 pr-12 text-slate-800 outline-none transition focus:border-[#6daed8]"
              />
            </div>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Role</span>
              <select
                value={userForm.role}
                onChange={(event) => onUserFormChange({ role: event.target.value as UserRole })}
                className="w-full rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
              >
                <option value="staff">Staff</option>
                <option value="doctor">Doctor</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            {userError ? <p className="mt-4 text-sm font-medium text-rose-600">{userError}</p> : null}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={onToggleAddUser}
                className="rounded-xl border border-[#bfd7e8] px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isAddingUser}
                className="rounded-xl bg-[#2f8fd3] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
              >
                {isAddingUser ? "Adding..." : "Create User"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
