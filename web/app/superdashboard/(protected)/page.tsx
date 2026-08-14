"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Copy, ExternalLink, LogOut, Mail, RefreshCw, Settings2, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { CLINIC_SPECIALTY_OPTIONS } from "@/lib/clinic-specialty";
import {
  CustomerOnboarding,
  PlatformError,
  PlatformEmailSettings,
  SuperdashboardDashboard,
  SuperdashboardOnboarding,
  SuperdashboardTrends,
  SuperdashboardUsageByOrg,
  SuperuserOrgSummary,
  WorkspaceMode,
} from "@/lib/types";

type Tab = "dashboard" | "onboard" | "errors" | "settings";

const emptyDashboard: SuperdashboardDashboard = {
  org_count: 0,
  active_org_count: 0,
  user_count: 0,
  patient_count: 0,
  note_count: 0,
  invoice_count: 0,
  follow_up_count: 0,
  ai_tokens_7d: 0,
  ai_requests_7d: 0,
  media_storage_bytes: 0,
  error_count_7d: 0,
  error_rate_7d: 0,
  top_error_context: "",
};

const emptyTrends: SuperdashboardTrends = {
  requests: [],
  tokens: [],
  storage: [],
  errors: [],
};

const emptyUsage: SuperdashboardUsageByOrg = {
  ai_usage: [],
  media_storage: [],
};

const emptyOnboarding: SuperdashboardOnboarding = {
  summary: {
    pending_count: 0,
    claimed_count: 0,
    disabled_count: 0,
    default_users_allowed: 2,
  },
  customers: [],
};

function formatCompact(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value || 0);
}

function formatBytes(value: number) {
  if (!value) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
}

function sparkline(points: { value: number }[]) {
  if (!points.length) {
    return "0,28 100,28";
  }
  const values = points.map((point) => Number(point.value) || 0);
  const max = Math.max(...values, 1);
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 100 : (index / (values.length - 1)) * 100;
      const y = 32 - (value / max) * 28;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function statusClass(status: CustomerOnboarding["status"]) {
  if (status === "claimed") {
    return "bg-emerald-50 text-emerald-700";
  }
  if (status === "disabled") {
    return "bg-slate-100 text-slate-600";
  }
  return "bg-amber-50 text-amber-700";
}

function specialtyLabel(value: SuperuserOrgSummary["clinic_specialty"]) {
  if (!value) {
    return "—";
  }
  return CLINIC_SPECIALTY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function StatCard({
  label,
  value,
  caption,
  color,
  points,
}: {
  label: string;
  value: string;
  caption: string;
  color: string;
  points: { value: number }[];
}) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className="mt-5 text-4xl font-black tracking-[-0.05em] text-slate-950">{value}</p>
          <p className="mt-2 text-sm font-semibold text-slate-500">{caption}</p>
        </div>
        <div className={`rounded-2xl p-3 ${color}`}>
          <Zap className="h-5 w-5" />
        </div>
      </div>
      <svg className="mt-7 h-10 w-full overflow-visible" viewBox="0 0 100 36" preserveAspectRatio="none">
        <polyline
          fill="none"
          points={sparkline(points)}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.6"
          className={color.includes("rose") || color.includes("amber") ? "text-amber-500" : color.includes("violet") ? "text-violet-500" : color.includes("emerald") ? "text-emerald-500" : "text-blue-500"}
        />
      </svg>
    </div>
  );
}

