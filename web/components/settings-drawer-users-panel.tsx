"use client";

import { FormEvent } from "react";
import { UserPlus } from "lucide-react";

import { AuthUser } from "@/lib/types";

export type UserFormState = {
  identifier: string;
  password: string;
};

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
}: SettingsDrawerUsersPanelProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-[28px] border border-sky-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">User Access</h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              Manage the people who can access this clinic workspace.
            </p>
          </div>
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

        {currentUser?.role !== "admin" ? (
          <p className="mt-4 text-sm font-medium text-amber-700">Only admins can add staff users.</p>
        ) : null}
        {userSuccess ? <p className="mt-4 text-sm font-medium text-emerald-700">{userSuccess}</p> : null}

        {isAddUserOpen && currentUser?.role === "admin" ? (
          <form className="mt-4 grid gap-4 border-t border-sky-100 pt-4" onSubmit={onSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Email or phone number</span>
              <input
                value={userForm.identifier}
                onChange={(event) => onUserFormChange({ identifier: event.target.value })}
                className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
              <input
                type="password"
                value={userForm.password}
                onChange={(event) => onUserFormChange({ password: event.target.value })}
                className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
              />
            </label>
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
      </div>

      <div className="rounded-[28px] border border-sky-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Clinic Users</h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">Everyone who currently has access to this clinic.</p>
          </div>
          <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">{users.length} total</span>
        </div>
        {users.length ? (
          <div className="overflow-hidden rounded-[22px] border border-sky-200">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-sky-50/80 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Name</th>
                  <th className="px-4 py-3 text-left font-semibold">Role</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {users.map((user) => (
                  <tr key={user.id} className="border-t border-sky-100 first:border-t-0">
                    <td className="px-4 py-3 text-slate-800">{user.name}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                        {user.role === "admin" ? "Admin" : "Staff"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-slate-600">No users found for this clinic yet.</p>}
      </div>
    </div>
  );
}
