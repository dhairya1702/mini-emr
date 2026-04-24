"use client";

import { FormEvent, useEffect, useState } from "react";
import { UserPlus, X } from "lucide-react";

import { PasswordInput } from "@/components/password-input";
import { AuthUser, UserRole } from "@/lib/types";

export type UserFormState = {
  identifier: string;
  password: string;
};

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
  onUpdateUserRole: (userId: string, role: UserRole) => Promise<void>;
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
  onDeleteUser,
}: SettingsDrawerUsersPanelProps) {
  const [selectedUser, setSelectedUser] = useState<AuthUser | null>(null);
  const [selectedRole, setSelectedRole] = useState<UserRole>("staff");
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [roleError, setRoleError] = useState("");
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    if (!selectedUser) {
      setSelectedRole("staff");
      setRoleError("");
      setIsUpdatingRole(false);
      setIsDeletingUser(false);
      setDeleteError("");
      return;
    }
    setSelectedRole(selectedUser.role);
    setRoleError("");
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

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] border border-sky-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Clinic Users</h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">Everyone who currently has access to this clinic.</p>
            {currentUser?.role !== "admin" ? (
              <p className="mt-3 text-sm font-medium text-amber-700">Only admins can add or update users.</p>
            ) : null}
            {userSuccess ? <p className="mt-3 text-sm font-medium text-emerald-700">{userSuccess}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">{users.length} total</span>
            <button
              type="button"
              onClick={onToggleAddUser}
              disabled={currentUser?.role !== "admin"}
              className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UserPlus className="h-4 w-4" />
              Add User
            </button>
          </div>
        </div>

        {isAddUserOpen && currentUser?.role === "admin" ? (
          <form className="mb-5 grid gap-4 rounded-[22px] border border-sky-100 bg-sky-50/30 p-4" onSubmit={onSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Email or phone number</span>
              <input
                value={userForm.identifier}
                onChange={(event) => onUserFormChange({ identifier: event.target.value })}
                className="w-full rounded-2xl border border-sky-200 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
              />
            </label>
            <PasswordInput
              label="Password"
              value={userForm.password}
              onChange={(event) => onUserFormChange({ password: event.target.value })}
              placeholder="Minimum 6 characters"
              inputClassName="w-full rounded-2xl border border-sky-200 bg-white px-4 py-3 pr-12 text-slate-800 outline-none transition focus:border-sky-400"
            />
            {userError ? <p className="text-sm font-medium text-rose-600">{userError}</p> : null}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isAddingUser}
                className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
              >
                {isAddingUser ? "Adding..." : "Create Staff User"}
              </button>
            </div>
          </form>
        ) : null}

        {users.length ? (
          <div className="overflow-hidden rounded-[22px] border border-sky-200">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-sky-50/80 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Name</th>
                  <th className="px-4 py-3 text-left font-semibold">Login ID</th>
                  <th className="px-4 py-3 text-left font-semibold">Role</th>
                  <th className="px-4 py-3 text-left font-semibold">Added On</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-t border-sky-100 first:border-t-0 transition hover:bg-sky-50/50"
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
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                        {user.role === "admin" ? "Admin" : "Staff"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatCreatedAt(user.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          <div className="relative z-10 w-full max-w-md rounded-[28px] border border-sky-200 bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="text-lg font-semibold text-slate-900">{selectedUser.name}</h4>
                <p className="mt-1 text-sm text-slate-500">{selectedUser.identifier}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="rounded-full border border-sky-200 p-2 text-slate-500 transition hover:text-slate-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Status</span>
              <select
                value={selectedRole}
                onChange={(event) => setSelectedRole(event.target.value as UserRole)}
                className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
              >
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
            </label>

            {roleError ? <p className="mt-3 text-sm font-medium text-rose-600">{roleError}</p> : null}
            {deleteError ? <p className="mt-2 text-sm font-medium text-rose-600">{deleteError}</p> : null}

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => void handleDeleteSelectedUser()}
                disabled={isDeletingUser || currentUser?.id === selectedUser.id}
                className="rounded-full border border-rose-200 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
              >
                {isDeletingUser ? "Removing..." : currentUser?.id === selectedUser.id ? "Current User" : "Remove User"}
              </button>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="rounded-full border border-sky-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-sky-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveRole()}
                disabled={isUpdatingRole || selectedRole === selectedUser.role}
                className="rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
              >
                {isUpdatingRole ? "Saving..." : "Save Role"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