function Header({
  tab,
  setTab,
  onRefresh,
  onLogout,
}: {
  tab: Tab;
  setTab: (tab: Tab) => void;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50/95 backdrop-blur">
      <div className="flex h-24 items-center justify-between px-8">
        <div className="flex items-center gap-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-700">
            <Zap className="h-5 w-5" />
          </div>
          <p className="text-xl font-black tracking-[-0.04em] text-slate-950">ClinicOS Ops</p>
        </div>
        <div className="absolute left-1/2 flex -translate-x-1/2 rounded-[22px] border border-slate-200 bg-slate-100 p-2 shadow-sm">
          {(["dashboard", "onboard", "errors", "settings"] as Tab[]).map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={`min-w-32 rounded-2xl px-5 py-3 text-lg font-black capitalize transition ${
                tab === item ? "bg-white text-slate-950 shadow-sm ring-4 ring-blue-600/90" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to ClinicOS
          </Link>
          <button
            onClick={onRefresh}
            className="rounded-2xl border border-slate-200 bg-white p-3 text-slate-500 transition hover:text-slate-950"
            title="Refresh"
          >
            <RefreshCw className="h-5 w-5" />
          </button>
          <button
            onClick={onLogout}
            className="inline-flex items-center gap-2 text-lg font-black text-slate-500 transition hover:text-slate-950"
          >
            <LogOut className="h-5 w-5" />
            Sign out of Ops
          </button>
        </div>
      </div>
    </header>
  );
}

export default function SuperdashboardPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [trends, setTrends] = useState(emptyTrends);
  const [usage, setUsage] = useState(emptyUsage);
  const [orgs, setOrgs] = useState<SuperuserOrgSummary[]>([]);
  const [onboarding, setOnboarding] = useState(emptyOnboarding);
  const [errors, setErrors] = useState<PlatformError[]>([]);
  const [platformEmail, setPlatformEmail] = useState<PlatformEmailSettings | null>(null);
  const [platformSenderName, setPlatformSenderName] = useState("ClinicOS");
  const [platformSenderEmail, setPlatformSenderEmail] = useState("");
  const [platformAppPassword, setPlatformAppPassword] = useState("");
  const [platformEmailEnabled, setPlatformEmailEnabled] = useState(false);
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [isTestingEmail, setIsTestingEmail] = useState(false);
  const [clinicName, setClinicName] = useState("");
  const [phone, setPhone] = useState("");
  const [usersAllowed, setUsersAllowed] = useState("2");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode | "">("");
  const [lastCreatedCid, setLastCreatedCid] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [updatingWorkspaceId, setUpdatingWorkspaceId] = useState("");
  const [updatingUserLimitId, setUpdatingUserLimitId] = useState("");

  const totalRemaining = useMemo(
    () => Math.max(onboarding.summary.pending_count + onboarding.summary.claimed_count + onboarding.summary.disabled_count, 1),
    [onboarding.summary],
  );

  async function load() {
    setIsLoading(true);
    setMessage("");
    try {
      const [dashboardData, trendsData, usageData, orgData, onboardingData, errorData, emailData] = await Promise.all([
        api.getSuperdashboardDashboard(),
        api.getSuperdashboardTrends(),
        api.getSuperdashboardUsageByOrg(),
        api.listSuperdashboardOrgs(),
        api.getSuperdashboardOnboarding(),
        api.listPlatformErrors(100),
        api.getPlatformEmailSettings(),
      ]);
      setDashboard(dashboardData);
      setTrends(trendsData);
      setUsage(usageData);
      setOrgs(orgData);
      setOnboarding(onboardingData);
      setErrors(errorData);
      setPlatformEmail(emailData);
      setPlatformSenderName(emailData.sender_name);
      setPlatformSenderEmail(emailData.sender_email);
      setPlatformEmailEnabled(emailData.is_enabled);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load Superdashboard.");
    } finally {
      setIsLoading(false);
    }
  }

  async function logoutSuperdashboard() {
    try {
      await api.logoutSuperdashboard();
    } finally {
      window.location.href = "/superdashboard/login";
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createCid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceMode) {
      setMessage("Choose a Solo or Team workspace before creating the CID.");
      return;
    }
    setIsCreating(true);
    setMessage("");
    setLastCreatedCid("");
    try {
      const created = await api.createSuperdashboardCustomer({
        customer_name: clinicName.trim(),
        phone: phone.trim(),
        users_allowed: Number(usersAllowed || 2),
        workspace_mode: workspaceMode,
      });
      setLastCreatedCid(created.customer_id);
      setClinicName("");
      setPhone("");
      setUsersAllowed("2");
      setWorkspaceMode("");
      const updated = await api.getSuperdashboardOnboarding();
      setOnboarding(updated);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create CID.");
    } finally {
      setIsCreating(false);
    }
  }

  async function updateUsersAllowed(row: CustomerOnboarding, value: string) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
      setMessage("User limit must be a whole number between 1 and 500.");
      return;
    }
    setUpdatingUserLimitId(row.id);
    setMessage("");
    try {
      const updated = await api.updateSuperdashboardCustomer(row.id, { users_allowed: parsed });
      setOnboarding((current) => ({
        ...current,
        customers: current.customers.map((customer) => (customer.id === updated.id ? { ...customer, ...updated } : customer)),
      }));
      if (updated.claimed_org_id) {
        setOrgs((current) => current.map((org) => (
          org.org_id === updated.claimed_org_id ? { ...org, users_allowed: updated.users_allowed } : org
        )));
      }
      setMessage(`${row.customer_name} can now have ${updated.users_allowed} user${updated.users_allowed === 1 ? "" : "s"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update user limit.");
    } finally {
      setUpdatingUserLimitId("");
    }
  }

  async function updateOnboardingWorkspaceMode(row: CustomerOnboarding, mode: WorkspaceMode) {
    if (row.workspace_mode === mode) {
      return;
    }
    if (row.status === "claimed" && !window.confirm(
      `Switch ${row.claimed_org_name || row.customer_name} from ${row.workspace_mode} to ${mode}? This changes the queue layout for every clinic user on their next refresh.`,
    )) {
      return;
    }
    setUpdatingWorkspaceId(row.id);
    setMessage("");
    try {
      const updated = await api.updateSuperdashboardCustomer(row.id, { workspace_mode: mode });
      setOnboarding((current) => ({
        ...current,
        customers: current.customers.map((customer) => (
          customer.id === updated.id ? { ...customer, ...updated } : customer
        )),
      }));
      if (updated.claimed_org_id) {
        setOrgs((current) => current.map((org) => (
          org.org_id === updated.claimed_org_id ? { ...org, workspace_mode: mode } : org
        )));
      }
      setMessage(`${row.customer_name} now uses the ${mode === "solo" ? "Solo" : mode === "multi_doctor" ? "Multi-Doctor" : "Team"} workspace.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update workspace mode.");
    } finally {
      setUpdatingWorkspaceId("");
    }
  }

  async function updateOrgWorkspaceMode(org: SuperuserOrgSummary, mode: WorkspaceMode) {
    if (org.workspace_mode === mode || !window.confirm(
      `Switch ${org.clinic_name} from ${org.workspace_mode} to ${mode}? This changes the queue layout for every clinic user on their next refresh.`,
    )) {
      return;
    }
    setUpdatingWorkspaceId(org.org_id);
    setMessage("");
    try {
      const updated = await api.updateSuperdashboardOrgWorkspaceMode(org.org_id, mode);
      setOrgs((current) => current.map((row) => (
        row.org_id === org.org_id ? { ...row, workspace_mode: updated.workspace_mode } : row
      )));
      setOnboarding((current) => ({
        ...current,
        customers: current.customers.map((customer) => (
          customer.claimed_org_id === org.org_id
            ? { ...customer, workspace_mode: updated.workspace_mode }
            : customer
        )),
      }));
      setMessage(`${org.clinic_name} now uses the ${mode === "solo" ? "Solo" : mode === "multi_doctor" ? "Multi-Doctor" : "Team"} workspace.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update workspace mode.");
    } finally {
      setUpdatingWorkspaceId("");
    }
  }

  function copyText(value: string) {
    navigator.clipboard?.writeText(value);
    setMessage(`Copied ${value}`);
  }

  async function testPlatformEmail() {
    setIsTestingEmail(true);
    setMessage("");
    try {
      const result = await api.testPlatformEmailSettings({
        sender_email: platformSenderEmail.trim(),
        sender_email_app_password: platformAppPassword.trim() || undefined,
      });
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gmail authentication failed.");
    } finally {
      setIsTestingEmail(false);
    }
  }

  async function savePlatformEmail(event: FormEvent) {
    event.preventDefault();
    setIsSavingEmail(true);
    setMessage("");
    try {
      const saved = await api.updatePlatformEmailSettings({
        sender_name: platformSenderName.trim(),
        sender_email: platformSenderEmail.trim(),
        sender_email_app_password: platformAppPassword.trim() || undefined,
        is_enabled: platformEmailEnabled,
      });
      setPlatformEmail(saved);
      setPlatformAppPassword("");
      setMessage(saved.is_enabled ? "ClinicOS email delivery is enabled." : "ClinicOS email settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save email settings.");
    } finally {
      setIsSavingEmail(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-20 text-slate-950">
      <Header tab={tab} setTab={setTab} onRefresh={load} onLogout={() => void logoutSuperdashboard()} />
      <section className="px-8 py-12">
        {message ? (
          <div className="mb-8 rounded-2xl border border-blue-100 bg-white px-5 py-4 text-sm font-bold text-slate-600 shadow-sm">
            {message}
          </div>
        ) : null}

        {tab === "dashboard" ? (
          <div className="space-y-10">
            <div className="grid gap-5 xl:grid-cols-4">
              <StatCard label="Requests (7d)" value={formatCompact(dashboard.ai_requests_7d)} caption={`${dashboard.active_org_count} active orgs`} color="bg-blue-50 text-blue-600" points={trends.requests} />
              <StatCard label="Tokens (7d)" value={formatCompact(dashboard.ai_tokens_7d)} caption={`${formatCompact(dashboard.note_count)} notes all time`} color="bg-violet-50 text-violet-600" points={trends.tokens} />
              <StatCard label="Storage" value={formatBytes(dashboard.media_storage_bytes)} caption={`${formatCompact(dashboard.patient_count)} patients`} color="bg-emerald-50 text-emerald-600" points={trends.storage} />
              <StatCard label="Error rate" value={`${dashboard.error_rate_7d}%`} caption={dashboard.top_error_context || "No current errors"} color="bg-amber-50 text-amber-600" points={trends.errors} />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              {[
                ["AI usage by org", usage.ai_usage.map((row) => [row.clinic_name, formatCompact(row.total_tokens)])],
                ["Media storage by org", usage.media_storage.map((row) => [row.clinic_name, formatBytes(row.media_storage_bytes)])],
              ].map(([title, rows]) => (
                <div key={String(title)} className="rounded-[24px] border border-slate-200 bg-white p-7 shadow-sm">
                  <h2 className="text-xl font-black tracking-[-0.04em]">{title}</h2>
                  <div className="mt-6 space-y-4">
                    {(rows as string[][]).slice(0, 6).map(([name, value]) => (
                      <div key={name} className="flex items-center justify-between border-b border-slate-100 pb-4 last:border-0">
                        <span className="font-bold text-slate-700">{name}</span>
                        <span className="font-black text-slate-950">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-4 border-b border-slate-200 px-7 py-5">
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">Organizations</h2>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1320px] text-left">
                  <thead className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    <tr>
                      <th className="px-7 py-4">Org</th>
                      <th className="px-7 py-4">Users</th>
                      <th className="px-7 py-4">Specialty</th>
                      <th className="px-7 py-4">Workspace</th>
                      <th className="px-7 py-4">Patients</th>
                      <th className="px-7 py-4">Notes</th>
                      <th className="px-7 py-4">Invoices</th>
                      <th className="px-7 py-4">Tokens</th>
                      <th className="px-7 py-4">Storage</th>
                      <th className="px-7 py-4">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orgs.map((org) => (
                      <tr
                        key={org.org_id}
                        onClick={() => router.push(`/superdashboard/orgs/${org.org_id}`)}
                        className="cursor-pointer border-t border-slate-100 text-base transition hover:bg-blue-50/50"
                      >
                        <td className="px-7 py-5 font-black">
                          <span className="inline-flex items-center gap-2">
                            {org.clinic_name}
                            <ArrowRight className="h-4 w-4 text-slate-400" />
                          </span>
                        </td>
                        <td className="px-7 py-5">{org.user_count}</td>
                        <td className="px-7 py-5 font-bold text-slate-600">{specialtyLabel(org.clinic_specialty)}</td>
                        <td className="px-7 py-5">
                          <select
                            value={org.workspace_mode}
                            disabled={updatingWorkspaceId === org.org_id}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => void updateOrgWorkspaceMode(org, event.target.value as WorkspaceMode)}
                            aria-label={`Workspace mode for ${org.clinic_name}`}
                            className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 font-black capitalize outline-none transition focus:border-blue-500 disabled:opacity-60"
                          >
                            <option value="solo">Solo</option>
                            <option value="team">Team</option>
                            <option value="multi_doctor">Multi-Doctor</option>
                          </select>
                        </td>
                        <td className="px-7 py-5">{org.patient_count}</td>
                        <td className="px-7 py-5">{org.note_count}</td>
                        <td className="px-7 py-5">{org.invoice_count}</td>
                        <td className="px-7 py-5">{formatCompact(org.total_tokens)}</td>
                        <td className="px-7 py-5">{formatBytes(org.media_storage_bytes)}</td>
                        <td className="px-7 py-5">{org.recent_error_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "onboard" ? (
          <div className="space-y-10">
            <div className="grid gap-6 lg:grid-cols-[1fr_580px]">
              <div className="rounded-[24px] border border-slate-200 bg-white p-7 shadow-sm">
                <form onSubmit={createCid} className="space-y-6">
                  <div className="grid items-end gap-6 xl:grid-cols-[1.5fr_1fr_160px]">
                    <label>
                      <span className="mb-3 block text-lg font-black text-slate-700">Clinic name</span>
                      <input value={clinicName} onChange={(event) => setClinicName(event.target.value)} required placeholder="Bluebird Clinic" className="h-20 w-full rounded-2xl border border-slate-200 bg-slate-50 px-7 text-2xl font-black outline-none transition focus:border-blue-500" />
                    </label>
                    <label>
                      <span className="mb-3 block text-lg font-black text-slate-700">Phone</span>
                      <input value={phone} onChange={(event) => setPhone(event.target.value)} required placeholder="+91 98765 43210" className="h-20 w-full rounded-2xl border border-slate-200 bg-slate-50 px-7 text-2xl font-black outline-none transition focus:border-blue-500" />
                    </label>
                    <label>
                      <span className="mb-3 block text-lg font-black text-slate-700">Users</span>
                      <input value={usersAllowed} onChange={(event) => setUsersAllowed(event.target.value)} required type="number" min={1} className="h-20 w-full rounded-2xl border border-slate-200 bg-slate-50 px-7 text-2xl font-black outline-none transition focus:border-blue-500" />
                    </label>
                  </div>
                  <fieldset>
                    <legend className="mb-3 text-lg font-black text-slate-700">Workspace mode</legend>
                    <div className="grid gap-4 xl:grid-cols-[1fr_1fr_190px]">
                      {([
                        ["solo", "Solo workspace", "One combined Today queue."],
                        ["team", "Team workflow", "Waiting, Consultation, and Billing."],
                        ["multi_doctor", "Multi-Doctor", "Provider queues with shared billing."],
                      ] as const).map(([value, label, description]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setWorkspaceMode(value)}
                          aria-pressed={workspaceMode === value}
                          className={`rounded-2xl border px-5 py-4 text-left transition ${
                            workspaceMode === value
                              ? "border-blue-500 bg-blue-50 ring-4 ring-blue-100"
                              : "border-slate-200 bg-slate-50 hover:border-blue-300"
                          }`}
                        >
                          <span className="block text-lg font-black text-slate-900">{label}</span>
                          <span className="mt-1 block text-sm font-semibold text-slate-500">{description}</span>
                        </button>
                      ))}
                      <button disabled={isCreating || !workspaceMode} className="min-h-20 rounded-2xl bg-blue-500 px-8 text-2xl font-black text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50">
                        Create CID <ArrowRight className="ml-2 inline h-6 w-6" />
                      </button>
                    </div>
                  </fieldset>
                </form>
                {lastCreatedCid ? (
                  <button onClick={() => copyText(lastCreatedCid)} className="mt-5 inline-flex items-center gap-2 rounded-full bg-blue-50 px-5 py-3 text-lg font-black text-blue-700">
                    {lastCreatedCid} <Copy className="h-5 w-5" />
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-[22px] border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Pending</p>
                  <p className="mt-3 text-4xl font-black">{onboarding.summary.pending_count}</p>
                </div>
                <div className="rounded-[22px] border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Claimed</p>
                  <p className="mt-3 text-4xl font-black">{onboarding.summary.claimed_count}</p>
                </div>
                <div className="rounded-[22px] border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Default users</p>
                  <p className="mt-3 text-4xl font-black">{onboarding.summary.default_users_allowed}</p>
                </div>
                <div className="col-span-3 rounded-[22px] border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex h-4 overflow-hidden rounded-full bg-slate-100">
                    <div className="bg-amber-400" style={{ width: `${(onboarding.summary.pending_count / totalRemaining) * 100}%` }} />
                    <div className="bg-emerald-400" style={{ width: `${(onboarding.summary.claimed_count / totalRemaining) * 100}%` }} />
                    <div className="bg-slate-300" style={{ width: `${(onboarding.summary.disabled_count / totalRemaining) * 100}%` }} />
                  </div>
                  <p className="mt-4 text-sm font-bold text-slate-500">Signup IDs split by pending, claimed, and disabled status.</p>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-4 border-b border-slate-200 px-7 py-5">
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">Onboarded customers</h2>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1280px] text-left">
                  <thead className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    <tr>
                      <th className="px-7 py-4">Customer</th>
                      <th className="px-7 py-4">CID</th>
                      <th className="px-7 py-4">Phone</th>
                      <th className="px-7 py-4">Status</th>
                      <th className="px-7 py-4">Users allowed</th>
                      <th className="px-7 py-4">Users used</th>
                      <th className="px-7 py-4">Workspace</th>
                      <th className="px-7 py-4">Created</th>
                      <th className="px-7 py-4">Claimed by org</th>
                      <th className="px-7 py-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {onboarding.customers.map((customer) => (
                      <tr key={customer.id} className="border-t border-slate-100 text-base">
                        <td className="px-7 py-5 font-black">{customer.customer_name}</td>
                        <td className="px-7 py-5">
                          <button onClick={() => copyText(customer.customer_id)} className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-2 font-black text-blue-700">
                            {customer.customer_id} <Copy className="h-4 w-4" />
                          </button>
                        </td>
                        <td className="px-7 py-5">{customer.phone}</td>
                        <td className="px-7 py-5">
                          <span className={`rounded-full px-4 py-2 text-sm font-black capitalize ${statusClass(customer.status)}`}>{customer.status}</span>
                        </td>
                        <td className="px-7 py-5">
                          <input
                            key={customer.users_allowed}
                            defaultValue={customer.users_allowed}
                            type="number"
                            min={Math.max(customer.users_used, 1)}
                            max={500}
                            step={1}
                            disabled={updatingUserLimitId === customer.id || customer.status === "disabled"}
                            onBlur={(event) => void updateUsersAllowed(customer, event.target.value)}
                            className="h-12 w-28 rounded-xl border border-slate-200 bg-slate-50 px-4 text-center font-black outline-none focus:border-blue-500 disabled:opacity-60"
                          />
                        </td>
                        <td className="px-7 py-5">{customer.users_used} / {customer.users_allowed}</td>
                        <td className="px-7 py-5">
                          <select
                            value={customer.workspace_mode}
                            disabled={updatingWorkspaceId === customer.id || customer.status === "disabled"}
                            onChange={(event) => void updateOnboardingWorkspaceMode(customer, event.target.value as WorkspaceMode)}
                            aria-label={`Workspace mode for ${customer.customer_name}`}
                            className="h-12 rounded-xl border border-slate-200 bg-slate-50 px-4 font-black capitalize outline-none transition focus:border-blue-500 disabled:opacity-60"
                          >
                            <option value="solo">Solo</option>
                            <option value="team">Team</option>
                            <option value="multi_doctor">Multi-Doctor</option>
                          </select>
                        </td>
                        <td className="px-7 py-5">{formatDate(customer.created_at)}</td>
                        <td className="px-7 py-5">{customer.claimed_org_name || customer.claimed_org_id || "—"}</td>
                        <td className="px-7 py-5">
                          {customer.status === "pending" ? (
                            <button onClick={() => api.disableSuperdashboardCustomer(customer.id).then(() => load())} className="rounded-xl border border-slate-200 px-4 py-2 font-black text-slate-500">
                              Disable
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "errors" ? (
          <div className="rounded-[24px] border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-7 py-5">
              <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">Platform errors</h2>
              <span className="rounded-full bg-amber-50 px-4 py-2 text-sm font-black text-amber-700">{errors.length} rows</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left">
                <thead className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                  <tr>
                    <th className="px-7 py-4">Time</th>
                    <th className="px-7 py-4">Method</th>
                    <th className="px-7 py-4">Path</th>
                    <th className="px-7 py-4">Status</th>
                    <th className="px-7 py-4">Type</th>
                    <th className="px-7 py-4">Identifier</th>
                    <th className="px-7 py-4">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {(errors.length ? errors : []).map((error) => (
                    <tr key={error.id} className="border-t border-slate-100 text-base">
                      <td className="px-7 py-5 font-bold text-slate-600">{new Date(error.created_at).toLocaleString()}</td>
                      <td className="px-7 py-5 font-black">{error.method}</td>
                      <td className="px-7 py-5">
                        <span className="inline-flex items-center gap-2 font-bold text-blue-700">
                          {error.path} <ExternalLink className="h-4 w-4" />
                        </span>
                      </td>
                      <td className="px-7 py-5">
                        <span className="rounded-full bg-rose-50 px-3 py-1 font-black text-rose-700">{error.status_code || "—"}</span>
                      </td>
                      <td className="px-7 py-5 font-bold">{error.error_type}</td>
                      <td className="px-7 py-5 text-slate-600">{error.identifier || "—"}</td>
                      <td className="px-7 py-5 max-w-xl truncate text-slate-600">{error.message}</td>
                    </tr>
                  ))}
                  {!errors.length && !isLoading ? (
                    <tr>
                      <td colSpan={7} className="px-7 py-16 text-center text-lg font-black text-slate-400">
                        <AlertTriangle className="mx-auto mb-3 h-8 w-8" />
                        No platform errors recorded.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === "settings" ? (
          <div className="mx-auto max-w-4xl">
            <div className="mb-7 flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center border border-blue-100 bg-blue-50 text-blue-700">
                <Settings2 className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl font-black text-slate-950">Platform settings</h1>
                <p className="mt-1 text-sm font-semibold text-slate-500">Shared services used across clinics.</p>
              </div>
            </div>
            <form onSubmit={savePlatformEmail} className="border border-slate-200 bg-white shadow-sm">
              <div className="flex items-start justify-between gap-5 border-b border-slate-200 px-7 py-6">
                <div className="flex gap-4">
                  <div className="flex h-11 w-11 items-center justify-center bg-blue-50 text-blue-700">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black">Email delivery</h2>
                    <p className="mt-1 text-sm font-semibold text-slate-500">
                      Global Gmail used by clinics that select ClinicOS email.
                    </p>
                  </div>
                </div>
                <span className={`px-3 py-1.5 text-xs font-black ${
                  platformEmail?.is_enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                }`}>
                  {platformEmail?.is_enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="grid gap-5 px-7 py-7 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-slate-700">Sender name</span>
                  <input
                    value={platformSenderName}
                    onChange={(event) => setPlatformSenderName(event.target.value)}
                    required
                    className="h-12 w-full border border-slate-200 bg-slate-50 px-4 font-semibold outline-none focus:border-blue-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-slate-700">Gmail address</span>
                  <input
                    type="email"
                    value={platformSenderEmail}
                    onChange={(event) => setPlatformSenderEmail(event.target.value)}
                    required
                    placeholder="clinicos.sender@gmail.com"
                    className="h-12 w-full border border-slate-200 bg-slate-50 px-4 font-semibold outline-none focus:border-blue-500"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-2 block text-sm font-black text-slate-700">Gmail app password</span>
                  <input
                    type="password"
                    value={platformAppPassword}
                    onChange={(event) => setPlatformAppPassword(event.target.value)}
                    placeholder={platformEmail?.is_configured ? "Leave blank to keep the current password" : "Enter the 16-character app password"}
                    className="h-12 w-full border border-slate-200 bg-slate-50 px-4 font-semibold outline-none focus:border-blue-500"
                  />
                </label>
                <label className="flex items-center gap-3 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={platformEmailEnabled}
                    onChange={(event) => setPlatformEmailEnabled(event.target.checked)}
                    className="h-5 w-5"
                  />
                  <span className="text-sm font-black text-slate-700">Enable as the shared ClinicOS sender</span>
                </label>
                <p className="text-sm font-semibold leading-6 text-slate-500 sm:col-span-2">
                  This mailbox is treated as outbound only. ClinicOS does not receive or route replies.
                </p>
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-200 px-7 py-5">
                <button
                  type="button"
                  onClick={testPlatformEmail}
                  disabled={isTestingEmail || !platformSenderEmail.trim()}
                  className="h-11 border border-slate-300 bg-white px-5 font-black text-slate-700 disabled:opacity-50"
                >
                  {isTestingEmail ? "Testing..." : "Test connection"}
                </button>
                <button
                  disabled={isSavingEmail}
                  className="h-11 bg-blue-600 px-6 font-black text-white disabled:opacity-50"
                >
                  {isSavingEmail ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </section>
    </main>
  );
}
