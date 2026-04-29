"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { api } from "@/lib/api";
import { PlatformError, SuperuserOrgDetail, SuperuserOrgSummary } from "@/lib/types";

type SuperuserTab = "dashboard" | "orgs" | "errors";

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString();
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export default function SuperuserPage() {
  const { currentUser, isAuthReady, isRedirectingToLogin, handleLogout } = useClinicShell();
  const [activeTab, setActiveTab] = useState<SuperuserTab>("dashboard");
  const [orgs, setOrgs] = useState<SuperuserOrgSummary[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [selectedOrgDetail, setSelectedOrgDetail] = useState<SuperuserOrgDetail | null>(null);
  const [errors, setErrors] = useState<PlatformError[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const selectedOrgIdRef = useRef("");

  useEffect(() => {
    selectedOrgIdRef.current = selectedOrgId;
  }, [selectedOrgId]);

  const loadDashboard = useCallback(async (preferredOrgId?: string) => {
    setIsLoading(true);
    setError("");
    try {
      const [nextOrgs, nextErrors] = await Promise.all([
        api.listSuperuserOrgs(),
        api.listPlatformErrors(50),
      ]);
      setOrgs(nextOrgs);
      setErrors(nextErrors);

      const orgIdToLoad = preferredOrgId || selectedOrgIdRef.current || nextOrgs[0]?.org_id || "";
      if (!orgIdToLoad) {
        setSelectedOrgId("");
        selectedOrgIdRef.current = "";
        setSelectedOrgDetail(null);
        setStatus("No organizations found.");
        return;
      }

      setSelectedOrgId(orgIdToLoad);
      selectedOrgIdRef.current = orgIdToLoad;
      const detail = await api.getSuperuserOrgDetail(orgIdToLoad);
      setSelectedOrgDetail(detail);
      setStatus("Dashboard refreshed.");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load superuser dashboard.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin) {
      return;
    }
    void loadDashboard();
  }, [isAuthReady, isRedirectingToLogin, loadDashboard]);

  const selectedOrgSummary = useMemo(
    () => orgs.find((org) => org.org_id === selectedOrgId) ?? null,
    [orgs, selectedOrgId],
  );

  const overview = useMemo(() => {
    const totals = orgs.reduce(
      (acc, org) => {
        acc.orgCount += 1;
        acc.userCount += org.user_count;
        acc.patientCount += org.patient_count;
        acc.noteCount += org.note_count;
        acc.invoiceCount += org.invoice_count;
        acc.followUpCount += org.follow_up_count;
        acc.totalTokens += org.total_tokens;
        return acc;
      },
      {
        orgCount: 0,
        userCount: 0,
        patientCount: 0,
        noteCount: 0,
        invoiceCount: 0,
        followUpCount: 0,
        totalTokens: 0,
      },
    );

    return {
      ...totals,
      errorCount: errors.length,
      hotOrgs: [...orgs]
        .sort((left, right) => right.total_tokens - left.total_tokens)
        .slice(0, 3),
      activeOrgs: [...orgs]
        .sort((left, right) => {
          const rightTime = right.last_activity_at ? new Date(right.last_activity_at).getTime() : 0;
          const leftTime = left.last_activity_at ? new Date(left.last_activity_at).getTime() : 0;
          return rightTime - leftTime;
        })
        .slice(0, 3),
    };
  }, [errors.length, orgs]);

  async function handleSelectOrg(orgId: string) {
    if (orgId === selectedOrgIdRef.current && selectedOrgDetail?.summary.org_id === orgId) {
      return;
    }
    setSelectedOrgId(orgId);
    selectedOrgIdRef.current = orgId;
    setStatus("");
    setError("");
    try {
      const detail = await api.getSuperuserOrgDetail(orgId);
      setSelectedOrgDetail(detail);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load organization details.");
    }
  }

  async function handleDeleteUser(userId: string) {
    if (!selectedOrgDetail) {
      return;
    }
    if (!window.confirm("Delete this user? This cannot be undone.")) {
      return;
    }
    setIsDeleting(true);
    setError("");
    setStatus("");
    try {
      await api.deleteSuperuserUser(userId);
      await loadDashboard(selectedOrgDetail.summary.org_id);
      setStatus("User deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete user.");
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleDeleteOrg() {
    if (!selectedOrgDetail) {
      return;
    }
    if (!window.confirm(`Delete ${selectedOrgDetail.summary.clinic_name}? This removes the entire org.`)) {
      return;
    }
    setIsDeleting(true);
    setError("");
    setStatus("");
    try {
      await api.deleteSuperuserOrg(selectedOrgDetail.summary.org_id);
      await loadDashboard();
      setStatus("Organization deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete organization.");
    } finally {
      setIsDeleting(false);
    }
  }

  if (isRedirectingToLogin) {
    return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600">Redirecting to login...</div></main>;
  }

  if (!isAuthReady) {
    return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600">Loading superuser dashboard...</div></main>;
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1560px] space-y-5">
        <section className="overflow-hidden rounded-[32px] border border-slate-800 bg-slate-925 shadow-[0_22px_60px_rgba(0,0,0,0.35)]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-5 py-4 sm:px-6">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-sm font-semibold tracking-[0.18em] text-sky-300">
                SU
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Hidden route</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-slate-100">Superuser control room</h1>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-full border border-slate-800 bg-slate-900 p-1">
                {(["dashboard", "orgs", "errors"] as SuperuserTab[]).map((tab) => {
                  const active = activeTab === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`rounded-full px-4 py-2 text-sm font-medium capitalize transition ${
                        active
                          ? "bg-slate-800 text-slate-100"
                          : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                      }`}
                    >
                      {tab}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => void loadDashboard(selectedOrgIdRef.current)}
                className="rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-slate-800"
              >
                {isLoading ? "Refreshing..." : "Refresh"}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-400"
              >
                Sign out
              </button>
            </div>
          </div>

          <div className="px-5 py-5 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="max-w-[70ch]">
                <p className="text-sm leading-7 text-slate-400">
                  Platform-wide visibility across clinic organizations, user access, usage pressure, and backend failures.
                </p>
                {currentUser ? (
                  <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                    Signed in as {currentUser.identifier}
                  </p>
                ) : null}
              </div>
              <div className="rounded-[24px] border border-slate-800 bg-slate-900 px-4 py-3 text-right">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Selected org</p>
                <p className="mt-1 text-sm font-semibold text-slate-100">
                  {selectedOrgSummary?.clinic_name || "No org selected"}
                </p>
                <p className="mt-1 text-xs text-slate-500">{selectedOrgSummary?.org_id || "Pick an org below"}</p>
              </div>
            </div>

            {error ? <div className="mt-4 rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
            {status ? <div className="mt-4 rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{status}</div> : null}
          </div>
        </section>

        {activeTab === "dashboard" ? (
          <div className="space-y-5">
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                ["Organizations", overview.orgCount, "Total clinics currently onboarded."],
                ["Users", overview.userCount, "All staff and admin accounts across orgs."],
                ["Errors", overview.errorCount, "Recent platform errors in the current feed."],
                ["Tokens", overview.totalTokens, "Total recorded AI token usage across orgs."],
              ].map(([label, value, copy], index) => (
                <article
                  key={String(label)}
                  className={`rounded-[30px] border px-5 py-5 shadow-[0_16px_40px_rgba(0,0,0,0.28)] ${
                    index === 0
                      ? "border-slate-800 bg-slate-925"
                      : index === 1
                        ? "border-slate-800 bg-slate-900"
                        : index === 2
                          ? "border-rose-900/40 bg-rose-950/30"
                          : "border-slate-800 bg-slate-900"
                  }`}
                >
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{label}</p>
                  <p className="mt-5 text-4xl font-semibold tracking-[-0.05em] text-slate-100">{formatNumber(Number(value))}</p>
                  <p className="mt-3 max-w-[26ch] text-sm leading-6 text-slate-400">{copy}</p>
                </article>
              ))}
            </section>

            <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <article className="rounded-[30px] border border-slate-800 bg-slate-925 p-5 shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Platform volume</p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-100">Operational totals</h2>
                  </div>
                  <div className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-medium text-slate-300">
                    Manual refresh only
                  </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {[
                    ["Patients", overview.patientCount],
                    ["Notes", overview.noteCount],
                    ["Invoices", overview.invoiceCount],
                    ["Follow-ups", overview.followUpCount],
                    ["Active orgs", overview.activeOrgs.length],
                    ["Recent errors", overview.errorCount],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-[22px] border border-slate-800 bg-slate-900 px-4 py-4">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
                      <p className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-100">{formatNumber(Number(value))}</p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-[30px] border border-slate-800 bg-slate-925 p-5 shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Current org</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-100">
                  {selectedOrgSummary?.clinic_name || "No org selected"}
                </h2>
                <p className="mt-2 max-w-[34ch] text-sm leading-6 text-slate-400">
                  Quick snapshot of the org you are currently drilling into.
                </p>
                <div className="mt-5 space-y-3">
                  {selectedOrgDetail ? (
                    <>
                      {[
                        ["Users", selectedOrgDetail.summary.user_count],
                        ["Patients", selectedOrgDetail.summary.patient_count],
                        ["Notes", selectedOrgDetail.summary.note_count],
                        ["Invoices", selectedOrgDetail.summary.invoice_count],
                        ["Tokens", selectedOrgDetail.summary.total_tokens],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="flex items-center justify-between rounded-[20px] border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-200">
                          <span>{label}</span>
                          <span className="font-semibold">{formatNumber(Number(value))}</span>
                        </div>
                      ))}
                    </>
                  ) : (
                    <p className="text-sm text-slate-400">Pick an organization to see its detail snapshot.</p>
                  )}
                </div>
              </article>
            </section>

            <section className="grid gap-5 xl:grid-cols-2">
              <article className="rounded-[30px] border border-slate-800 bg-slate-925 p-5 shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Highest usage</p>
                    <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-slate-100">Top token orgs</h3>
                  </div>
                </div>
                <div className="mt-5 space-y-3">
                  {overview.hotOrgs.length ? overview.hotOrgs.map((org, index) => (
                    <button
                      key={org.org_id}
                      type="button"
                      onClick={() => {
                        setActiveTab("orgs");
                        void handleSelectOrg(org.org_id);
                      }}
                      className="flex w-full items-center justify-between rounded-[22px] border border-slate-800 bg-slate-900 px-4 py-4 text-left transition hover:bg-slate-800"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-sm font-semibold text-sky-300">
                          {index + 1}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-100">{org.clinic_name}</p>
                          <p className="mt-1 text-xs text-slate-500">{org.user_count} users • {org.invoice_count} invoices</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-slate-100">{formatNumber(org.total_tokens)}</p>
                        <p className="mt-1 text-xs text-slate-500">tokens</p>
                      </div>
                    </button>
                  )) : <p className="text-sm text-slate-400">No org usage data yet.</p>}
                </div>
              </article>

              <article className="rounded-[30px] border border-rose-900/40 bg-rose-950/25 p-5 shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
                <p className="text-[11px] uppercase tracking-[0.22em] text-rose-300/70">Recent failures</p>
                <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-slate-100">Error pulse</h3>
                <div className="mt-5 space-y-3">
                  {errors.slice(0, 4).length ? errors.slice(0, 4).map((entry) => (
                    <div key={entry.id} className="rounded-[22px] border border-rose-900/40 bg-slate-950/50 px-4 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-rose-200">{entry.error_type}</p>
                        <p className="text-xs text-rose-200/70">{formatDateTime(entry.created_at)}</p>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-300">{entry.message}</p>
                      <p className="mt-2 text-xs uppercase tracking-[0.14em] text-rose-200/60">
                        {entry.method} {entry.path}
                      </p>
                    </div>
                  )) : <p className="text-sm text-slate-400">No recent errors recorded.</p>}
                </div>
              </article>
            </section>
          </div>
        ) : null}

        {activeTab === "orgs" ? (
          <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
            <section className="rounded-[30px] border border-slate-800 bg-slate-925 p-5 shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
              <div className="mb-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Organizations</p>
                <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-slate-100">{orgs.length} orgs</h2>
              </div>
              <div className="space-y-3">
                {orgs.map((org) => {
                  const active = org.org_id === selectedOrgId;
                  return (
                    <button
                      key={org.org_id}
                      type="button"
                      onClick={() => void handleSelectOrg(org.org_id)}
                      className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${
                        active ? "border-sky-500/50 bg-slate-900" : "border-slate-800 bg-slate-900 hover:bg-slate-800"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-100">{org.clinic_name}</p>
                          <p className="mt-1 text-xs text-slate-500">{org.org_id}</p>
                        </div>
                        <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs font-medium text-slate-300">
                          {org.user_count} users
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
                        <span>{org.patient_count} patients</span>
                        <span>{org.note_count} notes</span>
                        <span>{org.invoice_count} invoices</span>
                        <span>{formatNumber(org.total_tokens)} tokens</span>
                      </div>
                      <p className="mt-3 text-xs text-slate-500">Last activity: {formatDateTime(org.last_activity_at)}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="space-y-5">
              <section className="rounded-[30px] border border-slate-800 bg-slate-925 p-5 shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Organization detail</p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-100">{selectedOrgSummary?.clinic_name || "Select an org"}</h2>
                    <p className="mt-1 text-sm text-slate-400">{selectedOrgSummary?.org_id || "Choose an org from the list."}</p>
                  </div>
                  <button
                    type="button"
                    disabled={!selectedOrgDetail || isDeleting}
                    onClick={() => void handleDeleteOrg()}
                    className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                  >
                    Delete org
                  </button>
                </div>
                {selectedOrgDetail ? (
                  <div className="mt-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
                    {[
                      ["Users", selectedOrgDetail.summary.user_count],
                      ["Patients", selectedOrgDetail.summary.patient_count],
                      ["Notes", selectedOrgDetail.summary.note_count],
                      ["Invoices", selectedOrgDetail.summary.invoice_count],
                      ["Follow-ups", selectedOrgDetail.summary.follow_up_count],
                      ["Tokens", selectedOrgDetail.summary.total_tokens],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-[22px] border border-slate-800 bg-slate-900 px-4 py-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
                        <p className="mt-2 text-lg font-semibold text-slate-100">{formatNumber(Number(value))}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="rounded-[30px] border border-slate-800 bg-slate-925 p-5 shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
                <h3 className="text-lg font-semibold text-slate-100">Users</h3>
                <div className="mt-4 space-y-3">
                  {selectedOrgDetail?.users.length ? selectedOrgDetail.users.map((user) => (
                    <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-slate-800 bg-slate-900 px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-100">{user.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{user.identifier}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs font-medium text-slate-300">{user.role}</span>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => void handleDeleteUser(user.id)}
                          className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )) : <p className="text-sm text-slate-400">No users loaded.</p>}
                </div>
              </section>

              <div className="grid gap-5 xl:grid-cols-2">
                <section className="rounded-[30px] border border-slate-800 bg-slate-925 p-5 shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
                  <h3 className="text-lg font-semibold text-slate-100">Usage</h3>
                  <div className="mt-4 rounded-[22px] border border-slate-800 bg-slate-900 px-4 py-3">
                    <p className="text-sm text-slate-400">Total requests: {formatNumber(selectedOrgDetail?.usage.total_requests || 0)}</p>
                    <p className="mt-1 text-sm text-slate-400">Total tokens: {formatNumber(selectedOrgDetail?.usage.total_tokens || 0)}</p>
                  </div>
                  <div className="mt-4 space-y-2">
                    {selectedOrgDetail ? Object.entries(selectedOrgDetail.usage.by_feature).map(([feature, tokens]) => (
                      <div key={feature} className="flex items-center justify-between rounded-[18px] border border-slate-800 bg-slate-900 px-4 py-2 text-sm text-slate-200">
                        <span>{feature}</span>
                        <span>{formatNumber(tokens)}</span>
                      </div>
                    )) : null}
                  </div>
                </section>

                <section className="rounded-[30px] border border-rose-900/40 bg-rose-950/25 p-5 shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
                  <h3 className="text-lg font-semibold text-slate-100">Recent org errors</h3>
                  <div className="mt-4 space-y-3">
                    {selectedOrgDetail?.recent_errors.length ? selectedOrgDetail.recent_errors.map((entry) => (
                      <div key={entry.id} className="rounded-[20px] border border-rose-900/40 bg-slate-950/50 px-4 py-3">
                        <p className="text-sm font-semibold text-rose-200">{entry.error_type}</p>
                        <p className="mt-1 text-sm text-slate-300">{entry.message}</p>
                        <p className="mt-2 text-xs text-rose-200/70">{entry.method} {entry.path} • {formatDateTime(entry.created_at)}</p>
                      </div>
                    )) : <p className="text-sm text-slate-400">No recent org errors.</p>}
                  </div>
                </section>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "errors" ? (
          <section className="rounded-[30px] border border-rose-900/40 bg-rose-950/25 p-5 shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-rose-300/70">Errors</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-100">Recent platform failures</h2>
                <p className="mt-2 max-w-[65ch] text-sm leading-6 text-slate-400">
                  Durable error feed for backend failures across all orgs. Refresh when you want a fresh view.
                </p>
              </div>
              <div className="rounded-[22px] border border-rose-900/40 bg-slate-950/50 px-4 py-3 text-right">
                <p className="text-[11px] uppercase tracking-[0.18em] text-rose-200/70">Entries loaded</p>
                <p className="mt-1 text-2xl font-semibold text-slate-100">{formatNumber(errors.length)}</p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {errors.length ? errors.map((entry) => (
                <div key={entry.id} className="rounded-[22px] border border-rose-900/40 bg-slate-950/50 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-rose-200">{entry.error_type}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-rose-200/70">
                        {entry.method} {entry.path}
                      </p>
                    </div>
                    <p className="text-xs text-rose-200/70">{formatDateTime(entry.created_at)}</p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{entry.message}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-rose-200/80">
                    {entry.identifier ? <span className="rounded-full border border-rose-900/40 bg-slate-950/50 px-3 py-1">{entry.identifier}</span> : null}
                    {entry.org_id ? <span className="rounded-full border border-rose-900/40 bg-slate-950/50 px-3 py-1">{entry.org_id}</span> : null}
                    {entry.status_code ? <span className="rounded-full border border-rose-900/40 bg-slate-950/50 px-3 py-1">HTTP {entry.status_code}</span> : null}
                  </div>
                </div>
              )) : <p className="text-sm text-slate-400">No errors recorded.</p>}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
