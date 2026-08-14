"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy, LogOut, RefreshCw, Save, Trash2, UserCog, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { CLINIC_SPECIALTY_OPTIONS, type ClinicSpecialty } from "@/lib/clinic-specialty";
import {
  ClinicSettings,
  PlatformError,
  SuperuserOrgDetail,
  SuperuserOrgUser,
  UserRole,
  WorkspaceMode,
} from "@/lib/types";

type Tab = "overview" | "users" | "settings" | "activity" | "errors" | "danger";

function formatErrorContext(context: PlatformError["context"]) {
  if (!context || !Object.keys(context).length) return "";
  return JSON.stringify(context, null, 2);
}

function copyErrorTrace(error: PlatformError) {
  const contextText = formatErrorContext(error.context);
  const trace = [
    `${error.method} ${error.path}`,
    `Time: ${new Date(error.created_at).toLocaleString()}`,
    `Status: ${error.status_code || "—"}`,
    `Type: ${error.error_type}`,
    `Identifier: ${error.identifier || "—"}`,
    "",
    error.message,
    error.details ? `\nDetails:\n${error.details}` : "",
    contextText ? `\nContext:\n${contextText}` : "",
  ].filter(Boolean).join("\n");
  void navigator.clipboard?.writeText(trace);
}

type SettingsDraft = {
  clinic_name: string;
  clinic_phone: string;
  clinic_address: string;
  clinic_specialty: ClinicSpecialty | "";
  timezone: string;
  doctor_name: string;
  appointment_start_time: string;
  appointment_end_time: string;
  appointments_per_hour: string;
  users_allowed: string;
  workspace_mode: WorkspaceMode;
};

const emptyDraft: SettingsDraft = {
  clinic_name: "",
  clinic_phone: "",
  clinic_address: "",
  clinic_specialty: "",
  timezone: "UTC",
  doctor_name: "",
  appointment_start_time: "09:00",
  appointment_end_time: "18:00",
  appointments_per_hour: "4",
  users_allowed: "2",
  workspace_mode: "solo",
};

function formatCompact(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value || 0);
}

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function draftFromDetail(detail: SuperuserOrgDetail): SettingsDraft {
  const settings = detail.settings;
  return {
    clinic_name: settings?.clinic_name || detail.summary.clinic_name,
    clinic_phone: settings?.clinic_phone || "",
    clinic_address: settings?.clinic_address || "",
    clinic_specialty: settings?.clinic_specialty || "",
    timezone: settings?.timezone || "UTC",
    doctor_name: settings?.doctor_name || "",
    appointment_start_time: settings?.appointment_start_time || "09:00",
    appointment_end_time: settings?.appointment_end_time || "18:00",
    appointments_per_hour: String(settings?.appointments_per_hour || 4),
    users_allowed: String(detail.summary.users_allowed || settings?.users_allowed || 2),
    workspace_mode: detail.summary.workspace_mode || settings?.workspace_mode || "solo",
  };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-4 text-3xl font-black tracking-[-0.04em] text-slate-950">{value}</p>
    </div>
  );
}

export default function SuperdashboardOrgDetailPage() {
  const params = useParams<{ orgId: string }>();
  const router = useRouter();
  const orgId = params.orgId;
  const [detail, setDetail] = useState<SuperuserOrgDetail | null>(null);
  const [draft, setDraft] = useState<SettingsDraft>(emptyDraft);
  const [tab, setTab] = useState<Tab>("overview");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState("");
  const [deletingUserId, setDeletingUserId] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const adminCount = useMemo(
    () => detail?.users.filter((user) => user.role === "admin").length ?? 0,
    [detail],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setMessage("");
    try {
      const data = await api.getSuperdashboardOrgDetail(orgId);
      setDetail(data);
      setDraft(draftFromDetail(data));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load organization.");
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  function setDraftField<K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const appointmentsPerHour = Number(draft.appointments_per_hour);
    if (!Number.isInteger(appointmentsPerHour) || appointmentsPerHour < 1 || appointmentsPerHour > 12) {
      setMessage("Appointments per hour must be a whole number between 1 and 12.");
      return;
    }
    setIsSaving(true);
    setMessage("");
    try {
      const settingsPayload: Partial<ClinicSettings> = {
        clinic_name: draft.clinic_name.trim(),
        clinic_phone: draft.clinic_phone.trim(),
        clinic_address: draft.clinic_address.trim(),
        clinic_specialty: draft.clinic_specialty || null,
        timezone: draft.timezone.trim() || "UTC",
        doctor_name: draft.doctor_name.trim(),
        appointment_start_time: draft.appointment_start_time,
        appointment_end_time: draft.appointment_end_time,
        appointments_per_hour: appointmentsPerHour,
      };
      await api.updateSuperdashboardOrgSettings(orgId, settingsPayload);
      if (draft.workspace_mode !== detail.summary.workspace_mode) {
        await api.updateSuperdashboardOrgWorkspaceMode(orgId, draft.workspace_mode);
      }
      const refreshed = await api.getSuperdashboardOrgDetail(orgId);
      setDetail(refreshed);
      setDraft(draftFromDetail(refreshed));
      setMessage("Organization settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save organization settings.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveUserLimit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const usersAllowed = Number(draft.users_allowed);
    if (!Number.isInteger(usersAllowed) || usersAllowed < detail.summary.user_count || usersAllowed > 500) {
      setMessage(`User limit must be between ${detail.summary.user_count} and 500.`);
      return;
    }
    if (usersAllowed === detail.summary.users_allowed) {
      setMessage("User limit is already up to date.");
      return;
    }
    setIsSaving(true);
    setMessage("");
    try {
      await api.updateSuperdashboardOrgUsersAllowed(orgId, usersAllowed);
      const refreshed = await api.getSuperdashboardOrgDetail(orgId);
      setDetail(refreshed);
      setDraft(draftFromDetail(refreshed));
      setMessage(`User limit updated to ${usersAllowed}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update user limit.");
    } finally {
      setIsSaving(false);
    }
  }

  async function updateUserRole(user: SuperuserOrgUser, role: UserRole) {
    if (!detail || user.role === role) return;
    setUpdatingUserId(user.id);
    setMessage("");
    try {
      const updated = await api.updateSuperdashboardUserRole(user.id, { role });
      setDetail({
        ...detail,
        users: detail.users.map((row) => (row.id === updated.id ? updated : row)),
      });
      setMessage(`${user.identifier} is now ${role}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update user role.");
    } finally {
      setUpdatingUserId("");
    }
  }

  async function deleteUser(user: SuperuserOrgUser) {
    if (!detail || !window.confirm(`Delete ${user.identifier}? This cannot be undone.`)) return;
    setDeletingUserId(user.id);
    setMessage("");
    try {
      await api.deleteSuperuserUser(user.id);
      setDetail({
        ...detail,
        users: detail.users.filter((row) => row.id !== user.id),
        summary: { ...detail.summary, user_count: Math.max(detail.summary.user_count - 1, 0) },
      });
      setMessage(`${user.identifier} was deleted.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete user.");
    } finally {
      setDeletingUserId("");
    }
  }

  async function deleteOrg() {
    if (!detail || deleteConfirm !== detail.summary.clinic_name) return;
    if (!window.confirm(`Delete ${detail.summary.clinic_name} and all of its data? This cannot be undone.`)) return;
    setIsSaving(true);
    setMessage("");
    try {
      await api.deleteSuperuserOrg(orgId);
      router.replace("/superdashboard");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete organization.");
      setIsSaving(false);
    }
  }

  async function logoutSuperdashboard() {
    try {
      await api.logoutSuperdashboard();
    } finally {
      window.location.href = "/superdashboard/login";
    }
  }

  if (isLoading && !detail) {
    return (
      <main className="min-h-screen bg-slate-50 p-8 text-slate-950">
        <div className="rounded-[24px] border border-slate-200 bg-white p-8 text-lg font-black shadow-sm">Loading organization...</div>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="min-h-screen bg-slate-50 p-8 text-slate-950">
        <button onClick={() => router.push("/superdashboard")} className="mb-6 inline-flex items-center gap-2 font-black text-slate-600">
          <ArrowLeft className="h-5 w-5" />
          Back
        </button>
        <div className="rounded-[24px] border border-rose-200 bg-white p-8 font-bold text-rose-700 shadow-sm">{message || "Organization not found."}</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-20 text-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50/95 px-8 py-5 backdrop-blur">
        <div className="flex items-start justify-between gap-6">
          <div>
            <button onClick={() => router.push("/superdashboard")} className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-500 transition hover:text-slate-950">
              <ArrowLeft className="h-4 w-4" />
              Superdashboard
            </button>
            <h1 className="mt-4 text-4xl font-black tracking-[-0.05em]">{detail.summary.clinic_name}</h1>
            <p className="mt-2 text-sm font-bold text-slate-500">
              {detail.summary.user_count} users · {detail.summary.workspace_mode} workspace · last activity {formatDateTime(detail.summary.last_activity_at)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to ClinicOS
            </Link>
            <button onClick={load} className="rounded-2xl border border-slate-200 bg-white p-3 text-slate-500 transition hover:text-slate-950" title="Refresh">
              <RefreshCw className="h-5 w-5" />
            </button>
            <button
              onClick={() => void logoutSuperdashboard()}
              className="inline-flex items-center gap-2 text-sm font-black text-slate-500 transition hover:text-slate-950"
            >
              <LogOut className="h-4 w-4" />
              Sign out of Ops
            </button>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {(["overview", "users", "settings", "activity", "errors", "danger"] as Tab[]).map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={`rounded-2xl px-5 py-3 text-sm font-black capitalize transition ${
                tab === item ? "bg-blue-500 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:text-slate-950"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </header>

      <section className="space-y-8 px-8 py-8">
        {message ? (
          <div className="rounded-2xl border border-blue-100 bg-white px-5 py-4 text-sm font-bold text-slate-600 shadow-sm">
            {message}
          </div>
        ) : null}

        {tab === "overview" ? (
          <div className="space-y-8">
            <div className="grid gap-5 xl:grid-cols-5">
              <Stat label="Patients" value={formatCompact(detail.summary.patient_count)} />
              <Stat label="Notes" value={formatCompact(detail.summary.note_count)} />
              <Stat label="Invoices" value={formatCompact(detail.summary.invoice_count)} />
              <Stat label="AI tokens" value={formatCompact(detail.usage.total_tokens || detail.summary.total_tokens)} />
              <Stat label="Storage" value={formatBytes(detail.summary.media_storage_bytes)} />
            </div>
            <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
              <div className="rounded-[24px] border border-slate-200 bg-white p-7 shadow-sm">
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">AI usage by feature</h2>
                <div className="mt-6 space-y-4">
                  {Object.entries(detail.usage.by_feature).length ? Object.entries(detail.usage.by_feature).map(([feature, tokens]) => (
                    <div key={feature} className="flex items-center justify-between border-b border-slate-100 pb-4 last:border-0">
                      <span className="font-bold text-slate-700">{feature}</span>
                      <span className="font-black text-slate-950">{formatCompact(tokens)}</span>
                    </div>
                  )) : <p className="font-bold text-slate-500">No AI usage recorded.</p>}
                </div>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-white p-7 shadow-sm">
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">Organization</h2>
                <dl className="mt-6 space-y-4 text-sm">
                  <div className="flex justify-between gap-4"><dt className="font-bold text-slate-500">Org ID</dt><dd className="text-right font-black">{detail.summary.org_id}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="font-bold text-slate-500">Created</dt><dd className="font-black">{formatDateTime(detail.summary.created_at)}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="font-bold text-slate-500">Recent errors</dt><dd className="font-black">{detail.summary.recent_error_count}</dd></div>
                </dl>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "users" ? (
          <div className="rounded-[24px] border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-5 border-b border-slate-200 px-7 py-5">
              <div className="flex items-center gap-4">
                <UserCog className="h-5 w-5 text-blue-500" />
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">Users and roles</h2>
              </div>
              <form onSubmit={saveUserLimit} className="flex items-end gap-3">
                <label className="space-y-2">
                  <span className="block text-xs font-black uppercase tracking-[0.16em] text-slate-500">User limit</span>
                  <input
                    type="number"
                    min={detail.summary.user_count}
                    max={500}
                    value={draft.users_allowed}
                    onChange={(event) => setDraftField("users_allowed", event.target.value)}
                    className="h-12 w-28 rounded-2xl border border-slate-200 bg-slate-50 px-4 font-black outline-none focus:border-blue-500"
                  />
                </label>
                <button disabled={isSaving} className="inline-flex h-12 items-center gap-2 rounded-2xl bg-blue-500 px-5 font-black text-white transition hover:bg-blue-600 disabled:opacity-60">
                  <Save className="h-4 w-4" />
                  Save
                </button>
              </form>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left">
                <thead className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                  <tr>
                    <th className="px-7 py-4">User</th>
                    <th className="px-7 py-4">Role</th>
                    <th className="px-7 py-4">Created</th>
                    <th className="px-7 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.users.map((user) => {
                    const isLastAdmin = user.role === "admin" && adminCount <= 1;
                    return (
                      <tr key={user.id} className="border-t border-slate-100">
                        <td className="px-7 py-5">
                          <p className="font-black text-slate-950">{user.name || user.identifier}</p>
                          <p className="mt-1 text-sm font-bold text-slate-500">{user.identifier}</p>
                        </td>
                        <td className="px-7 py-5">
                          <select
                            value={user.role}
                            disabled={updatingUserId === user.id || isLastAdmin}
                            onChange={(event) => void updateUserRole(user, event.target.value as UserRole)}
                            className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 font-black capitalize outline-none transition focus:border-blue-500 disabled:opacity-60"
                          >
                            <option value="admin">Admin</option>
                            <option value="staff">Staff</option>
                          </select>
                        </td>
                        <td className="px-7 py-5 font-bold text-slate-600">{formatDateTime(user.created_at)}</td>
                        <td className="px-7 py-5 text-right">
                          <button
                            onClick={() => void deleteUser(user)}
                            disabled={deletingUserId === user.id}
                            className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-600 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Delete user"
                          >
                            <Trash2 className="h-5 w-5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === "settings" ? (
          <form onSubmit={saveSettings} className="rounded-[24px] border border-slate-200 bg-white p-7 shadow-sm">
            <div className="grid gap-5 xl:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Clinic name</span>
                <input value={draft.clinic_name} onChange={(event) => setDraftField("clinic_name", event.target.value)} className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold outline-none focus:border-blue-500" />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Phone</span>
                <input value={draft.clinic_phone} onChange={(event) => setDraftField("clinic_phone", event.target.value)} className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold outline-none focus:border-blue-500" />
              </label>
              <label className="space-y-2 xl:col-span-2">
                <span className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Address</span>
                <input value={draft.clinic_address} onChange={(event) => setDraftField("clinic_address", event.target.value)} className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold outline-none focus:border-blue-500" />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Specialty</span>
                <select value={draft.clinic_specialty} onChange={(event) => setDraftField("clinic_specialty", event.target.value as ClinicSpecialty | "")} className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold outline-none focus:border-blue-500">
                  <option value="">None</option>
                  {CLINIC_SPECIALTY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Timezone</span>
                <input value={draft.timezone} onChange={(event) => setDraftField("timezone", event.target.value)} className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold outline-none focus:border-blue-500" />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Doctor name</span>
                <input value={draft.doctor_name} onChange={(event) => setDraftField("doctor_name", event.target.value)} className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold outline-none focus:border-blue-500" />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Workspace</span>
                <select value={draft.workspace_mode} onChange={(event) => setDraftField("workspace_mode", event.target.value as WorkspaceMode)} className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold capitalize outline-none focus:border-blue-500">
                  <option value="solo">Solo</option>
                  <option value="team">Team</option>
                  <option value="multi_doctor">Multi-Doctor</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Open</span>
                <input type="time" value={draft.appointment_start_time} onChange={(event) => setDraftField("appointment_start_time", event.target.value)} className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold outline-none focus:border-blue-500" />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Close</span>
                <input type="time" value={draft.appointment_end_time} onChange={(event) => setDraftField("appointment_end_time", event.target.value)} className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold outline-none focus:border-blue-500" />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Appointments per hour</span>
                <input type="number" min={1} max={12} value={draft.appointments_per_hour} onChange={(event) => setDraftField("appointments_per_hour", event.target.value)} className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold outline-none focus:border-blue-500" />
              </label>
            </div>
            <button disabled={isSaving} className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-blue-500 px-6 py-4 font-black text-white transition hover:bg-blue-600 disabled:opacity-60">
              <Save className="h-5 w-5" />
              Save settings
            </button>
          </form>
        ) : null}

        {tab === "activity" ? (
          <div className="rounded-[24px] border border-slate-200 bg-white p-7 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">Recent audit events</h2>
            <div className="mt-6 space-y-4">
              {detail.recent_audit_events.length ? detail.recent_audit_events.map((event) => (
                <div key={event.id} className="border-b border-slate-100 pb-4 last:border-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-black text-slate-950">{event.action}</p>
                    <p className="text-sm font-bold text-slate-500">{formatDateTime(event.created_at)}</p>
                  </div>
                  <p className="mt-2 font-bold text-slate-600">{event.summary}</p>
                  <p className="mt-1 text-sm font-bold text-slate-400">{event.actor_name || "System"}</p>
                </div>
              )) : <p className="font-bold text-slate-500">No audit events yet.</p>}
            </div>
          </div>
        ) : null}

        {tab === "errors" ? (
          <div className="rounded-[24px] border border-slate-200 bg-white p-7 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">Recent platform errors</h2>
            <div className="mt-6 space-y-4">
              {detail.recent_errors.length ? detail.recent_errors.map((error) => {
                const contextText = formatErrorContext(error.context);
                return (
                <div key={error.id} className="border-b border-slate-100 pb-4 last:border-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="break-all font-black text-slate-950">{error.method} {error.path}</p>
                    <p className="text-sm font-bold text-slate-500">{formatDateTime(error.created_at)}</p>
                  </div>
                  <p className="mt-2 font-bold text-rose-600">{error.error_type} {error.status_code ? `· ${error.status_code}` : ""}</p>
                  <p className="mt-1 break-words font-bold text-slate-600">{error.message}</p>
                  <details className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <summary className="cursor-pointer text-sm font-black text-slate-700">Trace</summary>
                    <div className="mt-3 space-y-3">
                      {error.details ? (
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs font-semibold text-slate-700">{error.details}</pre>
                      ) : null}
                      {contextText ? (
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs font-semibold text-slate-700">{contextText}</pre>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => copyErrorTrace(error)}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
                      >
                        <Copy className="h-4 w-4" />
                        Copy trace
                      </button>
                    </div>
                  </details>
                </div>
              );
              }) : <p className="font-bold text-slate-500">No recent errors for this organization.</p>}
            </div>
          </div>
        ) : null}

        {tab === "danger" ? (
          <div className="rounded-[24px] border border-rose-200 bg-white p-7 shadow-sm">
            <div className="flex items-center gap-3 text-rose-700">
              <XCircle className="h-6 w-6" />
              <h2 className="text-xl font-black tracking-[-0.03em]">Delete organization</h2>
            </div>
            <p className="mt-4 max-w-3xl font-bold text-slate-600">
              This removes the organization and its related data. Type the clinic name to unlock the delete action.
            </p>
            <input
              value={deleteConfirm}
              onChange={(event) => setDeleteConfirm(event.target.value)}
              placeholder={detail.summary.clinic_name}
              className="mt-6 h-14 w-full max-w-xl rounded-2xl border border-rose-200 bg-rose-50 px-4 font-bold outline-none focus:border-rose-500"
            />
            <button
              onClick={deleteOrg}
              disabled={isSaving || deleteConfirm !== detail.summary.clinic_name}
              className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-rose-600 px-6 py-4 font-black text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-5 w-5" />
              Delete organization
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
